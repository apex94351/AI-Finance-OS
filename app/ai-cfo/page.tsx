import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { AiCfoClient } from "@/database/components/ai-cfo/ai-cfo-client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { expenseRowSchema, mapExpense, expenseSupplierRowSchema } from "@/services/expenses";
import { getInvoiceDirection, getVerifiedInvoiceSourceDocumentCategory } from "@/services/invoice-validation";
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
  invoice_type: z.enum(["customer", "supplier"]).nullable().optional(),
  customer_id: z.uuid().nullable().optional(),
  supplier_id: z.uuid().nullable().optional(),
  document_id: z.uuid().nullable().optional(),
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
const customerPaymentRowsSchema = z.array(z.object({ invoice_id: z.uuid(), amount: amountSchema.unwrap() }));
const linkedSupplierExpenseRowsSchema = z.array(z.object({ id: z.uuid(), invoice_id: z.uuid(), status: z.enum(["pending", "paid", "overdue", "cancelled"]) }));
const supplierPaymentRowsSchema = z.array(z.object({ expense_id: z.uuid(), amount: amountSchema.unwrap() }));
const sourceDocumentRowsSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  category: z.string(),
}));

type Supabase = Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"];
type QueryResult = { data: unknown[]; error: { code?: string } | null; hasInvoiceType: boolean };

async function loadInvoiceRows(supabase: Supabase, userId: string, companyIds: string[] | null): Promise<QueryResult> {
  const columns = "id, user_id, company_id, invoice_type, customer_id, supplier_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_amount, total_ttc, currency, status, created_at, updated_at";
  const legacyColumns = columns.replace("invoice_type, ", "");
  const runQuery = async (selectedColumns: string) => {
    const query = supabase.from("invoices").select(selectedColumns);
    return companyIds
      ? await query.in("company_id", companyIds).is("user_id", null)
      : await query.eq("user_id", userId).is("company_id", null);
  };
  const result = await runQuery(columns);
  if (!result.error) return { data: (result.data ?? []) as unknown[], error: null, hasInvoiceType: true };
  if (!["42703", "PGRST204"].includes(result.error.code ?? "")) {
    return { data: [], error: result.error, hasInvoiceType: false };
  }
  const fallback = await runQuery(legacyColumns);
  return { data: (fallback.data ?? []) as unknown[], error: fallback.error, hasInvoiceType: false };
}

function mapInvoice(
  row: z.infer<typeof invoiceRowSchema>[number],
  sourceDocumentCategory: "customer_invoice" | "supplier_invoice" | null = null,
): InvoiceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    invoiceType: row.invoice_type,
    sourceDocumentCategory,
    customerId: row.customer_id ?? null,
    supplierId: row.supplier_id ?? null,
    documentId: row.document_id ?? null,
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

async function loadFinancialInvoices(supabase: Supabase, userId: string, companyIds: string[]) {
  const personal = await loadInvoiceRows(supabase, userId, null);
  if (personal.error) return { invoices: [] as InvoiceRecord[], error: queryErrorMessage(personal.error.code), warning: null };
  const company = companyIds.length
    ? await loadInvoiceRows(supabase, userId, companyIds)
    : { data: [], error: null, hasInvoiceType: personal.hasInvoiceType };
  if (company.error) return { invoices: [] as InvoiceRecord[], error: queryErrorMessage(company.error.code), warning: null };
  const parsed = invoiceRowSchema.safeParse([...personal.data, ...company.data]);
  if (!parsed.success) return { invoices: [] as InvoiceRecord[], error: "Les factures reçues ne sont pas au format attendu.", warning: null };

  const warnings: string[] = [];
  if (!personal.hasInvoiceType || !company.hasInvoiceType) {
    warnings.push("La migration 017 n’est pas installée ; les types sont résolus seulement par les tiers ou documents explicitement liés.");
  }
  const documentIds = [...new Set(parsed.data.flatMap(({ document_id }) => document_id ? [document_id] : []))];
  const categoriesByInvoice = new Map<string, "customer_invoice" | "supplier_invoice">();
  if (documentIds.length) {
    const documentsResult = await supabase.from("documents").select("id, user_id, company_id, category").in("id", documentIds);
    const documents = sourceDocumentRowsSchema.safeParse(documentsResult.data ?? []);
    if (documentsResult.error || !documents.success) {
      warnings.push("Les types de documents sources ne sont pas disponibles pour qualifier certaines factures.");
    } else {
      for (const row of parsed.data) {
        if (!row.document_id) continue;
        const document = documents.data.find(({ id }) => id === row.document_id);
        if (!document) continue;
        const category = getVerifiedInvoiceSourceDocumentCategory({
          documentId: row.document_id,
          userId: row.user_id,
          companyId: row.company_id,
        }, {
          id: document.id,
          userId: document.user_id,
          companyId: document.company_id,
          category: document.category,
        });
        if (category) categoriesByInvoice.set(row.id, category);
      }
    }
  }
  let invoices = parsed.data.map((row) => mapInvoice(row, categoriesByInvoice.get(row.id) ?? null));
  const invoiceIds = invoices.map(({ id }) => id);

  const customerPaymentsResult = invoiceIds.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  const customerPayments = customerPaymentRowsSchema.safeParse(customerPaymentsResult.data ?? []);
  const customerLedgerMissing = Boolean(customerPaymentsResult.error
    && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(customerPaymentsResult.error.code ?? ""));
  const customerPaymentsAvailable = !customerPaymentsResult.error && customerPayments.success;
  if (!customerPaymentsAvailable) {
    warnings.push(customerLedgerMissing
      ? "Les paiements clients partiels nécessitent la migration 017 ; les factures existantes restent analysées selon leur statut enregistré."
      : "Le registre des paiements clients est inaccessible ; les soldes concernés sont à vérifier.");
  }
  const paidByInvoice = new Map<string, number>();
  if (customerPaymentsAvailable) {
    for (const payment of customerPayments.data) {
      paidByInvoice.set(payment.invoice_id, Math.round(((paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount) * 100) / 100);
    }
  }

  const supplierInvoiceIds = invoices.flatMap((invoice) => getInvoiceDirection(invoice) === "supplier" ? [invoice.id] : []);
  const linkedExpensesResult = supplierInvoiceIds.length
    ? await supabase.from("expenses").select("id, invoice_id, status").in("invoice_id", supplierInvoiceIds)
    : { data: [], error: null };
  const linkedExpenses = linkedSupplierExpenseRowsSchema.safeParse(linkedExpensesResult.data ?? []);
  const linkedExpensesAvailable = !linkedExpensesResult.error && linkedExpenses.success;
  if (!linkedExpensesAvailable) warnings.push("Les dépenses liées aux factures fournisseurs ne sont pas disponibles ; leurs soldes sont à vérifier.");
  const supplierExpenseRows = linkedExpensesAvailable ? linkedExpenses.data : [];
  const expenseIds = supplierExpenseRows.map(({ id }) => id);
  const supplierPaymentsResult = expenseIds.length
    ? await supabase.from("expense_payments").select("expense_id, amount").in("expense_id", expenseIds)
    : { data: [], error: null };
  const supplierPayments = supplierPaymentRowsSchema.safeParse(supplierPaymentsResult.data ?? []);
  const supplierPaymentsAvailable = !supplierPaymentsResult.error && supplierPayments.success;
  if (!supplierPaymentsAvailable) warnings.push("L’historique des paiements fournisseurs n’est pas disponible ; leurs soldes sont à vérifier.");
  const paidByExpense = new Map<string, number>();
  if (supplierPaymentsAvailable) {
    for (const payment of supplierPayments.data) {
      paidByExpense.set(payment.expense_id, Math.round(((paidByExpense.get(payment.expense_id) ?? 0) + payment.amount) * 100) / 100);
    }
  }
  const paidBySupplierInvoice = new Map<string, number>();
  for (const expense of supplierExpenseRows) {
    const invoiceTotal = invoices.find(({ id }) => id === expense.invoice_id)?.total ?? 0;
    const amount = expense.status === "paid" ? invoiceTotal : paidByExpense.get(expense.id) ?? 0;
    paidBySupplierInvoice.set(expense.invoice_id, Math.round(((paidBySupplierInvoice.get(expense.invoice_id) ?? 0) + amount) * 100) / 100);
  }

  invoices = invoices.map((invoice) => {
    const direction = getInvoiceDirection(invoice);
    const paidAmount = invoice.status === "paid" ? invoice.total ?? 0
      : direction === "customer"
        ? customerPaymentsAvailable || customerLedgerMissing ? paidByInvoice.get(invoice.id) ?? 0 : null
        : direction === "supplier"
          ? linkedExpensesAvailable && supplierPaymentsAvailable ? paidBySupplierInvoice.get(invoice.id) ?? 0 : null
          : 0;
    return { ...invoice, paidAmount };
  });
  return { invoices, error: null, warning: warnings.length ? [...new Set(warnings)].join(" ") : null };
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
  const companyResult = companyIds.length
    ? await supabase.from("companies").select("id, name").in("id", companyIds)
    : { data: [], error: null };
  const parsedCompanies = companySchema.safeParse(companyResult.data ?? []);
  const companies = parsedCompanies.success ? parsedCompanies.data : [];
  let invoiceError: string | null = null;
  let invoices: InvoiceRecord[] = [];
  let invoiceWarning: string | null = null;
  if (companyResult.error || !parsedCompanies.success) {
    console.error("AI CFO company query failed", { code: companyResult.error?.code });
  }
  const invoiceData = await loadFinancialInvoices(supabase, user.id, companyIds);
  invoices = invoiceData.invoices;
  invoiceError = invoiceData.error;
  invoiceWarning = invoiceData.warning;

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
        invoiceWarning={invoiceWarning}
        expenseError={expenseError}
        companyWarning={companyResult.error || !parsedCompanies.success ? "Les noms des espaces ne sont pas disponibles." : null}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}
