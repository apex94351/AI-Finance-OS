-- Extend the existing invoice status enum. Apply this file before 005.
alter type public.invoice_status add value if not exists 'draft';
