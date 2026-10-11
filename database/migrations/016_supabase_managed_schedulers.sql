-- Repair migrations 014/015 for Supabase-managed PostgreSQL roles.
-- Apply once, manually, after 006, 008, 009, 010, 011, 012, and 013.
-- This migration is additive and re-runnable; it does not create extensions,
-- database roles, schemas, or remote objects outside the current database.

begin;

do $preflight$
declare
  migration_role oid := (select role_row.oid from pg_catalog.pg_roles as role_row where role_row.rolname = current_user);
  role_bypasses_rls boolean := (select role_row.rolbypassrls from pg_catalog.pg_roles as role_row where role_row.rolname = current_user);
  required_table record;
  relation_owner oid;
  row_security_forced boolean;
  missing_tables text;
begin
  select string_agg(required.table_name, ', ')
    into missing_tables
  from (values
    ('public.expenses'),
    ('public.invoices'),
    ('public.documents'),
    ('public.suppliers')
  ) as required(table_name)
  where pg_catalog.to_regclass(required.table_name) is null;

  if missing_tables is not null then
    raise exception 'Required tables are missing: %. Apply and verify migrations 006, 008, 009, 010, 011, 012, and 013 first.', missing_tables;
  end if;

  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'cron.schedule(text,text,text) is unavailable. Enable Supabase Cron before applying this migration.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'cron', 'USAGE') then
    raise exception 'The migration role lacks USAGE on schema cron.';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') then
    raise exception 'The migration role lacks USAGE on schema public, required by the scheduled commands.';
  end if;
  if not pg_catalog.has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE') then
    raise exception 'The migration role cannot execute cron.schedule(text,text,text).';
  end if;
  if pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null
    or not pg_catalog.has_function_privilege(current_user, 'cron.unschedule(bigint)', 'EXECUTE') then
    raise exception 'The migration role cannot execute cron.unschedule(bigint), which is required for idempotent job replacement.';
  end if;

  for required_table in
    select *
    from (values
      ('public.expenses', 'SELECT, UPDATE'),
      ('public.invoices', 'SELECT, UPDATE'),
      ('public.documents', 'SELECT'),
      ('public.suppliers', 'SELECT')
    ) as required(table_name, needed_privileges)
  loop
    select relation.relowner, relation.relforcerowsecurity
      into relation_owner, row_security_forced
    from pg_catalog.pg_class as relation
    where relation.oid = pg_catalog.to_regclass(required_table.table_name);

    if relation_owner <> migration_role then
      raise exception 'The migration role % must own % so the restricted SECURITY DEFINER routines can safely run with RLS enabled.', current_user, required_table.table_name;
    end if;
    if row_security_forced and not role_bypasses_rls then
      raise exception 'RLS is FORCEd on % and the migration role cannot bypass it. Refusing to install schedulers that would fail or bypass the reviewed access model.', required_table.table_name;
    end if;
    if position('SELECT' in required_table.needed_privileges) > 0
      and not pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass(required_table.table_name), 'SELECT') then
      raise exception 'The migration role lacks SELECT on %.', required_table.table_name;
    end if;
    if position('UPDATE' in required_table.needed_privileges) > 0
      and not pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass(required_table.table_name), 'UPDATE') then
      raise exception 'The migration role lacks UPDATE on %.', required_table.table_name;
    end if;
  end loop;

  if not role_bypasses_rls then
    for required_table in
      select *
      from (values
        ('public.documents'),
        ('public.suppliers')
      ) as required(table_name)
    loop
      select relation.relowner, relation.relforcerowsecurity
        into relation_owner, row_security_forced
      from pg_catalog.pg_class as relation
      where relation.oid = pg_catalog.to_regclass(required_table.table_name);
      if relation_owner <> migration_role then
        raise exception 'The migration role must own % or have BYPASSRLS because SECURITY DEFINER link validation reads it with row_security=off.', required_table.table_name;
      end if;
      if row_security_forced then
        raise exception 'RLS is FORCEd on % and the migration role cannot bypass it.', required_table.table_name;
      end if;
    end loop;
  end if;

  if pg_catalog.to_regclass('auth.users') is null
    or pg_catalog.to_regclass('public.companies') is null then
    raise exception 'auth.users and public.companies must exist before expense recurrence tables can be created.';
  end if;

  if exists (
    select 1
    from cron.job as scheduled_job
    where scheduled_job.jobname in (
        'ai-finance-os-invoice-overdue-daily',
        'ai-finance-os-recurring-expenses-daily',
        'ai-finance-os-expenses-overdue-daily'
      )
      and (
        scheduled_job.database <> current_database()
        or scheduled_job.username <> current_user
      )
  ) then
    raise exception 'A scheduler job with a required stable name belongs to a different database role. Refusing to replace another role''s job.';
  end if;
end;
$preflight$;

alter table public.expenses
  add column if not exists subtotal_ht numeric(14, 2),
  add column if not exists vat_rate numeric(5, 2),
  add column if not exists vat_amount numeric(14, 2),
  add column if not exists due_date date,
  add column if not exists document_id uuid,
  add column if not exists invoice_id uuid,
  add column if not exists recurrence_id uuid,
  add column if not exists recurrence_date date;

alter table public.expenses drop constraint if exists expenses_status_valid;
alter table public.expenses
  add constraint expenses_status_valid
  check (status in ('pending', 'paid', 'overdue', 'cancelled'));

do $expense_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_vat_values_valid'
  ) then
    alter table public.expenses
      add constraint expenses_vat_values_valid check (
        (subtotal_ht is null or subtotal_ht >= 0)
        and (vat_rate is null or vat_rate between 0 and 100)
        and (vat_amount is null or vat_amount >= 0)
        and (subtotal_ht is null or vat_amount is null or abs(subtotal_ht + vat_amount - amount) <= 0.01)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_recurrence_pair_valid'
  ) then
    alter table public.expenses
      add constraint expenses_recurrence_pair_valid check (
        (recurrence_id is null and recurrence_date is null)
        or (recurrence_id is not null and recurrence_date is not null)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_document_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_document_fkey
      foreign key (document_id) references public.documents(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_invoice_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_invoice_fkey
      foreign key (invoice_id) references public.invoices(id) on delete restrict;
  end if;
end;
$expense_constraints$;

create unique index if not exists expenses_invoice_unique_idx
  on public.expenses (invoice_id) where invoice_id is not null;
create unique index if not exists expenses_recurrence_occurrence_unique_idx
  on public.expenses (recurrence_id, recurrence_date)
  where recurrence_id is not null;
create index if not exists expenses_due_date_idx
  on public.expenses (company_id, due_date) where due_date is not null;

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  label text not null,
  amount numeric(14, 2) not null,
  currency text not null,
  subtotal_ht numeric(14, 2),
  vat_rate numeric(5, 2),
  vat_amount numeric(14, 2),
  supplier_id uuid references public.suppliers(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  category text,
  frequency text not null,
  start_date date not null,
  next_due_date date not null,
  end_date date,
  status text not null default 'active',
  paused_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expenses_single_owner check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ),
  constraint recurring_expenses_label_nonblank check (char_length(trim(label)) between 1 and 200),
  constraint recurring_expenses_amount_positive check (amount > 0),
  constraint recurring_expenses_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_expenses_category_length check (category is null or char_length(category) <= 100),
  constraint recurring_expenses_frequency_valid check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  constraint recurring_expenses_status_valid check (status in ('active', 'paused', 'stopped')),
  constraint recurring_expenses_dates_valid check (
    next_due_date >= start_date and (end_date is null or end_date >= start_date)
  ),
  constraint recurring_expenses_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint recurring_expenses_vat_values_valid check (
    (subtotal_ht is null or subtotal_ht >= 0)
    and (vat_rate is null or vat_rate between 0 and 100)
    and (vat_amount is null or vat_amount >= 0)
    and (subtotal_ht is null or vat_amount is null or abs(subtotal_ht + vat_amount - amount) <= 0.01)
  )
);

create index if not exists recurring_expenses_user_due_idx
  on public.recurring_expenses (user_id, status, next_due_date) where user_id is not null;
create index if not exists recurring_expenses_company_due_idx
  on public.recurring_expenses (company_id, status, next_due_date) where company_id is not null;

do $recurrence_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.expenses'::regclass and conname = 'expenses_recurrence_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_recurrence_fkey
      foreign key (recurrence_id) references public.recurring_expenses(id) on delete restrict;
  end if;
end;
$recurrence_constraint$;

create table if not exists public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  payment_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists expense_payments_expense_date_idx
  on public.expense_payments (expense_id, payment_date);

alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
revoke all privileges on table public.expense_payments from public, anon, authenticated;
grant select on table public.expense_payments to authenticated;
drop policy if exists expense_payments_select on public.expense_payments;
create policy expense_payments_select on public.expense_payments
  for select to authenticated
  using (exists (
    select 1 from public.expenses as expense
    where expense.id = expense_id
      and (
        (expense.user_id = (select auth.uid()) and expense.company_id is null)
        or (expense.user_id is null and public.is_company_member(expense.company_id))
      )
  ));

alter table public.recurring_expenses enable row level security;
revoke all privileges on table public.recurring_expenses from public, anon, authenticated;
grant select, insert, update on table public.recurring_expenses to authenticated;
drop policy if exists recurring_expenses_personal_select on public.recurring_expenses;
create policy recurring_expenses_personal_select on public.recurring_expenses
  for select to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
drop policy if exists recurring_expenses_company_select on public.recurring_expenses;
create policy recurring_expenses_company_select on public.recurring_expenses
  for select to authenticated
  using (user_id is null and company_id is not null and public.is_company_member(company_id));
drop policy if exists recurring_expenses_personal_insert on public.recurring_expenses;
create policy recurring_expenses_personal_insert on public.recurring_expenses
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id is null);
drop policy if exists recurring_expenses_company_insert on public.recurring_expenses;
create policy recurring_expenses_company_insert on public.recurring_expenses
  for insert to authenticated
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));
drop policy if exists recurring_expenses_personal_update on public.recurring_expenses;
create policy recurring_expenses_personal_update on public.recurring_expenses
  for update to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (user_id = (select auth.uid()) and company_id is null);
drop policy if exists recurring_expenses_company_update on public.recurring_expenses;
create policy recurring_expenses_company_update on public.recurring_expenses
  for update to authenticated
  using (user_id is null and company_id is not null and public.can_write_company_contact(company_id))
  with check (user_id is null and company_id is not null and public.can_write_company_contact(company_id));

grant delete on table public.expenses to authenticated;
drop policy if exists expenses_personal_delete on public.expenses;
create policy expenses_personal_delete on public.expenses
  for delete to authenticated
  using (user_id = (select auth.uid()) and company_id is null);
drop policy if exists expenses_company_delete on public.expenses;
create policy expenses_company_delete on public.expenses
  for delete to authenticated
  using (user_id is null and company_id is not null and public.can_delete_company_contact(company_id));

create or replace function public.validate_expense_links()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  linked_user_id uuid;
  linked_company_id uuid;
  linked_supplier_id uuid;
begin
  if new.supplier_id is not null then
    select supplier.user_id, supplier.company_id
      into linked_user_id, linked_company_id
    from public.suppliers as supplier where supplier.id = new.supplier_id;
    if not found or linked_user_id is distinct from new.user_id or linked_company_id is distinct from new.company_id then
      raise exception 'Expense supplier must have the same owner as the expense.' using errcode = '23514';
    end if;
  end if;
  if new.document_id is not null then
    select document.user_id, document.company_id
      into linked_user_id, linked_company_id
    from public.documents as document where document.id = new.document_id;
    if not found or linked_user_id is distinct from new.user_id or linked_company_id is distinct from new.company_id then
      raise exception 'Expense document must have the same owner as the expense.' using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'expenses' then
    if new.invoice_id is not null then
      select invoice.user_id, invoice.company_id, invoice.supplier_id
        into linked_user_id, linked_company_id, linked_supplier_id
      from public.invoices as invoice where invoice.id = new.invoice_id;
      if not found
        or linked_user_id is distinct from new.user_id
        or linked_company_id is distinct from new.company_id
        or linked_supplier_id is null then
        raise exception 'Expense invoice must be a supplier invoice with the same owner.' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_expense_links() from public, anon, authenticated;

drop trigger if exists expenses_validate_links on public.expenses;
create trigger expenses_validate_links
  before insert or update of supplier_id, document_id, invoice_id, user_id, company_id
  on public.expenses for each row execute function public.validate_expense_links();
drop trigger if exists recurring_expenses_validate_links on public.recurring_expenses;
create trigger recurring_expenses_validate_links
  before insert or update of supplier_id, document_id, user_id, company_id
  on public.recurring_expenses for each row execute function public.validate_expense_links();

create or replace function public.validate_expense_amount_against_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  paid_total numeric(14, 2);
begin
  select coalesce(sum(payment.amount), 0) into paid_total
  from public.expense_payments as payment
  where payment.expense_id = new.id;
  if paid_total > new.amount then
    raise exception 'Expense amount cannot be lower than its recorded payments.' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_expense_amount_against_payments() from public, anon, authenticated;
drop trigger if exists expenses_validate_paid_total on public.expenses;
create trigger expenses_validate_paid_total
  before update of amount on public.expenses
  for each row execute function public.validate_expense_amount_against_payments();

create or replace function public.record_expense_payment(target_expense_id uuid, target_payment_date date, target_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  expense_row public.expenses%rowtype;
  already_paid numeric(14, 2);
  payment_id uuid;
begin
  if target_payment_date > (pg_catalog.now() at time zone 'UTC')::date then
    raise exception 'Payment date cannot be in the future.' using errcode = '22007';
  end if;
  if target_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;

  select * into expense_row
  from public.expenses as expense
  where expense.id = target_expense_id
  for update;
  if not found or expense_row.status = 'cancelled' then
    raise exception 'Expense is unavailable for payment.' using errcode = 'P0002';
  end if;
  if not (
    (expense_row.user_id = (select auth.uid()) and expense_row.company_id is null)
    or (
      expense_row.user_id is null
      and expense_row.company_id is not null
      and public.can_write_company_contact(expense_row.company_id)
    )
  ) then
    raise exception 'Expense is inaccessible.' using errcode = '42501';
  end if;

  select coalesce(sum(payment.amount), 0) into already_paid
  from public.expense_payments as payment
  where payment.expense_id = target_expense_id;
  if already_paid + target_amount > expense_row.amount then
    raise exception 'Payment exceeds the outstanding expense balance.' using errcode = '22003';
  end if;

  insert into public.expense_payments (expense_id, payment_date, amount)
    values (target_expense_id, target_payment_date, target_amount)
    returning id into payment_id;
  update public.expenses
    set status = case
      when already_paid + target_amount >= expense_row.amount then 'paid'
      when expense_row.status = 'overdue' then 'overdue'
      when due_date is not null and due_date < (pg_catalog.now() at time zone 'UTC')::date then 'overdue'
      else 'pending'
    end
    where id = target_expense_id;
  return payment_id;
end;
$function$;
revoke all on function public.record_expense_payment(uuid, date, numeric) from public, anon;
grant execute on function public.record_expense_payment(uuid, date, numeric) to authenticated;

create or replace function public.next_recurring_expense_date(target_date date, anchor_day integer, frequency text)
returns date
language plpgsql
immutable
set search_path = ''
as $function$
declare
  month_offset integer;
  target_month date;
  final_day integer;
begin
  if frequency = 'weekly' then return target_date + 7; end if;
  month_offset := case frequency when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12 else null end;
  if month_offset is null then
    raise exception 'Unknown recurring expense frequency.' using errcode = '22023';
  end if;
  target_month := (pg_catalog.date_trunc('month', target_date::timestamp) + (month_offset || ' months')::interval)::date;
  final_day := extract(day from (target_month + interval '1 month - 1 day'))::integer;
  return target_month + least(anchor_day, final_day) - 1;
end;
$function$;
revoke all on function public.next_recurring_expense_date(date, integer, text) from public, anon;
grant execute on function public.next_recurring_expense_date(date, integer, text) to authenticated;

create or replace function public.set_recurring_expense_status(target_id uuid, target_status text)
returns date
language plpgsql
set search_path = ''
as $function$
declare
  recurring_row public.recurring_expenses%rowtype;
  resume_date date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if target_status not in ('active', 'paused', 'stopped') then
    raise exception 'Unknown recurring expense status.' using errcode = '22023';
  end if;
  select * into recurring_row
  from public.recurring_expenses
  where id = target_id
  for update;
  if not found then
    raise exception 'Recurring expense not found.' using errcode = 'P0002';
  end if;
  if recurring_row.status = 'stopped' then
    raise exception 'Stopped recurring expenses cannot be resumed.' using errcode = '22023';
  end if;

  if target_status = 'active' and recurring_row.status = 'paused' then
    while recurring_row.next_due_date < resume_date loop
      recurring_row.next_due_date := public.next_recurring_expense_date(
        recurring_row.next_due_date,
        extract(day from recurring_row.start_date)::integer,
        recurring_row.frequency
      );
    end loop;
  end if;
  update public.recurring_expenses
    set status = target_status,
        next_due_date = recurring_row.next_due_date,
        paused_on = case when target_status = 'paused' then resume_date else null end,
        end_date = case
          when target_status = 'stopped' then greatest(
            start_date,
            least(coalesce(end_date, resume_date), resume_date)
          )
          else end_date
        end
    where id = target_id;
  return recurring_row.next_due_date;
end;
$function$;
revoke all on function public.set_recurring_expense_status(uuid, text) from public, anon;
grant execute on function public.set_recurring_expense_status(uuid, text) to authenticated;

create or replace function public.set_recurring_expense_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;
revoke all on function public.set_recurring_expense_updated_at() from public, anon, authenticated;
drop trigger if exists recurring_expenses_set_updated_at on public.recurring_expenses;
create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_recurring_expense_updated_at();

create or replace function public.generate_due_recurring_expense_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  recurring_row public.recurring_expenses%rowtype;
  inserted_count integer := 0;
  was_inserted integer;
  current_due_date date;
  anchor_day integer;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  for recurring_row in
    select *
    from public.recurring_expenses
    where status = 'active'
      and next_due_date <= today_utc
      and (end_date is null or next_due_date <= end_date)
    order by next_due_date
    for update
  loop
    current_due_date := recurring_row.next_due_date;
    anchor_day := extract(day from recurring_row.start_date)::integer;
    while current_due_date <= today_utc
      and (recurring_row.end_date is null or current_due_date <= recurring_row.end_date)
    loop
      insert into public.expenses (
        user_id, company_id, label, amount, currency, subtotal_ht, vat_rate, vat_amount,
        expense_date, due_date, category, supplier_id, document_id, status, notes,
        recurrence_id, recurrence_date
      ) values (
        recurring_row.user_id, recurring_row.company_id, recurring_row.label, recurring_row.amount,
        recurring_row.currency, recurring_row.subtotal_ht, recurring_row.vat_rate, recurring_row.vat_amount,
        current_due_date, current_due_date, recurring_row.category, recurring_row.supplier_id,
        recurring_row.document_id, 'pending', recurring_row.notes, recurring_row.id, current_due_date
      )
      on conflict (recurrence_id, recurrence_date) where recurrence_id is not null do nothing;
      get diagnostics was_inserted = row_count;
      inserted_count := inserted_count + was_inserted;
      current_due_date := public.next_recurring_expense_date(
        current_due_date, anchor_day, recurring_row.frequency
      );
    end loop;

    update public.recurring_expenses
      set next_due_date = current_due_date
      where id = recurring_row.id;
  end loop;
  return inserted_count;
end;
$function$;
revoke all on function public.generate_due_recurring_expense_occurrences() from public, anon, authenticated;

create or replace function public.update_overdue_expense_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  updated_count integer;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  update public.expenses as expense
    set status = case
      when coalesce((
        select sum(payment.amount)
        from public.expense_payments as payment
        where payment.expense_id = expense.id
      ), 0) >= expense.amount then 'paid'
      else 'overdue'
    end
    where expense.status = 'pending'
      and expense.due_date < today_utc;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;
revoke all on function public.update_overdue_expense_statuses() from public, anon, authenticated;

create or replace function public.update_overdue_invoice_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  updated_count integer;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  update public.invoices as invoice
    set status = 'overdue'
    where invoice.status::text in ('pending', 'receivable')
      and invoice.due_date < today_utc;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;
revoke all on function public.update_overdue_invoice_statuses() from public, anon, authenticated;

do $function_permissions$
declare
  migration_role oid := (select role_row.oid from pg_catalog.pg_roles as role_row where role_row.rolname = current_user);
  routine record;
begin
  for routine in
    select function_row.oid, function_row.proowner, function_row.prosecdef, function_row.proconfig
    from pg_catalog.pg_proc as function_row
    where function_row.oid in (
      'public.validate_expense_links()'::regprocedure,
      'public.validate_expense_amount_against_payments()'::regprocedure,
      'public.record_expense_payment(uuid,date,numeric)'::regprocedure,
      'public.generate_due_recurring_expense_occurrences()'::regprocedure,
      'public.update_overdue_expense_statuses()'::regprocedure,
      'public.update_overdue_invoice_statuses()'::regprocedure
    )
  loop
    if routine.proowner <> migration_role then
      raise exception 'Routine % is not owned by the migration role; refusing to schedule an execution context that was not verified.', routine.oid::regprocedure;
    end if;
    if not routine.prosecdef
      or not coalesce(routine.proconfig @> array['search_path=""', 'row_security=off'], false) then
      raise exception 'Security-definer routine % is missing the fixed search_path or row_security settings.', routine.oid::regprocedure;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_proc as function_row
    where function_row.oid = 'public.generate_due_recurring_expense_occurrences()'::regprocedure
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""', 'row_security=off']
  ) or not exists (
    select 1 from pg_catalog.pg_proc as function_row
    where function_row.oid = 'public.update_overdue_expense_statuses()'::regprocedure
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""', 'row_security=off']
  ) or not exists (
    select 1 from pg_catalog.pg_proc as function_row
    where function_row.oid = 'public.update_overdue_invoice_statuses()'::regprocedure
      and function_row.prosecdef
      and function_row.proconfig @> array['search_path=""', 'row_security=off']
  ) then
    raise exception 'A scheduler function does not have the required SECURITY DEFINER, fixed search_path, or controlled row_security settings.';
  end if;

  if not pg_catalog.has_function_privilege(
    current_user, 'public.generate_due_recurring_expense_occurrences()', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    current_user, 'public.update_overdue_expense_statuses()', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    current_user, 'public.update_overdue_invoice_statuses()', 'EXECUTE'
  ) then
    raise exception 'The cron job owner cannot execute one or more scheduler functions.';
  end if;
end;
$function_permissions$;

do $schedule$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid, jobname, username, database
    from cron.job
    where database = current_database()
      and jobname in (
        'ai-finance-os-invoice-overdue-daily',
        'ai-finance-os-recurring-expenses-daily',
        'ai-finance-os-expenses-overdue-daily'
      )
      and username = current_user
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;

  perform cron.schedule(
    'ai-finance-os-invoice-overdue-daily',
    '10 0 * * *',
    'select public.update_overdue_invoice_statuses();'
  );
  perform cron.schedule(
    'ai-finance-os-recurring-expenses-daily',
    '25 0 * * *',
    'select public.generate_due_recurring_expense_occurrences();'
  );
  perform cron.schedule(
    'ai-finance-os-expenses-overdue-daily',
    '20 0 * * *',
    'select public.update_overdue_expense_statuses();'
  );
end;
$schedule$;

commit;
