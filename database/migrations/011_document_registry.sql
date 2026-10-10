-- Add business classification to existing document metadata.
-- Apply manually after verifying public.documents exists from migration 001 or 010.

begin;

alter table public.documents
  add column if not exists category text not null default 'other',
  add column if not exists document_status text not null default 'to_process';

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_category_valid'
  ) then
    alter table public.documents
      add constraint documents_category_valid
      check (category in (
        'customer_invoice',
        'supplier_invoice',
        'quote',
        'supporting_document',
        'receipt',
        'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_status_valid'
  ) then
    alter table public.documents
      add constraint documents_status_valid
      check (document_status in (
        'to_process',
        'needs_review',
        'needs_information',
        'validated',
        'archived'
      ));
  end if;
end;
$migration$;

create index if not exists documents_company_registry_idx
  on public.documents (company_id, category, document_status, uploaded_at desc)
  where deleted_at is null;

commit;
