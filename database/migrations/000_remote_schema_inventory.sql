-- Read-only inventory for the Supabase SQL Editor.
-- Run each SELECT separately and save the results before preparing migrations.
-- This file does not create, alter, or delete database objects or data.

-- 1. Confirm which expected public tables currently exist and their RLS flags.
with expected_tables(table_name) as (
  values
    ('profiles'),
    ('companies'),
    ('company_members'),
    ('documents'),
    ('invoices'),
    ('ai_analyses')
)
select
  expected_tables.table_name,
  (tables.oid is not null) as table_exists,
  tables.relrowsecurity as rls_enabled,
  tables.relforcerowsecurity as rls_forced
from expected_tables
left join pg_namespace as namespaces
  on namespaces.nspname = 'public'
left join pg_class as tables
  on tables.relnamespace = namespaces.oid
  and tables.relname = expected_tables.table_name
  and tables.relkind in ('r', 'p', 'v', 'm', 'f')
order by expected_tables.table_name;

-- 2. Inspect columns, types, nullability, and defaults on expected public tables.
select
  tables.table_name,
  columns.ordinal_position,
  columns.column_name,
  columns.data_type,
  columns.udt_name,
  columns.is_nullable,
  columns.column_default
from information_schema.tables as tables
join information_schema.columns as columns
  on columns.table_schema = tables.table_schema
  and columns.table_name = tables.table_name
where tables.table_schema = 'public'
  and tables.table_name in (
    'profiles',
    'companies',
    'company_members',
    'documents',
    'invoices',
    'ai_analyses'
  )
order by tables.table_name, columns.ordinal_position;

-- 3. Inspect primary keys, foreign keys, unique constraints, and checks.
select
  namespaces.nspname as schema_name,
  tables.relname as table_name,
  constraints.conname as constraint_name,
  constraints.contype as constraint_type,
  pg_get_constraintdef(constraints.oid, true) as definition
from pg_constraint as constraints
join pg_class as tables
  on tables.oid = constraints.conrelid
join pg_namespace as namespaces
  on namespaces.oid = tables.relnamespace
where namespaces.nspname = 'public'
  and tables.relname in (
    'profiles',
    'companies',
    'company_members',
    'documents',
    'invoices',
    'ai_analyses'
  )
order by tables.relname, constraints.conname;

-- 4. Inspect indexes on expected public tables.
select
  schemaname as schema_name,
  tablename as table_name,
  indexname as index_name,
  indexdef as definition
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles',
    'companies',
    'company_members',
    'documents',
    'invoices',
    'ai_analyses'
  )
order by tablename, indexname;

-- 5. Inspect existing RLS policies on expected public tables.
select
  schemaname as schema_name,
  tablename as table_name,
  policyname,
  permissive,
  roles,
  cmd as operation,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'companies',
    'company_members',
    'documents',
    'invoices',
    'ai_analyses'
  )
order by tablename, policyname;

-- 6. Inspect non-internal triggers and their function references.
select
  namespaces.nspname as schema_name,
  tables.relname as table_name,
  triggers.tgname as trigger_name,
  pg_get_triggerdef(triggers.oid, true) as definition,
  functions_ns.nspname as function_schema,
  functions.proname as function_name
from pg_trigger as triggers
join pg_class as tables
  on tables.oid = triggers.tgrelid
join pg_namespace as namespaces
  on namespaces.oid = tables.relnamespace
join pg_proc as functions
  on functions.oid = triggers.tgfoid
join pg_namespace as functions_ns
  on functions_ns.oid = functions.pronamespace
where not triggers.tgisinternal
  and (
    (namespaces.nspname = 'public' and tables.relname in (
      'profiles',
      'companies',
      'company_members',
      'documents',
      'invoices',
      'ai_analyses'
    ))
    or functions_ns.nspname = 'public'
  )
order by namespaces.nspname, tables.relname, triggers.tgname;

-- 7. Inspect relevant public function signatures, security mode, and settings.
select
  functions.proname as function_name,
  pg_get_function_identity_arguments(functions.oid) as arguments,
  pg_get_userbyid(functions.proowner) as owner_name,
  functions.prosecdef as security_definer,
  functions.proconfig as function_settings
from pg_proc as functions
join pg_namespace as namespaces
  on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public'
  and functions.proname in (
    'is_company_member',
    'is_company_owner',
    'add_company_owner_as_member'
  )
order by functions.proname, arguments;

-- 8. Inspect role/status enum labels if those types exist.
select
  namespaces.nspname as schema_name,
  types.typname as type_name,
  enum_labels.enumsortorder as sort_order,
  enum_labels.enumlabel as label
from pg_type as types
join pg_namespace as namespaces
  on namespaces.oid = types.typnamespace
join pg_enum as enum_labels
  on enum_labels.enumtypid = types.oid
where namespaces.nspname = 'public'
  and types.typname in ('company_member_role', 'invoice_status')
order by types.typname, enum_labels.enumsortorder;

-- 9. Inspect the documents Storage bucket, if the Storage schema is available.
select
  id,
  name,
  public as is_public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'documents' or name = 'documents';

-- 10. Inspect Storage object policies relevant to the documents bucket.
select
  schemaname as schema_name,
  tablename as table_name,
  policyname,
  permissive,
  roles,
  cmd as operation,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
