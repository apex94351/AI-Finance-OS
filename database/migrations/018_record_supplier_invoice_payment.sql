-- Record supplier invoice settlement through the existing expense/payment ledger.
-- Requires the verified 008 invoice-party relations and 016 expense/payment schema.
-- This function creates one linked expense only when the supplier invoice has none,
-- then records the dated payment atomically through record_expense_payment.
-- Apply manually; this file has not been applied to any remote database.

begin;

do $preflight$
begin
  if to_regclass('public.invoices') is null
    or to_regclass('public.expenses') is null
    or to_regclass('public.expense_payments') is null
    or to_regclass('public.suppliers') is null then
    raise exception 'Migrations 008 and 016 must be installed before 018.';
  end if;
  if to_regprocedure('public.record_expense_payment(uuid,date,numeric)') is null
    or to_regprocedure('public.can_write_company_invoice(uuid)') is null
    or to_regprocedure('public.can_write_company_contact(uuid)') is null then
    raise exception 'Invoice and expense payment authorization functions are required before 018.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'expenses'
      and indexname = 'expenses_invoice_unique_idx'
  ) then
    raise exception 'The unique expenses_invoice_unique_idx from migration 016 is required.';
  end if;
end;
$preflight$;

create or replace function public.sync_supplier_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  target_expense_id uuid;
  linked_invoice_id uuid;
  invoice_total numeric(15, 2);
  invoice_due_date date;
  current_invoice_status text;
  paid_total numeric(14, 2);
  next_invoice_status text;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  target_expense_id := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  select expense.invoice_id into linked_invoice_id
  from public.expenses as expense
  where expense.id = target_expense_id;
  if linked_invoice_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select invoice.total_ttc, invoice.due_date, invoice.status
    into invoice_total, invoice_due_date, current_invoice_status
  from public.invoices as invoice
  where invoice.id = linked_invoice_id;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select coalesce(sum(payment.amount), 0) into paid_total
  from public.expenses as expense
  join public.expense_payments as payment on payment.expense_id = expense.id
  where expense.invoice_id = linked_invoice_id;

  next_invoice_status := case
    when paid_total >= invoice_total then 'paid'
    when current_invoice_status = 'overdue' or invoice_due_date < today_utc then 'overdue'
    else 'pending'
  end;
  update public.invoices
  set status = next_invoice_status
  where id = linked_invoice_id
    and status is distinct from next_invoice_status;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.sync_supplier_invoice_payment_status() from public, anon, authenticated;

drop trigger if exists expense_payments_sync_supplier_invoice_status on public.expense_payments;
create trigger expense_payments_sync_supplier_invoice_status
  after insert or update of amount, expense_id or delete on public.expense_payments
  for each row execute function public.sync_supplier_invoice_payment_status();

create or replace function public.record_supplier_invoice_payment(
  target_invoice_id uuid,
  target_payment_date date,
  target_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  invoice_row public.invoices%rowtype;
  expense_row public.expenses%rowtype;
  payment_id uuid;
  paid_total numeric(14, 2);
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

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = target_invoice_id
  for update;
  if not found or invoice_row.status in ('draft', 'cancelled', 'paid') then
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
  if target_amount > invoice_row.total_ttc then
    raise exception 'Payment exceeds the supplier invoice total.' using errcode = '22003';
  end if;

  select * into expense_row
  from public.expenses as expense
  where expense.invoice_id = target_invoice_id
  for update;
  if not found then
    insert into public.expenses (
      user_id, company_id, label, amount, currency, expense_date, due_date,
      subtotal_ht, vat_rate, vat_amount, category, supplier_id, document_id,
      invoice_id, status, notes
    ) values (
      invoice_row.user_id,
      invoice_row.company_id,
      coalesce(nullif(pg_catalog.btrim(invoice_row.invoice_number), ''), 'Facture fournisseur')
        || ' · ' || coalesce(nullif(pg_catalog.btrim(invoice_row.client_name), ''), 'sans libellé'),
      invoice_row.total_ttc,
      invoice_row.currency,
      invoice_row.issue_date,
      invoice_row.due_date,
      invoice_row.subtotal_ht,
      invoice_row.vat_rate,
      invoice_row.vat_amount,
      invoice_row.category,
      invoice_row.supplier_id,
      invoice_row.document_id,
      invoice_row.id,
      'pending',
      invoice_row.description
    ) returning * into expense_row;
  elsif expense_row.user_id is distinct from invoice_row.user_id
    or expense_row.company_id is distinct from invoice_row.company_id
    or expense_row.supplier_id is distinct from invoice_row.supplier_id
    or expense_row.amount is distinct from invoice_row.total_ttc
    or expense_row.currency is distinct from invoice_row.currency then
    raise exception 'Linked expense ownership, supplier, amount, or currency does not match the invoice.'
      using errcode = '23514';
  end if;

  payment_id := public.record_expense_payment(
    expense_row.id,
    target_payment_date,
    target_amount
  );

  select coalesce(sum(payment.amount), 0) into paid_total
  from public.expense_payments as payment
  where payment.expense_id = expense_row.id;

  update public.invoices
  set status = case
    when paid_total >= invoice_row.total_ttc then 'paid'
    when invoice_row.due_date < today_utc then 'overdue'
    else 'pending'
  end
  where id = invoice_row.id;

  return payment_id;
end;
$function$;

revoke all on function public.record_supplier_invoice_payment(uuid, date, numeric) from public, anon;
grant execute on function public.record_supplier_invoice_payment(uuid, date, numeric) to authenticated;

commit;
