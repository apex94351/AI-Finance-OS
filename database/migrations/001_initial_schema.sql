create extension if not exists pgcrypto;

create type public.company_member_role as enum ('owner', 'admin', 'member');
create type public.invoice_status as enum ('pending', 'paid', 'overdue', 'receivable', 'cancelled');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  country text not null check (char_length(country) = 2),
  currency text not null check (char_length(currency) = 3),
  monthly_invoice_volume integer check (monthly_invoice_volume is null or monthly_invoice_volume >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  file_type text not null check (file_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null unique references public.documents(id) on delete restrict,
  document_type text not null default 'invoice',
  invoice_number text,
  issue_date date,
  due_date date,
  currency text check (currency is null or char_length(currency) = 3),
  supplier_name text,
  supplier_address text,
  supplier_email text,
  supplier_phone text,
  supplier_siret text,
  supplier_vat text,
  client_name text,
  client_address text,
  client_siret text,
  client_vat text,
  subtotal_ht numeric(14, 2) check (subtotal_ht is null or subtotal_ht >= 0),
  vat_amount numeric(14, 2) check (vat_amount is null or vat_amount >= 0),
  vat_rate numeric(5, 2) check (vat_rate is null or vat_rate between 0 and 100),
  discount numeric(14, 2) check (discount is null or discount >= 0),
  other_fees numeric(14, 2) check (other_fees is null or other_fees >= 0),
  total_ttc numeric(14, 2) check (total_ttc is null or total_ttc >= 0),
  iban text,
  payment_terms text,
  payment_method text,
  status public.invoice_status not null default 'pending',
  category text,
  ai_summary text,
  ai_confidence numeric(4, 3) check (ai_confidence is null or ai_confidence between 0 and 1),
  warnings jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  recommended_actions jsonb not null default '[]'::jsonb,
  important_deadline date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  provider text not null,
  model text,
  prompt_version text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index companies_owner_id_idx on public.companies(owner_id);
create index company_members_user_id_idx on public.company_members(user_id);
create index documents_company_id_idx on public.documents(company_id);
create index invoices_company_id_idx on public.invoices(company_id);
create index invoices_due_date_idx on public.invoices(company_id, due_date);
create index ai_analyses_document_id_idx on public.ai_analyses(document_id);

create or replace function public.is_company_member(target_company_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_owner(target_company_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.companies
    where id = target_company_id and owner_id = auth.uid()
  );
$$;

create or replace function public.add_company_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_members (company_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger companies_add_owner_member
  after insert on public.companies
  for each row execute function public.add_company_owner_as_member();

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.documents enable row level security;
alter table public.invoices enable row level security;
alter table public.ai_analyses enable row level security;

create policy profiles_self_access on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy companies_member_read on public.companies
  for select using (public.is_company_member(id) or owner_id = auth.uid());
create policy companies_owner_write on public.companies
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy members_member_read on public.company_members
  for select using (public.is_company_member(company_id));
create policy members_owner_write on public.company_members
  for all using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));

create policy documents_member_access on public.documents
  for all using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

create policy invoices_member_access on public.invoices
  for all using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

create policy analyses_member_access on public.ai_analyses
  for all using (
    exists (
      select 1 from public.documents
      where documents.id = ai_analyses.document_id
        and public.is_company_member(documents.company_id)
    )
  ) with check (
    exists (
      select 1 from public.documents
      where documents.id = ai_analyses.document_id
        and public.is_company_member(documents.company_id)
    )
  );

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy document_storage_member_read on storage.objects
  for select to authenticated using (
    bucket_id = 'documents'
    and public.is_company_member((storage.foldername(name))[1]::uuid)
  );

create policy document_storage_member_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'documents'
    and public.is_company_member((storage.foldername(name))[1]::uuid)
  );

create policy document_storage_member_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'documents'
    and public.is_company_member((storage.foldername(name))[1]::uuid)
  );