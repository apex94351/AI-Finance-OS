-- Requires the existing public.companies and public.company_members tables,
-- the public.company_role enum, and an executor with BYPASSRLS. Apply manually
-- only after confirming those prerequisites.
-- This migration adds RPCs only; it does not alter tables or existing data.

begin;

create function public.create_company_for_current_user(p_name text)
returns table (company_id uuid, company_name text)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  requesting_user_id uuid := auth.uid();
  new_company_id uuid;
  normalized_company_name text;
begin
  if requesting_user_id is null then
    raise exception 'Authentication is required to create a company.'
      using errcode = '28000';
  end if;

  if p_name is null then
    raise exception 'Company name must contain between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  normalized_company_name := pg_catalog.regexp_replace(
    p_name,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );

  if pg_catalog.char_length(normalized_company_name) not between 1 and 160 then
    raise exception 'Company name must contain between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  insert into public.companies (name)
  values (normalized_company_name)
  returning id into new_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_company_id, requesting_user_id, 'owner'::public.company_role)
  on conflict (company_id, user_id)
  do update set role = excluded.role;

  return query
  select new_company_id, company.name
  from public.companies as company
  where company.id = new_company_id;
end;
$function$;

revoke all on function public.create_company_for_current_user(text)
  from public, anon, authenticated;
grant execute on function public.create_company_for_current_user(text)
  to authenticated;

create function public.get_my_companies()
returns table (company_id uuid, company_name text, role text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $function$
  select company.id, company.name, membership.role::text
  from public.company_members as membership
  join public.companies as company
    on company.id = membership.company_id
  where auth.uid() is not null
    and membership.user_id = auth.uid()
  order by company.name, company.id;
$function$;

revoke all on function public.get_my_companies()
  from public, anon, authenticated;
grant execute on function public.get_my_companies()
  to authenticated;

commit;
