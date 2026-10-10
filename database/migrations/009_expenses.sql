-- Persistent personal and company-owned expenses.
-- Requires migrations 006_optional_data_ownership.sql and
-- 008_contacts_and_invoice_parties.sql to have been applied first.

begin;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  label text not null,
  amount numeric(14, 2) not null,
  currency text not null,
  expense_date date not null,
  category text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ),
  constraint expenses_label_nonblank check (char_length(trim(label)) between 1 and 200),
  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint expenses_category_length check (category is null or char_length(category) <= 100),
  constraint expenses_status_valid check (status in ('pending', 'paid', 'cancelled')),
  constraint expenses_notes_length check (notes is null or char_length(notes) <= 2000)
);

create index expenses_user_date_idx on public.expenses (user_id, expense_date desc)
  where user_id is not null;
create index expenses_company_date_idx on public.expenses (company_id, expense_date desc)
  where company_id is not null;

alter table public.expenses enable row level security;
revoke all on table public.expenses from public, anon;
grant select, insert, update on table public.expenses to authenticated;

create policy expenses_personal_select on public.expenses
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id is null);

create policy expenses_company_select on public.expenses
  for select to authenticated
  using (user_id is null and company_id is not null and public.is_company_member(company_id));

create policy expenses_personal_insert on public.expenses
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and company_id is null
    and (
      supplier_id is null
      or exists (
        select 1 from public.suppliers as supplier
        where supplier.id = supplier_id
          and supplier.user_id = (select auth.uid())
          and supplier.company_id is null
      )
    )
  );

create policy expenses_company_insert on public.expenses
  for insert to authenticated
  with check (
    user_id is null
    and company_id is not null
    and public.can_write_company_contact(company_id)
    and (
      supplier_id is null
      or exists (
        select 1 from public.suppliers as supplier
        where supplier.id = supplier_id
          and supplier.user_id is null
          and supplier.company_id = expenses.company_id
      )
    )
  );

create policy expenses_personal_update on public.expenses
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (
    user_id = (select auth.uid())
    and company_id is null
    and (
      supplier_id is null
      or exists (
        select 1 from public.suppliers as supplier
        where supplier.id = supplier_id
          and supplier.user_id = (select auth.uid())
          and supplier.company_id is null
      )
    )
  );

create policy expenses_company_update on public.expenses
  for update to authenticated
  using (
    user_id is null
    and company_id is not null
    and public.can_write_company_contact(company_id)
  )
  with check (
    user_id is null
    and company_id is not null
    and public.can_write_company_contact(company_id)
    and (
      supplier_id is null
      or exists (
        select 1 from public.suppliers as supplier
        where supplier.id = supplier_id
          and supplier.user_id is null
          and supplier.company_id = expenses.company_id
      )
    )
  );

create function public.prevent_expense_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id then
    raise exception 'Expense ownership cannot be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_expense_owner_change() from public, anon, authenticated;

create trigger expenses_owner_immutable
  before update of user_id, company_id on public.expenses
  for each row execute function public.prevent_expense_owner_change();

create function public.set_expense_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

revoke all on function public.set_expense_updated_at() from public, anon, authenticated;

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_expense_updated_at();

commit;
