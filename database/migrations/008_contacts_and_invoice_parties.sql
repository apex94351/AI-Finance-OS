begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  )
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  )
);

create index customers_user_name_idx on public.customers (user_id, name) where user_id is not null;
create index customers_company_name_idx on public.customers (company_id, name) where company_id is not null;
create index suppliers_user_name_idx on public.suppliers (user_id, name) where user_id is not null;
create index suppliers_company_name_idx on public.suppliers (company_id, name) where company_id is not null;

alter table public.customers enable row level security;
alter table public.suppliers enable row level security;

revoke all on table public.customers, public.suppliers from public, anon;
grant select, insert, update, delete on table public.customers, public.suppliers to authenticated;

create function public.can_write_company_contact(target_company_id uuid)
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

revoke all on function public.can_write_company_contact(uuid) from public, anon, authenticated;
grant execute on function public.can_write_company_contact(uuid) to authenticated;

create function public.can_delete_company_contact(target_company_id uuid)
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

revoke all on function public.can_delete_company_contact(uuid) from public, anon, authenticated;
grant execute on function public.can_delete_company_contact(uuid) to authenticated;

create policy customers_personal_select on public.customers
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
create policy customers_company_select on public.customers
  for select to authenticated
  using (user_id is null and company_id is not null and public.is_company_member(company_id));
create policy customers_personal_insert on public.customers
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id is null);
create policy customers_company_insert on public.customers
  for insert to authenticated
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));
create policy customers_personal_update on public.customers
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (user_id = (select auth.uid()) and company_id is null);
create policy customers_company_update on public.customers
  for update to authenticated
  using (user_id is null and company_id is not null and public.can_write_company_contact(company_id))
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));
create policy customers_personal_delete on public.customers
  for delete to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
create policy customers_company_delete on public.customers
  for delete to authenticated
  using (user_id is null and company_id is not null and public.can_delete_company_contact(company_id));

create policy suppliers_personal_select on public.suppliers
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
create policy suppliers_company_select on public.suppliers
  for select to authenticated
  using (user_id is null and company_id is not null and public.is_company_member(company_id));
create policy suppliers_personal_insert on public.suppliers
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id is null);
create policy suppliers_company_insert on public.suppliers
  for insert to authenticated
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));
create policy suppliers_personal_update on public.suppliers
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (user_id = (select auth.uid()) and company_id is null);
create policy suppliers_company_update on public.suppliers
  for update to authenticated
  using (user_id is null and company_id is not null and public.can_write_company_contact(company_id))
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));
create policy suppliers_personal_delete on public.suppliers
  for delete to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
create policy suppliers_company_delete on public.suppliers
  for delete to authenticated
  using (user_id is null and company_id is not null and public.can_delete_company_contact(company_id));

alter table public.invoices
  add column customer_id uuid references public.customers(id) on delete set null,
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add constraint invoices_single_counterparty check (
    customer_id is null or supplier_id is null
  );

create index invoices_customer_idx on public.invoices (customer_id) where customer_id is not null;
create index invoices_supplier_idx on public.invoices (supplier_id) where supplier_id is not null;

create function public.validate_invoice_counterparty()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  contact_user_id uuid;
  contact_company_id uuid;
begin
  if new.customer_id is not null then
    select customer.user_id, customer.company_id
      into contact_user_id, contact_company_id
    from public.customers as customer
    where customer.id = new.customer_id;
    if not found
      or contact_user_id is distinct from new.user_id
      or contact_company_id is distinct from new.company_id then
      raise exception 'Invoice customer must have the same owner as the invoice.'
        using errcode = '23514';
    end if;
  end if;

  if new.supplier_id is not null then
    select supplier.user_id, supplier.company_id
      into contact_user_id, contact_company_id
    from public.suppliers as supplier
    where supplier.id = new.supplier_id;
    if not found
      or contact_user_id is distinct from new.user_id
      or contact_company_id is distinct from new.company_id then
      raise exception 'Invoice supplier must have the same owner as the invoice.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_invoice_counterparty() from public, anon, authenticated;

create trigger invoices_validate_counterparty
  before insert or update of customer_id, supplier_id, user_id, company_id
  on public.invoices
  for each row execute function public.validate_invoice_counterparty();

create function public.set_contact_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

revoke all on function public.set_contact_updated_at() from public, anon, authenticated;

create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_contact_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_contact_updated_at();

commit;
