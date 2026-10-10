-- Reuse the existing invoices table for manually entered invoices.
-- Existing document-backed invoices remain supported; manual invoices have
-- document_id = NULL and use the owner-specific RLS policies.

begin;

alter table public.invoices
  alter column document_id drop not null,
  add column if not exists description text;

alter table public.invoices
  add constraint invoices_manual_required_fields
  check (
    document_id is not null
    or (
      client_name is not null
      and char_length(trim(client_name)) > 0
      and description is not null
      and char_length(trim(description)) > 0
      and issue_date is not null
      and due_date is not null
      and subtotal_ht is not null
      and vat_rate is not null
      and vat_amount is not null
      and total_ttc is not null
      and (status = 'draft' or (invoice_number is not null and char_length(trim(invoice_number)) > 0))
    )
  ) not valid;

alter table public.invoices
  add constraint invoices_coherent_manual_dates
  check (
    document_id is not null
    or due_date >= issue_date
  ) not valid;

alter table public.invoices
  add constraint invoices_coherent_manual_amounts
  check (
    document_id is not null
    or round(subtotal_ht - coalesce(discount, 0) + vat_amount + coalesce(other_fees, 0), 2) = total_ttc
  ) not valid;

create index if not exists invoices_company_status_issue_date_idx
  on public.invoices (company_id, status, issue_date desc);

commit;
