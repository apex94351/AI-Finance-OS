-- Schedule an RLS-scoped, idempotent overdue-status update.
-- Apply manually only after reviewing the preflight checks in migrations/README.md.
-- The cron job is created by the database administrator, but its only DML runs
-- after SET ROLE to a non-login, non-owner, NOBYPASSRLS role.

begin;

do $preflight$
declare
  invoice_table oid := pg_catalog.to_regclass('public.invoices');
  scheduler_role oid := pg_catalog.to_regrole('invoice_overdue_scheduler');
  table_owner oid;
  rls_enabled boolean;
  role_is_safe boolean;
begin
  if invoice_table is null then
    raise exception 'Required table public.invoices does not exist.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_cron'
  ) then
    raise exception 'pg_cron is not installed in this database; stop and verify Supabase Cron availability before applying this migration.';
  end if;

  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
    or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'The required named cron.schedule and cron.unschedule functions are unavailable.';
  end if;

  select relation.relrowsecurity, relation.relowner
    into rls_enabled, table_owner
  from pg_catalog.pg_class as relation
  where relation.oid = invoice_table;

  if not rls_enabled then
    raise exception 'RLS must be enabled on public.invoices before installing the scheduler.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'status'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'due_date'
      and data_type = 'date'
  ) then
    raise exception 'public.invoices must have a status column and a due_date DATE column.';
  end if;

  if exists (
    select 1
    from public.invoices
    where status::text not in ('pending', 'receivable', 'overdue', 'paid', 'draft', 'cancelled')
  ) then
    raise exception 'Unknown invoice status values exist. Inspect and classify them before installing the scheduler.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = invoice_table
      and not trigger_row.tgisinternal
      and (trigger_row.tgtype::integer & 16) <> 0
      and trigger_row.tgname <> 'invoices_set_updated_at'
      and (
        pg_catalog.cardinality(trigger_row.tgattr) = 0
        or (
          select attribute.attnum::smallint
          from pg_catalog.pg_attribute as attribute
          where attribute.attrelid = invoice_table
            and attribute.attname = 'status'
            and not attribute.attisdropped
        ) = any(trigger_row.tgattr)
      )
  ) then
    raise exception 'An UPDATE trigger that fires for the status column or every update exists on public.invoices; inspect it before installing.';
  end if;

  if exists (
      select 1
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgrelid = invoice_table
        and trigger_row.tgname = 'invoices_set_updated_at'
        and (
          trigger_row.tgfoid <> pg_catalog.to_regprocedure('public.set_invoice_updated_at()')
          or not exists (
            select 1
            from pg_catalog.pg_proc as function_row
            where function_row.oid = trigger_row.tgfoid
              and not function_row.prosecdef
              and function_row.prosrc ~* '^\s*begin\s+new\.updated_at\s*:=\s*pg_catalog\.now\(\)\s*;\s*return new\s*;\s*end;\s*$'
          )
        )
  ) then
    raise exception 'The invoice updated_at trigger differs from the reviewed implementation; inspect it before installing.';
  end if;

  if scheduler_role is not null then
    select not role_row.rolsuper
      and not role_row.rolbypassrls
      and not role_row.rolcanlogin
      and not role_row.rolcreatedb
      and not role_row.rolcreaterole
      and not role_row.rolreplication
      and not role_row.rolinherit
      into role_is_safe
    from pg_catalog.pg_roles as role_row
    where role_row.oid = scheduler_role;

    if not coalesce(role_is_safe, false) then
      raise exception 'Role invoice_overdue_scheduler already exists with unsafe attributes; inspect it manually.';
    end if;
    if scheduler_role = table_owner then
      raise exception 'The scheduler role must not own public.invoices.';
    end if;
    if exists (
      select 1
      from pg_catalog.pg_auth_members as memberships
      where memberships.member = scheduler_role
         or memberships.roleid = scheduler_role
    ) then
      raise exception 'The scheduler role must not be a member of, or grant membership to, another role.';
    end if;
    if exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname not in ('pg_catalog', 'information_schema', 'cron')
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and relation.oid <> invoice_table
        and (
          pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'SELECT')
          or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'INSERT')
          or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'UPDATE')
          or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'DELETE')
          or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'TRUNCATE')
        )
    ) then
      raise exception 'The scheduler role already has privileges on another public table; inspect and revoke them before installing.';
    end if;
  end if;
end;
$preflight$;

do $create_role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'invoice_overdue_scheduler'
  ) then
    execute 'create role invoice_overdue_scheduler nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication';
  end if;
end;
$create_role$;

do $role_privileges$
declare
  scheduler_role oid := pg_catalog.to_regrole('invoice_overdue_scheduler');
  invoice_table oid := pg_catalog.to_regclass('public.invoices');
begin
  if pg_catalog.has_schema_privilege(scheduler_role, 'public', 'CREATE') then
    raise exception 'The scheduler role can CREATE in public (possibly through PUBLIC); remove that access before installing.';
  end if;

  if pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'SELECT')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'INSERT')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'UPDATE')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'DELETE')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'TRUNCATE')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'REFERENCES')
    or pg_catalog.has_table_privilege(scheduler_role, invoice_table, 'TRIGGER') then
    raise exception 'The scheduler role has table-level privileges on public.invoices; column-scoped grants are required.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = invoice_table
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        (attribute.attname = 'status'
          and (
            pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'INSERT')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'REFERENCES')
          ))
        or (attribute.attname = 'due_date'
          and (
            pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'INSERT')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'UPDATE')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'REFERENCES')
          ))
        or (attribute.attname not in ('status', 'due_date')
          and (
            pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'SELECT')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'INSERT')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'UPDATE')
            or pg_catalog.has_column_privilege(scheduler_role, invoice_table, attribute.attname, 'REFERENCES')
          ))
      )
  ) then
    raise exception 'The scheduler role has unexpected column privileges on public.invoices; inspect and revoke them before installing.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname not in ('pg_catalog', 'information_schema', 'cron')
      and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and relation.oid <> invoice_table
      and (
        pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'SELECT')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'INSERT')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'UPDATE')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'DELETE')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'TRUNCATE')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'REFERENCES')
        or pg_catalog.has_table_privilege(scheduler_role, relation.oid, 'TRIGGER')
      )
  ) then
    raise exception 'The scheduler role has privileges on another application table; inspect and revoke them before installing.';
  end if;
end;
$role_privileges$;

revoke all privileges on table public.invoices from invoice_overdue_scheduler;
revoke all privileges on schema public from invoice_overdue_scheduler;
grant usage on schema public to invoice_overdue_scheduler;
grant select (status, due_date) on table public.invoices to invoice_overdue_scheduler;
grant update (status) on table public.invoices to invoice_overdue_scheduler;

drop policy if exists invoice_overdue_scheduler_select on public.invoices;
create policy invoice_overdue_scheduler_select
  on public.invoices
  as permissive
  for select
  to invoice_overdue_scheduler
  using (
    status::text in ('pending', 'receivable')
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  );

drop policy if exists invoice_overdue_scheduler_select_cap on public.invoices;
create policy invoice_overdue_scheduler_select_cap
  on public.invoices
  as restrictive
  for select
  to invoice_overdue_scheduler
  using (
    status::text in ('pending', 'receivable')
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  );

drop policy if exists invoice_overdue_scheduler_update on public.invoices;
create policy invoice_overdue_scheduler_update
  on public.invoices
  as permissive
  for update
  to invoice_overdue_scheduler
  using (
    status::text in ('pending', 'receivable')
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  )
  with check (
    status::text = 'overdue'
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  );

drop policy if exists invoice_overdue_scheduler_update_cap on public.invoices;
create policy invoice_overdue_scheduler_update_cap
  on public.invoices
  as restrictive
  for update
  to invoice_overdue_scheduler
  using (
    status::text in ('pending', 'receivable')
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  )
  with check (
    status::text = 'overdue'
    and due_date < ((pg_catalog.now() at time zone 'UTC')::date)
  );

do $timestamp_trigger$
begin
  if pg_catalog.to_regprocedure('public.set_invoice_updated_at()') is not null then
    execute $function_ddl$
      create or replace function public.set_invoice_updated_at()
      returns trigger
      language plpgsql
      set search_path = ''
      as $function$
      begin
        if current_user = 'invoice_overdue_scheduler' then
          return new;
        end if;
        new.updated_at := pg_catalog.now();
        return new;
      end;
      $function$
    $function_ddl$;
  end if;
end;
$timestamp_trigger$;

do $schedule$
declare
  existing_job record;
  scheduled_command constant text :=
    'SET ROLE invoice_overdue_scheduler; UPDATE public.invoices SET status = ''overdue'' WHERE status::text IN (''pending'', ''receivable'') AND due_date < ((pg_catalog.now() AT TIME ZONE ''UTC'')::date); RESET ROLE;';
begin
  if not (
    select role_row.rolsuper
    from pg_catalog.pg_roles as role_row
    where role_row.rolname = current_user
  ) then
    raise exception 'Apply this migration as a database superuser; pg_cron executes the command as its creator, which must be able to SET ROLE invoice_overdue_scheduler.';
  end if;

  for existing_job in
    select jobid, username, database, command
    from cron.job
    where jobname = 'ai-finance-os-invoice-overdue-daily'
  loop
    if existing_job.username <> current_user
      or existing_job.database <> current_database()
      or btrim(existing_job.command) <> scheduled_command then
      raise exception 'A conflicting pg_cron job named ai-finance-os-invoice-overdue-daily exists; inspect it before installing.';
    end if;
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'ai-finance-os-invoice-overdue-daily',
    '10 0 * * *',
    scheduled_command
  );
end;
$schedule$;

commit;
