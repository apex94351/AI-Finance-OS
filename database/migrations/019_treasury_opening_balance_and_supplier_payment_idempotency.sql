-- Persist one verified opening balance per owner and currency, and make supplier
-- invoice payment retries idempotent without changing the existing expense ledger.
-- Apply manually after migrations 016, 017, and 018 have been verified.
-- This migration has not been applied to a remote database.

begin;

do $preflight$
begin
  if to_regclass('public.invoices') is null
    or to_regclass('public.expenses') is null
    or to_regclass('public.expense_payments') is null
    or to_regclass('public.companies') is null
    or to_regclass('auth.users') is null then
    raise exception 'Migrations 016 and 017 must be installed before 019.';
  end if;
  if to_regprocedure('public.record_supplier_invoice_payment(uuid,date,numeric)') is null
    or to_regprocedure('public.can_write_company_invoice(uuid)') is null
    or to_regprocedure('public.is_company_member(uuid)') is null then
    raise exception 'Migrations 007 and 018, including supplier payment and company authorization functions, are required before 019.';
  end if;
end;
$preflight$;

create table if not exists public.treasury_opening_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(14, 2) not null
    check (opening_balance between -999999999999.99 and 999999999999.99),
  opening_date date not null check (opening_date <= (now() at time zone 'UTC')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treasury_opening_balances_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ),
  constraint treasury_opening_balances_owner_currency_unique
    unique nulls not distinct (user_id, company_id, currency)
);

alter table public.treasury_opening_balances enable row level security;
revoke all on table public.treasury_opening_balances from public, anon, authenticated;
grant select, insert, update on table public.treasury_opening_balances to authenticated;

drop policy if exists treasury_opening_balances_select on public.treasury_opening_balances;
create policy treasury_opening_balances_select on public.treasury_opening_balances
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and company_id is null)
    or (user_id is null and company_id is not null and public.is_company_member(company_id))
  );

drop policy if exists treasury_opening_balances_insert on public.treasury_opening_balances;
create policy treasury_opening_balances_insert on public.treasury_opening_balances
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and company_id is null)
    or (user_id is null and company_id is not null and public.can_write_company_invoice(company_id))
  );

drop policy if exists treasury_opening_balances_update on public.treasury_opening_balances;
create policy treasury_opening_balances_update on public.treasury_opening_balances
  for update to authenticated
  using (
    (user_id = (select auth.uid()) and company_id is null)
    or (user_id is null and company_id is not null and public.can_write_company_invoice(company_id))
  )
  with check (
    (user_id = (select auth.uid()) and company_id is null)
    or (user_id is null and company_id is not null and public.can_write_company_invoice(company_id))
  );

create table if not exists public.supplier_invoice_payment_requests (
  request_id uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  payment_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  payment_id uuid references public.expense_payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint supplier_invoice_payment_requests_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  )
);

alter table public.supplier_invoice_payment_requests enable row level security;
revoke all on table public.supplier_invoice_payment_requests from public, anon, authenticated;

create or replace function public.record_supplier_invoice_payment_idempotent(
  target_invoice_id uuid,
  target_payment_date date,
  target_amount numeric,
  target_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
<<payment_action>>
declare
  invoice_row public.invoices%rowtype;
  request_row public.supplier_invoice_payment_requests%rowtype;
  payment_id uuid;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if target_request_id is null then
    raise exception 'A payment request identifier is required.' using errcode = '22023';
  end if;
  if target_payment_date is null or target_payment_date > today_utc then
    raise exception 'Payment date cannot be in the future.' using errcode = '22007';
  end if;
  if target_amount is null or target_amount <= 0
    or target_amount <> pg_catalog.round(target_amount, 2)
    or target_amount > 999999999999.99 then
    raise exception 'Payment amount must be positive and have at most two decimals.' using errcode = '22023';
  end if;

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if not found then
    raise exception 'Supplier invoice is unavailable for payment.' using errcode = 'P0002';
  end if;
  if invoice_row.supplier_id is null or invoice_row.customer_id is not null then
    raise exception 'A verified supplier relation is required before recording this invoice payment.'
      using errcode = '23514';
  end if;
  if not (
    (invoice_row.user_id = (select auth.uid()) and invoice_row.company_id is null)
    or (invoice_row.user_id is null and invoice_row.company_id is not null
      and public.can_write_company_invoice(invoice_row.company_id))
  ) then
    raise exception 'Supplier invoice is inaccessible.' using errcode = '42501';
  end if;

  select * into request_row
  from public.supplier_invoice_payment_requests as request
  where request.request_id = target_request_id
  for update;
  if found then
    if request_row.invoice_id is distinct from target_invoice_id
      or request_row.user_id is distinct from invoice_row.user_id
      or request_row.company_id is distinct from invoice_row.company_id
      or request_row.payment_date is distinct from target_payment_date
      or request_row.amount is distinct from target_amount
      or request_row.payment_id is null then
      raise exception 'Payment request identifier was already used for different payment details.'
        using errcode = '22023';
    end if;
    return request_row.payment_id;
  end if;

  if invoice_row.status in ('draft', 'cancelled', 'paid') then
    raise exception 'Supplier invoice is unavailable for payment.' using errcode = 'P0002';
  end if;

  insert into public.supplier_invoice_payment_requests (
    request_id, invoice_id, user_id, company_id, payment_date, amount
  ) values (
    target_request_id,
    invoice_row.id,
    invoice_row.user_id,
    invoice_row.company_id,
    target_payment_date,
    target_amount
  )
  on conflict (request_id) do nothing;

  if not found then
    select * into request_row
    from public.supplier_invoice_payment_requests as request
    where request.request_id = target_request_id
    for update;
    if request_row.invoice_id is distinct from target_invoice_id
      or request_row.user_id is distinct from invoice_row.user_id
      or request_row.company_id is distinct from invoice_row.company_id
      or request_row.payment_date is distinct from target_payment_date
      or request_row.amount is distinct from target_amount
      or request_row.payment_id is null then
      raise exception 'Payment request identifier was already used for different payment details.'
        using errcode = '22023';
    end if;
    return request_row.payment_id;
  end if;

  payment_id := public.record_supplier_invoice_payment(
    target_invoice_id,
    target_payment_date,
    target_amount
  );
  update public.supplier_invoice_payment_requests
    set payment_id = payment_action.payment_id
    where request_id = target_request_id;
  return payment_id;
end;
$function$;

revoke all on function public.record_supplier_invoice_payment_idempotent(uuid, date, numeric, uuid)
  from public, anon;
grant execute on function public.record_supplier_invoice_payment_idempotent(uuid, date, numeric, uuid)
  to authenticated;

commit;
