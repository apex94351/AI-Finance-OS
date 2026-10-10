import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { DeadlineManager } from "@/database/components/due-dates/deadline-manager";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import type { DueDateRecord } from "@/services/due-dates";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceSchema = z.array(z.object({
  id: z.uuid(),
  company_id: z.uuid().nullable(),
  customer_id: z.uuid().nullable().optional(),
  supplier_id: z.uuid().nullable().optional(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  due_date: z.string().nullable(),
  total_ttc: amountSchema,
  currency: z.string().nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
}));
const contactNamesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));

const invoiceColumns = "id, company_id, invoice_number, client_name, due_date, total_ttc, currency, status";
const invoiceColumnsWithParties = `${invoiceColumns}, customer_id, supplier_id`;
type AuthenticatedSupabase = Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"];

async function queryInvoices(supabase: AuthenticatedSupabase, userId: string, companyIds: string[] | null) {
  async function select(columns: string) {
    const query = supabase.from("invoices").select(columns);
    return companyIds
      ? await query.in("company_id", companyIds).is("user_id", null)
      : await query.eq("user_id", userId).is("company_id", null);
  }

  const result = await select(invoiceColumnsWithParties);
  if (!result.error) return { data: result.data as unknown[], error: null, hasPartyLinks: true };
  if (!["42703", "PGRST204"].includes(result.error.code)) {
    return { data: [] as unknown[], error: result.error, hasPartyLinks: false };
  }
  const fallback = await select(invoiceColumns);
  return { data: (fallback.data ?? []) as unknown[], error: fallback.error, hasPartyLinks: false };
}

function mapInvoice(invoice: z.infer<typeof invoiceSchema>[number]): DueDateRecord {
  return {
    id: invoice.id,
    companyId: invoice.company_id,
    customerId: invoice.customer_id ?? null,
    supplierId: invoice.supplier_id ?? null,
    invoiceNumber: invoice.invoice_number,
    clientName: invoice.client_name,
    dueDate: invoice.due_date,
    total: invoice.total_ttc,
    currency: invoice.currency,
    status: invoice.status,
  };
}

export default async function DueDatesPage() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/due-dates");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Due date membership query failed", { code: membershipResult.error.code });
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." asOfDate={asOfDate} /></AppShell>;
  }
  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Due date membership query returned an unexpected result");
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="La liste des espaces d’entreprise reçue est invalide." asOfDate={asOfDate} /></AppShell>;
  }

  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length) {
    const companyResult = await supabase.from("companies").select("id, name").in("id", companyIds);
    if (companyResult.error) {
      console.error("Due date company query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de charger les espaces d’entreprise." asOfDate={asOfDate} /></AppShell>;
    }
    companyRows = companyResult.data;
  }
  const companies = companySchema.safeParse(companyRows);
  if (!companies.success) {
    console.error("Due date company query returned an unexpected result");
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Les espaces d’entreprise reçus ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }

  const personalResult = await queryInvoices(supabase, user.id, null);
  if (personalResult.error) {
    console.error("Personal due date query failed", { code: personalResult.error.code });
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de charger les échéances pour le moment. Vérifiez le schéma des factures puis réessayez." asOfDate={asOfDate} /></AppShell>;
  }
  let companyRowsForInvoices: unknown[] = [];
  let companyHasPartyLinks = true;
  if (companyIds.length) {
    const companyResult = await queryInvoices(supabase, user.id, companyIds);
    if (companyResult.error) {
      console.error("Company due date query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de charger les échéances pour le moment. Vérifiez le schéma des factures puis réessayez." asOfDate={asOfDate} /></AppShell>;
    }
    companyRowsForInvoices = companyResult.data;
    companyHasPartyLinks = companyResult.hasPartyLinks;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalResult.data, ...companyRowsForInvoices]);
  if (!parsedInvoices.success) {
    console.error("Due date query returned an unexpected result");
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Les échéances reçues ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }
  const invoices = parsedInvoices.data.map(mapInvoice);
  const customerIds = [...new Set(invoices.flatMap(({ customerId }) => customerId ? [customerId] : []))];
  const supplierIds = [...new Set(invoices.flatMap(({ supplierId }) => supplierId ? [supplierId] : []))];
  const [customers, suppliers] = await Promise.all([
    customerIds.length ? supabase.from("customers").select("id, name").in("id", customerIds) : null,
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : null,
  ]);
  const counterpartyNames: Record<string, string> = {};
  let partialDataWarning: string | null = null;
  for (const [label, result] of [["client", customers], ["fournisseur", suppliers]] as const) {
    if (!result) continue;
    const parsed = result.error ? null : contactNamesSchema.safeParse(result.data);
    if (!parsed?.success) {
      console.error(`Due date ${label} query failed`, { code: result.error?.code ?? "INVALID_RESULT" });
      partialDataWarning = "Certains noms de tiers sont indisponibles.";
      continue;
    }
    for (const contact of parsed.data) counterpartyNames[contact.id] = contact.name;
  }
  if (!personalResult.hasPartyLinks || !companyHasPartyLinks) {
    partialDataWarning = "Les liens Clients/Fournisseurs ne sont pas disponibles dans le schéma chargé.";
  }

  return (
    <AppShell pageTitle="dueDates">
      <DeadlineManager
        invoices={invoices}
        companies={companies.data}
        counterpartyNames={counterpartyNames}
        loadError={null}
        partialDataWarning={partialDataWarning}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}
