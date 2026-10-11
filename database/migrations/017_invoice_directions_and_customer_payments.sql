-- Add explicit invoice direction and an RLS-scoped, append-only customer payment ledger.
-- Apply manually after migrations 007, 008, 010, 011, 013, 015, and 016 have been verified.
-- Legacy invoices are classified only from a same-owner party or source-document relation.

begin;

do $preflight$
begin
  if to_regclass('public.invoices') is null
    or to_regclass('public.expenses') is null
    or to_regclass('public.expense_payments') is null
    or to_regclass('public.documents') is null
    or to_regclass('public.companies') is null then
    raise exception 'Migrations 007, 008, 010, 011, 013, 015, and 016 must be installed before 017.';
  end if;
  if to_regprocedure('public.can_write_company_invoice(uuid)') is null
    or to_regprocedure('public.is_company_member(uuid)') is null then
    raise exception 'Invoice and company authorization functions are required before 017.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'customer_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'supplier_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses' and column_name = 'invoice_id'
  ) then
    raise exception 'Invoice party links and expenses.invoice_id are required before 017.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'document_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'category'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'user_id'
  ) then
    raise exception 'Ownership-scoped invoice document categories are required before 017.';
  end if;
end;
$preflight$;

alter table public.invoices add column if not exists invoice_type text;

-- Backfill only from a verified party ID; free-text labels and statuses are never used.
update public.invoices
set invoice_type = case
  when customer_id is not null then 'customer'
  when supplier_id is not null then 'supplier'
end
where invoice_type is null
  and (customer_id is not null or supplier_id is not null);

update public.invoices as invoice
set invoice_type = case document.category
  when 'customer_invoice' then 'customer'
  when 'supplier_invoice' then 'supplier'
end
from public.documents as document
where invoice.invoice_type is null
  and invoice.customer_id is null
  and invoice.supplier_id is null
  and invoice.document_id = document.id
  and document.company_id is not distinct from invoice.company_id
  and document.user_id is not distinct from invoice.user_id
  and document.category in ('customer_invoice', 'supplier_invoice');

do $direction_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_invoice_type_party_match'
  ) then
    alter table public.invoices add constraint invoices_invoice_type_party_match check (
      (invoice_type is null or invoice_type in ('customer', 'supplier'))
      and (customer_id is null or invoice_type is not distinct from 'customer')
      and (supplier_id is null or invoice_type is not distinct from 'supplier')
      and not (customer_id is not null and supplier_id is not null)
    );
  end if;
end;
$direction_constraint$;

create index if not exists invoices_type_company_due_idx
  on public.invoices (invoice_type, company_id, due_date)
  where invoice_type is not null;

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  payment_date date not null,
  reference text,
  note text,
  created_at timestamptz not null default now(),
  constraint invoice_payments_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ),
  constraint invoice_payments_reference_length check (reference is null or char_length(reference) <= 160),
  constraint invoice_payments_note_length check (note is null or char_length(note) <= 2000)
);

create index if not exists invoice_payments_invoice_date_idx
  on public.invoice_payments (invoice_id, payment_date desc);

create or replace function public.validate_invoice_payment_link()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  invoice_user_id uuid;
  invoice_company_id uuid;
  invoice_type_value text;
begin
  select invoice.user_id, invoice.company_id, invoice.invoice_type
    into invoice_user_id, invoice_company_id, invoice_type_value
  from public.invoices as invoice
  where invoice.id = new.invoice_id;

  if not found
    or invoice_user_id is distinct from new.user_id
    or invoice_company_id is distinct from new.company_id
    or invoice_type_value is distinct from 'customer' then
    raise exception 'Customer payment must belong to a customer invoice in the same owner scope.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_invoice_payment_link() from public, anon, authenticated;

drop trigger if exists invoice_payments_validate_link on public.invoice_payments;
create trigger invoice_payments_validate_link
  before insert or update of invoice_id, user_id, company_id on public.invoice_payments
  for each row execute function public.validate_invoice_payment_link();

create or replace function public.validate_invoice_payments_against_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  paid_total numeric(14, 2);
begin
  if tg_op = 'UPDATE' and new.invoice_type is distinct from old.invoice_type then
    if exists (select 1 from public.invoice_payments where invoice_id = old.id)
      or exists (select 1 from public.expenses where invoice_id = old.id) then
      raise exception 'Invoice direction cannot change after payments or an expense link exist.'
        using errcode = '23514';
    end if;
  end if;

  if new.invoice_type = 'customer' then
    select coalesce(sum(payment.amount), 0) into paid_total
    from public.invoice_payments as payment
    where payment.invoice_id = new.id;
  elsif new.invoice_type = 'supplier' then
    select coalesce(sum(payment.amount), 0) into paid_total
    from public.expenses as expense
    join public.expense_payments as payment on payment.expense_id = expense.id
    where expense.invoice_id = new.id;
  else
    paid_total := 0;
  end if;

  if paid_total > new.total_ttc then
    raise exception 'Invoice total cannot be lower than its recorded payments.'
      using errcode = '23514';
  end if;

  if new.invoice_type = 'customer' and new.status = 'paid'
    and (tg_op = 'INSERT' or old.status is distinct from 'paid')
    and paid_total < new.total_ttc then
    raise exception 'Customer invoice cannot be marked paid before recorded payments cover its total.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_invoice_payments_against_amount() from public, anon, authenticated;

drop trigger if exists invoices_validate_payments_against_amount on public.invoices;
create trigger invoices_validate_payments_against_amount
  before insert or update of invoice_type, status, total_ttc on public.invoices
  for each row execute function public.validate_invoice_payments_against_amount();

create or replace function public.validate_supplier_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  linked_invoice_id uuid;
  invoice_row public.invoices%rowtype;
  already_paid numeric(14, 2);
begin
  select expense.invoice_id into linked_invoice_id
  from public.expenses as expense
  where expense.id = new.expense_id;
  if linked_invoice_id is null then return new; end if;

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = linked_invoice_id
  for update;
  if not found or invoice_row.invoice_type <> 'supplier' then
    raise exception 'Expense payments can link only to supplier invoices.' using errcode = '23514';
  end if;

  select coalesce(sum(payment.amount), 0) into already_paid
  from public.expenses as expense
  join public.expense_payments as payment on payment.expense_id = expense.id
  where expense.invoice_id = linked_invoice_id
    and (tg_op <> 'UPDATE' or payment.id <> old.id);
  if already_paid + new.amount > invoice_row.total_ttc then
    raise exception 'Payment exceeds the outstanding supplier invoice balance.' using errcode = '22003';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_supplier_invoice_payment() from public, anon, authenticated;

drop trigger if exists expense_payments_validate_supplier_invoice on public.expense_payments;
create trigger expense_payments_validate_supplier_invoice
  before insert or update of expense_id, amount on public.expense_payments
  for each row execute function public.validate_supplier_invoice_payment();

alter table public.invoice_payments enable row level security;
revoke all on table public.invoice_payments from public, anon, authenticated;
grant select on table public.invoice_payments to authenticated;
create policy invoice_payments_select on public.invoice_payments
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and company_id is null)
    or (user_id is null and company_id is not null and public.is_company_member(company_id))
  );

create or replace function public.record_invoice_payment(
  target_invoice_id uuid,
  target_payment_date date,
  target_amount numeric,
  target_reference text default null,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  invoice_row public.invoices%rowtype;
  already_paid numeric(14, 2);
  payment_id uuid;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if target_payment_date is null or target_payment_date > today_utc then
    raise exception 'Payment date cannot be in the future.' using errcode = '22007';
  end if;
  if target_amount is null or target_amount <= 0
    or target_amount <> pg_catalog.round(target_amount, 2)
    or target_amount > 999999999999.99 then
    raise exception 'Payment amount must be positive and have at most two decimals.' using errcode = '22023';
  end if;
  if target_reference is not null and char_length(pg_catalog.btrim(target_reference)) > 160
    or target_note is not null and char_length(pg_catalog.btrim(target_note)) > 2000 then
    raise exception 'Payment reference or note is too long.' using errcode = '22023';
  end if;

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if not found or invoice_row.invoice_type <> 'customer'
    or invoice_row.status in ('draft', 'cancelled', 'paid') then
    raise exception 'Customer invoice is unavailable for payment.' using errcode = 'P0002';
  end if;
  if not (
    (invoice_row.user_id = (select auth.uid()) and invoice_row.company_id is null)
    or (invoice_row.user_id is null and invoice_row.company_id is not null
      and public.can_write_company_invoice(invoice_row.company_id))
  ) then
    raise exception 'Customer invoice is inaccessible.' using errcode = '42501';
  end if;

  select coalesce(sum(payment.amount), 0) into already_paid
  from public.invoice_payments as payment
  where payment.invoice_id = target_invoice_id;
  if already_paid + target_amount > invoice_row.total_ttc then
    raise exception 'Payment exceeds the outstanding invoice balance.' using errcode = '22003';
  end if;

  insert into public.invoice_payments (
    invoice_id, user_id, company_id, payment_date, amount, reference, note
  ) values (
    invoice_row.id, invoice_row.user_id, invoice_row.company_id,
    target_payment_date, target_amount,
    nullif(pg_catalog.btrim(target_reference), ''),
    nullif(pg_catalog.btrim(target_note), '')
  ) returning id into payment_id;

  update public.invoices
  set status = case
    when already_paid + target_amount >= invoice_row.total_ttc then 'paid'
    when invoice_row.due_date < today_utc then 'overdue'
    else 'pending'
  end
  where id = target_invoice_id;

  return payment_id;
end;
$function$;
revoke all on function public.record_invoice_payment(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.record_invoice_payment(uuid, date, numeric, text, text) to authenticated;

commit;
