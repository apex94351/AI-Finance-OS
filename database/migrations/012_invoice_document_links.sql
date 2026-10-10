-- Enforce one company-owned invoice per source document.
-- Apply manually after confirming migrations 010 and 011 and the invoice
-- document_id/company_id columns exist on the target database.
-- This migration preserves rows and fails rather than repairing invalid links.

begin;

do $migration$
begin
  if to_regclass('public.documents') is null or to_regclass('public.invoices') is null then
    raise exception 'Both public.documents and public.invoices must exist before applying this migration.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name in ('id', 'company_id')
    group by table_schema, table_name
    having count(*) = 2
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name in ('document_id', 'company_id')
    group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception 'Required document_id/company_id columns are missing.';
  end if;

  if exists (
    select 1
    from public.invoices
    where document_id is not null
    group by document_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate invoice document_id values exist; resolve them before applying this migration.';
  end if;

  if exists (
    select 1
    from public.invoices as invoice
    where invoice.document_id is not null
      and not exists (
        select 1
        from public.documents as document
        where document.id = invoice.document_id
          and document.company_id = invoice.company_id
      )
  ) then
    raise exception 'Invoices contain missing or cross-company document references; resolve them before applying this migration.';
  end if;
end;
$migration$;

create unique index if not exists documents_company_id_id_unique_idx
  on public.documents (company_id, id);

create unique index if not exists invoices_document_id_unique_idx
  on public.invoices (document_id)
  where document_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_document_company_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_document_company_fkey
      foreign key (company_id, document_id)
      references public.documents (company_id, id)
      on delete restrict;
  end if;
end;
$migration$;

commit;
