-- Create the invoices table for personal and company-owned invoices.
-- This migration intentionally does not depend on public.documents or on a
-- pre-existing public.invoice_status enum.

begin;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  document_id uuid,
  document_type text not null default 'invoice',
  invoice_number text,
  client_name text not null,
  description text not null,
  issue_date date not null,
  due_date date not null,
  subtotal_ht numeric(14, 2) not null,
  vat_rate numeric(5, 2) not null,
  vat_amount numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  other_fees numeric(14, 2) not null default 0,
  total_ttc numeric(15, 2) not null,
  currency text not null,
  status text not null default 'pending',
  category text,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ),
  constraint invoices_invoice_number_required check (
    status = 'draft'
    or nullif(trim(invoice_number), '') is not null
  ),
  constraint invoices_client_name_nonblank check (char_length(trim(client_name)) > 0),
  constraint invoices_description_nonblank check (char_length(trim(description)) > 0),
  constraint invoices_dates_coherent check (due_date >= issue_date),
  constraint invoices_amounts_nonnegative check (
    subtotal_ht >= 0
    and vat_rate between 0 and 100
    and vat_amount >= 0
    and discount >= 0
    and other_fees >= 0
    and total_ttc >= 0
  ),
  constraint invoices_amounts_coherent check (
    round(subtotal_ht - discount + vat_amount + other_fees, 2) = total_ttc
  ),
  constraint invoices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_status_valid check (
    status in ('draft', 'pending', 'paid', 'overdue', 'receivable', 'cancelled')
  )
);

create index invoices_user_status_issue_date_idx
  on public.invoices (user_id, status, issue_date desc)
  where user_id is not null;

create index invoices_company_status_issue_date_idx
  on public.invoices (company_id, status, issue_date desc)
  where company_id is not null;

create index invoices_company_due_date_idx
  on public.invoices (company_id, due_date)
  where company_id is not null;

alter table public.invoices enable row level security;

revoke all on table public.invoices from public, anon;
grant select, insert, update, delete on table public.invoices to authenticated;

create function public.can_write_company_invoice(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select exists (
    select 1
    from public.company_members as membership
    where membership.company_id = target_company_id
      and membership.user_id = (select auth.uid())
      and membership.role in (
        'owner'::public.company_role,
        'admin'::public.company_role,
        'accountant'::public.company_role
      )
  );
$function$;

revoke all on function public.can_write_company_invoice(uuid) from public, anon, authenticated;
grant execute on function public.can_write_company_invoice(uuid) to authenticated;

create function public.can_delete_company_invoice(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select exists (
    select 1
    from public.company_members as membership
    where membership.company_id = target_company_id
      and membership.user_id = (select auth.uid())
      and membership.role in (
        'owner'::public.company_role,
        'admin'::public.company_role
      )
  );
$function$;

revoke all on function public.can_delete_company_invoice(uuid) from public, anon, authenticated;
grant execute on function public.can_delete_company_invoice(uuid) to authenticated;

create policy invoices_personal_select on public.invoices
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id is null);

create policy invoices_company_select on public.invoices
  for select to authenticated
  using (
    user_id is null
    and company_id is not null
    and public.is_company_member(company_id)
  );

create policy invoices_personal_insert on public.invoices
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id is null);

create policy invoices_company_insert on public.invoices
  for insert to authenticated
  with check (
    user_id is null
    and company_id is not null
    and public.can_write_company_invoice(company_id)
  );

create policy invoices_personal_update on public.invoices
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (user_id = (select auth.uid()) and company_id is null);

create policy invoices_company_update on public.invoices
  for update to authenticated
  using (
    user_id is null
    and company_id is not null
    and public.can_write_company_invoice(company_id)
  )
  with check (
    user_id is null
    and company_id is not null
    and public.can_write_company_invoice(company_id)
  );

create function public.prevent_invoice_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id then
    raise exception 'Invoice ownership cannot be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_invoice_owner_change() from public, anon, authenticated;

create trigger invoices_owner_immutable
  before update of user_id, company_id on public.invoices
  for each row execute function public.prevent_invoice_owner_change();

create function public.set_invoice_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

revoke all on function public.set_invoice_updated_at() from public, anon, authenticated;

-- PostgreSQL orders same-event triggers by name: owner immutability runs first.
-- It may reject a changed owner; otherwise this trigger updates only updated_at.
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_invoice_updated_at();

create policy invoices_personal_delete on public.invoices
  for delete to authenticated
  using (user_id = (select auth.uid()) and company_id is null);

create policy invoices_company_delete on public.invoices
  for delete to authenticated
  using (
    user_id is null
    and company_id is not null
    and public.can_delete_company_invoice(company_id)
  );

commit;
