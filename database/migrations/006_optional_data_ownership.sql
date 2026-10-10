-- Add personal ownership for invoices while retaining company-scoped rows.
-- Existing invoices keep their company_id and remain covered by the original
-- company-membership policy.

begin;

alter table public.invoices
  alter column company_id drop not null,
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.invoices
  add constraint invoices_single_owner
  check (
    (user_id is not null and company_id is null)
    or (user_id is null and company_id is not null)
  ) not valid;

create policy invoices_personal_owner_access on public.invoices
  for all to authenticated
  using (user_id = (select auth.uid()) and company_id is null)
  with check (user_id = (select auth.uid()) and company_id is null);

create index if not exists invoices_user_status_issue_date_idx
  on public.invoices (user_id, status, issue_date desc)
  where user_id is not null;

commit;
