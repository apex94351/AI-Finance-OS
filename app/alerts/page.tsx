import { z } from "zod";
import { AlertsManager } from "@/database/components/alerts/alerts-manager";
import { AppShell } from "@/database/components/app-shell";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import type { InvoiceRecord } from "@/types/invoice";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  description: z.string().nullable(),
  issue_date: z.string().nullable(),
  due_date: z.string().nullable(),
  subtotal_ht: amountSchema,
  vat_amount: amountSchema,
  total_ttc: amountSchema,
  currency: z.string().nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
  created_at: z.string(),
  updated_at: z.string(),
}));

const invoiceColumns = "id, user_id, company_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_amount, total_ttc, currency, status, created_at, updated_at";

function mapInvoice(invoice: z.infer<typeof invoiceSchema>[number]): InvoiceRecord {
  return {
    id: invoice.id,
    userId: invoice.user_id,
    companyId: invoice.company_id,
    documentId: null,
    invoiceNumber: invoice.invoice_number,
    clientName: invoice.client_name,
    description: invoice.description,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    subtotal: invoice.subtotal_ht,
    vatRate: null,
    vatAmount: invoice.vat_amount,
    total: invoice.total_ttc,
    currency: invoice.currency,
    status: invoice.status,
    category: null,
    analysis: null,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

export default async function AlertsPage() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/alerts");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Alerts membership query failed", { code: membershipResult.error.code });
    return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." asOfDate={asOfDate} /></AppShell>;
  }
  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Alerts membership query returned an unexpected result");
    return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="La liste des espaces d’entreprise reçue est invalide." asOfDate={asOfDate} /></AppShell>;
  }

  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length) {
    const companyResult = await supabase.from("companies").select("id, name").in("id", companyIds);
    if (companyResult.error) {
      console.error("Alerts company query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Impossible de charger les espaces d’entreprise." asOfDate={asOfDate} /></AppShell>;
    }
    companyRows = companyResult.data;
  }
  const companies = companySchema.safeParse(companyRows);
  if (!companies.success) {
    console.error("Alerts company query returned an unexpected result");
    return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Les espaces d’entreprise reçus ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }

  const personalResult = await supabase.from("invoices")
    .select(invoiceColumns)
    .eq("user_id", user.id)
    .is("company_id", null);
  if (personalResult.error) {
    console.error("Personal alerts invoice query failed", { code: personalResult.error.code });
    return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Impossible de charger les alertes. Vérifiez le schéma des factures puis réessayez." asOfDate={asOfDate} /></AppShell>;
  }

  let companyInvoiceRows: unknown[] = [];
  if (companyIds.length) {
    const companyResult = await supabase.from("invoices")
      .select(invoiceColumns)
      .in("company_id", companyIds)
      .is("user_id", null);
    if (companyResult.error) {
      console.error("Company alerts invoice query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Impossible de charger les alertes. Vérifiez le schéma des factures puis réessayez." asOfDate={asOfDate} /></AppShell>;
    }
    companyInvoiceRows = companyResult.data;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalResult.data, ...companyInvoiceRows]);
  if (!parsedInvoices.success) {
    console.error("Alerts invoice query returned an unexpected result");
    return <AppShell pageTitle="alerts"><AlertsManager invoices={[]} loadError="Les factures reçues ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }

  return (
    <AppShell pageTitle="alerts">
      <AlertsManager
        invoices={parsedInvoices.data.map(mapInvoice)}
        companies={companies.data}
        loadError={null}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}
