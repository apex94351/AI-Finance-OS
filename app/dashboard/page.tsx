import { z } from "zod";
import { DashboardClient } from "@/database/components/dashboard/dashboard-client";
import { AppShell } from "@/database/components/app-shell";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { expenseRowSchema } from "@/services/expenses";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";
import type { InvoiceRecord } from "@/types/invoice";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({ id: z.uuid(), name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/) }));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  customer_id: z.uuid().nullable().optional(),
  supplier_id: z.uuid().nullable().optional(),
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
const invoiceColumnsWithParties = `${invoiceColumns}, customer_id, supplier_id`;
const contactNamesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const dashboardExpenseSchema = expenseRowSchema.pick({
  id: true,
  user_id: true,
  company_id: true,
  label: true,
  amount: true,
  currency: true,
  expense_date: true,
  category: true,
  supplier_id: true,
  status: true,
  notes: true,
  created_at: true,
  updated_at: true,
});
const expenseColumns = "id, user_id, company_id, label, amount, currency, expense_date, category, supplier_id, status, notes, created_at, updated_at";
type AuthenticatedSupabase = Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"];

async function queryInvoices(
  supabase: AuthenticatedSupabase,
  userId: string,
  companyIds: string[] | null,
) {
  async function select(columns: string) {
    const query = supabase.from("invoices").select(columns);
    return companyIds
      ? await query.in("company_id", companyIds).is("user_id", null)
      : await query.eq("user_id", userId).is("company_id", null);
  }

  const result = await select(invoiceColumnsWithParties);
  if (!result.error) {
    return { data: result.data as unknown[], error: null, hasPartyLinks: true };
  }
  if (!["42703", "PGRST204"].includes(result.error.code)) {
    return { data: [] as unknown[], error: result.error, hasPartyLinks: false };
  }

  const fallback = await select(invoiceColumns);
  return {
    data: (fallback.data ?? []) as unknown[],
    error: fallback.error,
    hasPartyLinks: false,
  };
}

function mapInvoice(invoice: z.infer<typeof invoiceSchema>[number], asOfDate: string): InvoiceRecord {
  const status = getEffectiveInvoiceStatus(invoice.status, invoice.due_date, new Date(`${asOfDate}T00:00:00Z`));
  return {
    id: invoice.id,
    userId: invoice.user_id,
    companyId: invoice.company_id,
    customerId: invoice.customer_id ?? null,
    supplierId: invoice.supplier_id ?? null,
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
    status,
    category: null,
    analysis: null,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

export default async function DashboardPage() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/dashboard");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Dashboard company membership query failed", { code: membershipResult.error.code });
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="Impossible de charger les espaces associés à votre compte." asOfDate={asOfDate} /></AppShell>;
  }

  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Dashboard company membership query returned an unexpected result");
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="La liste des espaces associés reçue est invalide." asOfDate={asOfDate} /></AppShell>;
  }

  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  let companyInfoRows: unknown[] = [];
  if (companyIds.length) {
    const companyResult = await supabase
      .from("companies")
      .select("id, name, currency")
      .in("id", companyIds);
    if (companyResult.error) {
      console.error("Dashboard company query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="Impossible de charger les entreprises associées à votre compte." asOfDate={asOfDate} /></AppShell>;
    }
    companyInfoRows = companyResult.data;
  }
  const companies = companySchema.safeParse(companyInfoRows);
  if (!companies.success) {
    console.error("Dashboard company query returned an unexpected result");
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="Les informations d’entreprise reçues sont invalides." asOfDate={asOfDate} /></AppShell>;
  }

  const personalResult = await queryInvoices(supabase, user.id, null);
  if (personalResult.error) {
    console.error("Dashboard personal invoice query failed", { code: personalResult.error.code });
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError={invoiceSchemaError(personalResult.error.code)} asOfDate={asOfDate} /></AppShell>;
  }

  let companyRows: unknown[] = [];
  let companyRowsHavePartyLinks = true;
  if (companyIds.length > 0) {
    const companyResult = await queryInvoices(supabase, user.id, companyIds);
    if (companyResult.error) {
      console.error("Dashboard company invoice query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError={invoiceSchemaError(companyResult.error.code)} asOfDate={asOfDate} /></AppShell>;
    }
    companyRows = companyResult.data;
    companyRowsHavePartyLinks = companyResult.hasPartyLinks;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalResult.data, ...companyRows]);
  if (!parsedInvoices.success) {
    console.error("Dashboard invoice query returned an unexpected result");
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="Les factures reçues ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }

  const companyCurrency = new Map(companies.data.map(({ id, currency }) => [id, currency]));
  const invoices = parsedInvoices.data.map((row) => {
    const invoice = mapInvoice(row, asOfDate);
    return {
      ...invoice,
      partyLinksAvailable: invoice.companyId ? companyRowsHavePartyLinks : personalResult.hasPartyLinks,
      currency: invoice.currency ?? companyCurrency.get(invoice.companyId ?? "") ?? null,
    };
  });
  const linkedCustomerIds = [...new Set(invoices.flatMap(({ customerId }) => customerId ? [customerId] : []))];
  const linkedSupplierIds = [...new Set(invoices.flatMap(({ supplierId }) => supplierId ? [supplierId] : []))];
  const [customers, suppliers] = await Promise.all([
    linkedCustomerIds.length ? supabase.from("customers").select("id, name").in("id", linkedCustomerIds) : null,
    linkedSupplierIds.length ? supabase.from("suppliers").select("id, name").in("id", linkedSupplierIds) : null,
  ]);
  const counterpartyNames: Record<string, string> = {};
  let partialDataWarning: string | null = null;
  for (const [kind, result] of [["client", customers], ["fournisseur", suppliers]] as const) {
    if (!result) continue;
    if (result.error) {
      console.error(`Dashboard ${kind} query failed`, { code: result.error.code });
      partialDataWarning = "Certains noms de tiers associés sont indisponibles.";
      continue;
    }
    const parsed = contactNamesSchema.safeParse(result.data);
    if (!parsed.success) {
      console.error(`Dashboard ${kind} query returned an unexpected result`);
      partialDataWarning = "Certains noms de tiers reçus ne sont pas au format attendu.";
      continue;
    }
    for (const contact of parsed.data) counterpartyNames[contact.id] = contact.name;
  }
  if (!companyRowsHavePartyLinks || !personalResult.hasPartyLinks) {
    partialDataWarning = "Les associations Clients/Fournisseurs ne sont pas disponibles dans le schéma chargé.";
  }

  const personalExpenseResult = await supabase.from("expenses")
    .select(expenseColumns)
    .eq("user_id", user.id)
    .is("company_id", null)
    .order("expense_date", { ascending: false });
  const companyExpenseResult = companyIds.length
    ? await supabase.from("expenses")
      .select(expenseColumns)
      .in("company_id", companyIds)
      .is("user_id", null)
      .order("expense_date", { ascending: false })
    : { data: [], error: null };
  const expenseQueryError = personalExpenseResult.error ?? companyExpenseResult.error;
  let expenses: z.infer<typeof dashboardExpenseSchema>[] = [];
  let expensesLoadError: string | null = null;
  if (expenseQueryError) {
    console.error("Dashboard expense query failed", { code: expenseQueryError.code });
    expensesLoadError = ["42P01", "42703", "PGRST204", "PGRST205"].includes(expenseQueryError.code ?? "")
      ? "Les dépenses sont indisponibles dans le schéma chargé."
      : "Impossible de charger les dépenses.";
  } else {
    const parsedExpenses = dashboardExpenseSchema.array().safeParse([
      ...(personalExpenseResult.data ?? []),
      ...(companyExpenseResult.data ?? []),
    ]);
    if (!parsedExpenses.success) {
      console.error("Dashboard expense query returned an unexpected result");
      expensesLoadError = "Les dépenses reçues ne sont pas au format attendu.";
    } else {
      expenses = parsedExpenses.data;
    }
  }

  return (
    <AppShell pageTitle="home">
      <DashboardClient
        invoices={invoices}
        expenses={expenses.map((expense) => ({
          id: expense.id,
          userId: expense.user_id,
          companyId: expense.company_id,
          label: expense.label,
          amount: typeof expense.amount === "number" ? expense.amount : Number(expense.amount),
          currency: expense.currency,
          expenseDate: expense.expense_date,
          category: expense.category,
          supplierId: expense.supplier_id,
          supplierName: null,
          status: expense.status,
          notes: expense.notes,
          createdAt: expense.created_at,
          updatedAt: expense.updated_at,
        }))}
        companies={companies.data}
        counterpartyNames={counterpartyNames}
        partyLinksAvailable={personalResult.hasPartyLinks && companyRowsHavePartyLinks}
        loadError={null}
        expensesLoadError={expensesLoadError}
        partialDataWarning={partialDataWarning}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}

function invoiceSchemaError(code: string) {
  return ["42703", "42P01", "PGRST204", "PGRST205", "22P02"].includes(code)
    ? "Le schéma Supabase ne correspond pas aux colonnes de factures attendues. Vérifiez les migrations déjà appliquées."
    : "Impossible de charger les données financières pour le moment.";
}
