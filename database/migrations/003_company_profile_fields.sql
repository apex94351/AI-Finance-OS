-- Add profile details to the existing companies table.
-- The existing name, country, and currency columns are reused; no tables or
-- access policies are created or changed by this migration.

begin;

alter table public.companies
  add column if not exists trade_name text,
  add column if not exists legal_form text,
  add column if not exists siret text,
  add column if not exists siren text,
  add column if not exists vat_number text,
  add column if not exists industry text,
  add column if not exists address text,
  add column if not exists address_complement text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists registration_number text;

commit;
