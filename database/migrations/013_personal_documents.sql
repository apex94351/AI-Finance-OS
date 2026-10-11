-- Add personal document ownership while retaining company-owned documents.
-- Apply manually only after verifying migrations 010 and 011 and the target
-- database's existing documents table, bucket, and policies.

begin;

do $preflight$
declare
  missing_columns text;
begin
  if to_regclass('public.documents') is null then
    raise exception 'public.documents is missing; apply and verify migration 010_documents_storage.sql first.';
  end if;

  select string_agg(required.column_name, ', ')
    into missing_columns
  from (values
    ('id'),
    ('company_id'),
    ('file_path'),
    ('file_name'),
    ('file_type'),
    ('file_size'),
    ('uploaded_at'),
    ('deleted_at'),
    ('category'),
    ('document_status')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and information_schema.columns.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'public.documents is missing required columns: %. Verify migrations 010_documents_storage.sql and 011_document_registry.sql before applying migration 013_personal_documents.sql.', missing_columns;
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing; verify the Supabase Auth schema before applying migration 013_personal_documents.sql.';
  end if;

  if to_regclass('storage.objects') is null then
    raise exception 'storage.objects is missing; verify the Supabase Storage schema before applying migration 013_personal_documents.sql.';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'documents'
  ) then
    raise exception 'The private documents bucket is missing; apply and verify migration 010_documents_storage.sql before applying migration 013_personal_documents.sql.';
  end if;
end;
$preflight$;

alter table public.documents
  alter column company_id drop not null,
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_single_owner'
  ) then
    alter table public.documents
      add constraint documents_single_owner check (
        (user_id is not null and company_id is null)
        or (user_id is null and company_id is not null)
      );
  end if;
end;
$migration$;

create index if not exists documents_user_registry_idx
  on public.documents (user_id, category, document_status, uploaded_at desc)
  where user_id is not null and deleted_at is null;

create or replace function public.prevent_document_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.user_id is distinct from old.user_id
    or new.company_id is distinct from old.company_id then
    raise exception 'Document ownership cannot be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_document_owner_change() from public, anon, authenticated;

do $migration$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.documents'::regclass
      and tgname = 'documents_owner_immutable'
      and not tgisinternal
  ) then
    create trigger documents_owner_immutable
      before update of user_id, company_id on public.documents
      for each row execute function public.prevent_document_owner_change();
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents'
      and policyname = 'documents_personal_select'
  ) then
    create policy documents_personal_select on public.documents
      for select to authenticated
      using (user_id = (select auth.uid()) and company_id is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents'
      and policyname = 'documents_personal_insert'
  ) then
    create policy documents_personal_insert on public.documents
      for insert to authenticated
      with check (user_id = (select auth.uid()) and company_id is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents'
      and policyname = 'documents_personal_update'
  ) then
    create policy documents_personal_update on public.documents
      for update to authenticated
      using (user_id = (select auth.uid()) and company_id is null)
      with check (user_id = (select auth.uid()) and company_id is null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'documents_storage_personal_select'
  ) then
    create policy documents_storage_personal_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (storage.foldername(name))[2] = 'personal'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'documents_storage_personal_insert'
  ) then
    create policy documents_storage_personal_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (storage.foldername(name))[2] = 'personal'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'documents_storage_personal_delete'
  ) then
    create policy documents_storage_personal_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (storage.foldername(name))[2] = 'personal'
      );
  end if;
end;
$migration$;

do $migration$
declare
  company_policy record;
begin
  for company_policy in
    select policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'document_storage_member_read',
        'document_storage_member_insert',
        'document_storage_member_delete',
        'documents_storage_member_select',
        'documents_storage_member_insert',
        'documents_storage_member_delete'
      )
  loop
    if company_policy.cmd in ('SELECT', 'DELETE') and company_policy.qual is not null then
      execute format(
        'alter policy %I on storage.objects using ((%s) and coalesce((storage.foldername(name))[2], '''') <> ''personal'')',
        company_policy.policyname,
        company_policy.qual
      );
    elsif company_policy.cmd = 'INSERT' and company_policy.with_check is not null then
      execute format(
        'alter policy %I on storage.objects with check ((%s) and coalesce((storage.foldername(name))[2], '''') <> ''personal'')',
        company_policy.policyname,
        company_policy.with_check
      );
    else
      raise exception 'Unexpected definition for existing company document Storage policy %.', company_policy.policyname;
    end if;
  end loop;
end;
$migration$;

commit;
