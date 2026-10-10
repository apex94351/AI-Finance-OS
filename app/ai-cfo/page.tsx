import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { AiCfoClient } from "@/database/components/ai-cfo/ai-cfo-client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { expenseRowSchema, mapExpense, expenseSupplierRowSchema } from "@/services/expenses";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceRecord } from "@/types/invoice";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceRowSchema = z.array(z.object({
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

type Supabase = Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"];
type QueryResult = { data: unknown[]; error: { code?: string } | null };

async function loadInvoiceRows(supabase: Supabase, userId: string, companyIds: string[] | null): Promise<QueryResult> {
  const columns = "id, user_id, company_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_amount, total_ttc, currency, status, created_at, updated_at";
  const runQuery = async (selectedColumns: string) => {
    const query = supabase.from("invoices").select(selectedColumns);
    return companyIds
      ? await query.in("company_id", companyIds).is("user_id", null)
      : await query.eq("user_id", userId).is("company_id", null);
  };
  const result = await runQuery(columns);
  return { data: (result.data ?? []) as unknown[], error: result.error };
}

function mapInvoice(row: z.infer<typeof invoiceRowSchema>[number]): InvoiceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    documentId: null,
    invoiceNumber: row.invoice_number,
    clientName: row.client_name,
    description: row.description,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: row.subtotal_ht,
    vatRate: null,
    vatAmount: row.vat_amount,
    total: row.total_ttc,
    currency: row.currency,
    status: row.status,
    category: null,
    analysis: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function queryErrorMessage(code?: string) {
  return ["42703", "42P01", "PGRST204", "PGRST205", "22P02"].includes(code ?? "")
    ? "Le schéma Supabase ne correspond pas aux données financières attendues. Vérifiez les migrations déjà appliquées."
    : "Impossible de charger ces données financières pour le moment.";
}

export default async function AiCfoPage() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/ai-cfo");
  const membershipResult = await supabase.from("company_members").select("company_id").eq("user_id", user.id);
  if (membershipResult.error) {
    console.error("AI CFO membership query failed", { code: membershipResult.error.code });
    return <AppShell pageTitle="aiCfo"><AiCfoClient invoices={[]} expenses={[]} companies={[]} invoiceError="Impossible de vérifier les espaces associés à votre compte." expenseError="Les dépenses ne sont pas chargées car les espaces n’ont pas pu être vérifiés." asOfDate={asOfDate} /></AppShell>;
  }
  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("AI CFO membership query returned an unexpected result");
    return <AppShell pageTitle="aiCfo"><AiCfoClient invoices={[]} expenses={[]} companies={[]} invoiceError="La liste des espaces associés reçue est invalide." expenseError="Les dépenses ne sont pas chargées car les espaces n’ont pas pu être vérifiés." asOfDate={asOfDate} /></AppShell>;
  }

  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  const [companyResult, personalInvoiceResult] = await Promise.all([
    companyIds.length
      ? supabase.from("companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    loadInvoiceRows(supabase, user.id, null),
  ]);
  const parsedCompanies = companySchema.safeParse(companyResult.data ?? []);
  const companies = parsedCompanies.success ? parsedCompanies.data : [];
  let invoiceError: string | null = null;
  let invoices: InvoiceRecord[] = [];
  let companyRows: unknown[] = [];
  if (companyResult.error || !parsedCompanies.success) {
    console.error("AI CFO company query failed", { code: companyResult.error?.code });
  }
  if (personalInvoiceResult.error) {
    console.error("AI CFO personal invoice query failed", { code: personalInvoiceResult.error.code });
    invoiceError = queryErrorMessage(personalInvoiceResult.error.code);
  } else {
    const companyInvoiceResult = companyIds.length
      ? await loadInvoiceRows(supabase, user.id, companyIds)
      : { data: [], error: null };
    if (companyInvoiceResult.error) {
      console.error("AI CFO company invoice query failed", { code: companyInvoiceResult.error.code });
      invoiceError = queryErrorMessage(companyInvoiceResult.error.code);
    } else {
      companyRows = companyInvoiceResult.data;
      const parsed = invoiceRowSchema.safeParse([...personalInvoiceResult.data, ...companyRows]);
      if (!parsed.success) {
        console.error("AI CFO invoice query returned an unexpected result");
        invoiceError = "Les factures reçues ne sont pas au format attendu.";
      } else {
        invoices = parsed.data.map(mapInvoice);
      }
    }
  }

  let expenses: ExpenseRecord[] = [];
  let expenseError: string | null = null;
  const expenseColumns = "id, user_id, company_id, label, amount, currency, expense_date, category, supplier_id, status, notes, created_at, updated_at";
  const [personalExpenses, companyExpenses] = await Promise.all([
    supabase.from("expenses").select(expenseColumns).eq("user_id", user.id).is("company_id", null),
    companyIds.length
      ? supabase.from("expenses").select(expenseColumns).in("company_id", companyIds).is("user_id", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const expenseQueryError = personalExpenses.error ?? companyExpenses.error;
  if (expenseQueryError) {
    console.error("AI CFO expense query failed", { code: expenseQueryError.code });
    expenseError = ["42P01", "42703", "PGRST205"].includes(expenseQueryError.code ?? "")
      ? "La table des dépenses n’est pas disponible. Vérifiez manuellement l’application de la migration 009_expenses.sql ; aucune donnée de dépense n’est supposée."
      : queryErrorMessage(expenseQueryError.code);
  } else {
    const parsedExpenseRows = z.array(expenseRowSchema).safeParse([
      ...(personalExpenses.data ?? []),
      ...(companyExpenses.data ?? []),
    ]);
    if (!parsedExpenseRows.success) {
      console.error("AI CFO expense query returned an unexpected result");
      expenseError = "Les dépenses reçues ne sont pas au format attendu.";
    } else {
      const supplierIds = [...new Set(parsedExpenseRows.data.flatMap(({ supplier_id }) => supplier_id ? [supplier_id] : []))];
      let suppliers: z.infer<typeof expenseSupplierRowSchema>[] = [];
      if (supplierIds.length) {
        const supplierResult = await supabase.from("suppliers")
          .select("id, user_id, company_id, name").in("id", supplierIds);
        const parsedSuppliers = z.array(expenseSupplierRowSchema).safeParse(supplierResult.data ?? []);
        if (!supplierResult.error && parsedSuppliers.success) suppliers = parsedSuppliers.data;
        else console.error("AI CFO expense supplier lookup failed", { code: supplierResult.error?.code });
      }
      expenses = parsedExpenseRows.data.map((row) => mapExpense(row, suppliers));
    }
  }

  return (
    <AppShell pageTitle="aiCfo">
      <AiCfoClient
        invoices={invoices}
        expenses={expenses}
        companies={companies}
        invoiceError={invoiceError}
        expenseError={expenseError}
        companyWarning={companyResult.error || !parsedCompanies.success ? "Les noms des espaces ne sont pas disponibles." : null}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}
