-- Secure private document metadata and Storage setup.
-- Apply manually only after confirming the target schema and migration history.

begin;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  file_type text not null check (file_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.documents enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

do $migration$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_member_select'
  ) then
    create policy documents_member_select on public.documents
      for select to authenticated
      using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_member_insert'
  ) then
    create policy documents_member_insert on public.documents
      for insert to authenticated
      with check (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_member_update'
  ) then
    create policy documents_member_update on public.documents
      for update to authenticated
      using (public.is_company_member(company_id))
      with check (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_storage_member_select'
  ) then
    create policy documents_storage_member_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'documents'
        and public.is_company_member((storage.foldername(name))[1]::uuid)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_storage_member_insert'
  ) then
    create policy documents_storage_member_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'documents'
        and public.is_company_member((storage.foldername(name))[1]::uuid)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_storage_member_delete'
  ) then
    create policy documents_storage_member_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'documents'
        and public.is_company_member((storage.foldername(name))[1]::uuid)
      );
  end if;
end;
$migration$;

grant select, insert, update on table public.documents to authenticated;
revoke all on table public.documents from public, anon;

commit;
