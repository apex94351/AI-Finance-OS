import { z } from "zod";
import { DashboardClient } from "@/database/components/dashboard/dashboard-client";
import { AppShell } from "@/database/components/app-shell";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import type { DashboardExpensePayment, DashboardInvoicePayment } from "@/services/dashboard";
import { expenseRowSchema } from "@/services/expenses";
import { getEffectiveInvoiceStatus, getInvoiceDirection, getInvoiceRemainingAmount, getVerifiedInvoiceSourceDocumentCategory } from "@/services/invoice-validation";
import type { InvoiceRecord } from "@/types/invoice";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({ id: z.uuid(), name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/) }));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const paymentAmountSchema = z.union([
  z.number(),
  z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number),
]).refine((amount) => Number.isFinite(amount) && amount > 0);
const invoicePaymentRowsSchema = z.array(z.object({
  invoice_id: z.uuid(),
  amount: paymentAmountSchema,
  payment_date: z.iso.date(),
}));
const expensePaymentRowsSchema = z.array(z.object({
  expense_id: z.uuid(),
  amount: paymentAmountSchema,
  payment_date: z.iso.date(),
}));
const linkedSupplierExpenseRowsSchema = z.array(z.object({
  id: z.uuid(),
  invoice_id: z.uuid(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
}));
const invoiceSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  invoice_type: z.enum(["customer", "supplier"]).nullable().optional(),
  document_id: z.uuid().nullable().optional(),
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

const invoiceColumns = "id, user_id, company_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_amount, total_ttc, currency, status, created_at, updated_at";
const invoiceColumnsWithParties = `${invoiceColumns}, customer_id, supplier_id, invoice_type`;
const invoiceColumnsPartyOnly = `${invoiceColumns}, customer_id, supplier_id`;
const sourceDocumentRowsSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  category: z.string(),
}));
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
    return { data: result.data as unknown[], error: null, hasPartyLinks: true, hasInvoiceType: true };
  }
  if (!["42703", "PGRST204"].includes(result.error.code)) {
    return { data: [] as unknown[], error: result.error, hasPartyLinks: false, hasInvoiceType: false };
  }

  const partiesFallback = await select(invoiceColumnsPartyOnly);
  if (!partiesFallback.error) {
    return { data: partiesFallback.data as unknown[], error: null, hasPartyLinks: true, hasInvoiceType: false };
  }
  const fallback = await select(invoiceColumns);
  return {
    data: (fallback.data ?? []) as unknown[],
    error: fallback.error,
    hasPartyLinks: false,
    hasInvoiceType: false,
  };
}

function mapInvoice(
  invoice: z.infer<typeof invoiceSchema>[number],
  asOfDate: string,
  sourceDocumentCategory: "customer_invoice" | "supplier_invoice" | null = null,
): InvoiceRecord {
  const status = getEffectiveInvoiceStatus(invoice.status, invoice.due_date, new Date(`${asOfDate}T00:00:00Z`));
  return {
    id: invoice.id,
    userId: invoice.user_id,
    companyId: invoice.company_id,
    invoiceType: invoice.invoice_type ?? null,
    sourceDocumentCategory,
    customerId: invoice.customer_id ?? null,
    supplierId: invoice.supplier_id ?? null,
    documentId: invoice.document_id ?? null,
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
  let companyRowsHaveInvoiceType = true;
  if (companyIds.length > 0) {
    const companyResult = await queryInvoices(supabase, user.id, companyIds);
    if (companyResult.error) {
      console.error("Dashboard company invoice query failed", { code: companyResult.error.code });
      return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError={invoiceSchemaError(companyResult.error.code)} asOfDate={asOfDate} /></AppShell>;
    }
    companyRows = companyResult.data;
    companyRowsHavePartyLinks = companyResult.hasPartyLinks;
    companyRowsHaveInvoiceType = companyResult.hasInvoiceType;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalResult.data, ...companyRows]);
  if (!parsedInvoices.success) {
    console.error("Dashboard invoice query returned an unexpected result");
    return <AppShell pageTitle="home"><DashboardClient invoices={[]} loadError="Les factures reçues ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }

  const documentIds = [...new Set(parsedInvoices.data.flatMap(({ document_id }) => document_id ? [document_id] : []))];
  const sourceCategoryByInvoice = new Map<string, "customer_invoice" | "supplier_invoice">();
  let sourceDocumentWarning: string | null = null;
  if (documentIds.length) {
    const documentResult = await supabase.from("documents").select("id, user_id, company_id, category").in("id", documentIds);
    const documents = sourceDocumentRowsSchema.safeParse(documentResult.data ?? []);
    if (documentResult.error || !documents.success) {
      console.error("Dashboard invoice document category query failed", { code: documentResult.error?.code ?? "INVALID_RESULT" });
      sourceDocumentWarning = "Les catégories des documents sources sont momentanément indisponibles.";
    } else {
      for (const invoice of parsedInvoices.data) {
        if (!invoice.document_id) continue;
        const document = documents.data.find(({ id }) => id === invoice.document_id);
        if (!document) continue;
        const category = getVerifiedInvoiceSourceDocumentCategory({
          documentId: invoice.document_id,
          userId: invoice.user_id,
          companyId: invoice.company_id,
        }, {
          id: document.id,
          userId: document.user_id,
          companyId: document.company_id,
          category: document.category,
        });
        if (category) sourceCategoryByInvoice.set(invoice.id, category);
      }
    }
  }

  const companyCurrency = new Map(companies.data.map(({ id, currency }) => [id, currency]));
  let invoices: InvoiceRecord[] = parsedInvoices.data.map((row) => {
    const invoice = mapInvoice(row, asOfDate, sourceCategoryByInvoice.get(row.id) ?? null);
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
  let partialDataWarning: string | null = sourceDocumentWarning;
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

  const invoiceIds = invoices.map(({ id }) => id);
  const customerPaymentsResult = invoiceIds.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount, payment_date").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  const paymentLedgerUnavailable = Boolean(customerPaymentsResult.error
    && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(customerPaymentsResult.error.code ?? ""));
  if (customerPaymentsResult.error && !paymentLedgerUnavailable) {
    console.error("Dashboard invoice payment query failed", { code: customerPaymentsResult.error.code });
    partialDataWarning = [partialDataWarning, "Les paiements des factures sont momentanément indisponibles."]
      .filter(Boolean).join(" ");
  }
  if (paymentLedgerUnavailable || !personalResult.hasInvoiceType || !companyRowsHaveInvoiceType) {
    partialDataWarning = [partialDataWarning, "Appliquez la migration 017 pour charger les paiements partiels et le sens explicite des factures."]
      .filter(Boolean).join(" ");
  }
  const parsedCustomerPayments = invoicePaymentRowsSchema.safeParse(
    customerPaymentsResult.error ? [] : customerPaymentsResult.data ?? [],
  );
  const customerPaymentsAvailable = !customerPaymentsResult.error && parsedCustomerPayments.success;
  if (!customerPaymentsResult.error && !parsedCustomerPayments.success) {
    console.error("Dashboard invoice payment query returned an unexpected result");
    partialDataWarning = [partialDataWarning, "Les paiements clients reçus ne sont pas au format attendu."]
      .filter(Boolean).join(" ");
  }
  const paidByInvoice = new Map<string, number>();
  const customerPaymentEvents: DashboardInvoicePayment[] = [];
  for (const payment of parsedCustomerPayments.success ? parsedCustomerPayments.data : []) {
    paidByInvoice.set(payment.invoice_id, Math.round(((paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount) * 100) / 100);
    customerPaymentEvents.push({
      invoiceId: payment.invoice_id,
      paymentDate: payment.payment_date,
      amount: payment.amount,
    });
  }

  const supplierInvoiceIds = invoices.flatMap((invoice) => (
    getInvoiceDirection(invoice) === "supplier" ? [invoice.id] : []
  ));
  const linkedExpensesResult = supplierInvoiceIds.length
    ? await supabase.from("expenses").select("id, invoice_id, status").in("invoice_id", supplierInvoiceIds)
    : { data: [], error: null };
  const parsedLinkedExpenses = linkedSupplierExpenseRowsSchema.safeParse(
    linkedExpensesResult.error ? [] : linkedExpensesResult.data ?? [],
  );
  const paidBySupplierInvoice = new Map<string, number>();
  const supplierExpenseIds = new Set<string>();
  const supplierExpenseInvoiceById = new Map<string, string>();
  const supplierPaymentEvents: DashboardExpensePayment[] = [];
  let supplierPaymentsAvailable = !linkedExpensesResult.error && parsedLinkedExpenses.success;
  if (linkedExpensesResult.error) {
    console.error("Dashboard supplier invoice expense query failed", { code: linkedExpensesResult.error.code });
    partialDataWarning = [partialDataWarning, "Les paiements fournisseurs liés aux dépenses ne sont pas disponibles."]
      .filter(Boolean).join(" ");
  } else if (!parsedLinkedExpenses.success) {
    console.error("Dashboard supplier invoice expense query returned an unexpected result");
    partialDataWarning = [partialDataWarning, "Les paiements fournisseurs liés aux dépenses ne sont pas au format attendu."]
      .filter(Boolean).join(" ");
    supplierPaymentsAvailable = false;
  } else if (parsedLinkedExpenses.data.length) {
    const linkedExpenses = parsedLinkedExpenses.data;
    const expenseIds = linkedExpenses.map(({ id }) => id);
    for (const expense of linkedExpenses) {
      supplierExpenseIds.add(expense.id);
      supplierExpenseInvoiceById.set(expense.id, expense.invoice_id);
    }
    const supplierPaymentsResult = await supabase.from("expense_payments")
      .select("expense_id, payment_date, amount")
      .in("expense_id", expenseIds);
    const parsedSupplierPayments = expensePaymentRowsSchema.safeParse(
      supplierPaymentsResult.error ? [] : supplierPaymentsResult.data ?? [],
    );
    const paidByExpense = new Map<string, number>();
    if (supplierPaymentsResult.error || !parsedSupplierPayments.success) {
      supplierPaymentsAvailable = false;
      console.error(
        supplierPaymentsResult.error
          ? "Dashboard supplier payment query failed"
          : "Dashboard supplier payment query returned an unexpected result",
        supplierPaymentsResult.error ? { code: supplierPaymentsResult.error.code } : undefined,
      );
      partialDataWarning = [partialDataWarning, "L’historique des paiements fournisseurs est indisponible."]
        .filter(Boolean).join(" ");
    } else {
      for (const payment of parsedSupplierPayments.data) {
        paidByExpense.set(payment.expense_id, Math.round(((paidByExpense.get(payment.expense_id) ?? 0) + payment.amount) * 100) / 100);
        supplierPaymentEvents.push({
          expenseId: payment.expense_id,
          paymentDate: payment.payment_date,
          amount: payment.amount,
        });
      }
    }
    for (const expense of linkedExpenses) {
      const invoiceTotal = invoices.find(({ id }) => id === expense.invoice_id)?.total ?? 0;
      const amount = expense.status === "paid" ? invoiceTotal : paidByExpense.get(expense.id) ?? 0;
      paidBySupplierInvoice.set(expense.invoice_id, Math.round(((paidBySupplierInvoice.get(expense.invoice_id) ?? 0) + amount) * 100) / 100);
    }
  }
  invoices = invoices.map((invoice) => {
    const paidAmount = invoice.status === "paid"
      ? invoice.total ?? 0
      : getInvoiceDirection(invoice) === "customer"
        ? customerPaymentsAvailable || paymentLedgerUnavailable ? paidByInvoice.get(invoice.id) ?? 0 : null
        : getInvoiceDirection(invoice) === "supplier"
          ? supplierPaymentsAvailable ? paidBySupplierInvoice.get(invoice.id) ?? 0 : null
          : 0;
    return {
      ...invoice,
      paidAmount,
      remainingAmount: getInvoiceRemainingAmount(invoice.total, paidAmount, invoice.status),
    };
  });

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

  let expensePaymentHistoryAvailable = !expensesLoadError && supplierPaymentsAvailable;
  const expensePaymentEvents: DashboardExpensePayment[] = [...supplierPaymentEvents];
  const otherExpenseIds = expenses
    .map(({ id }) => id)
    .filter((id) => !supplierExpenseIds.has(id));
  if (otherExpenseIds.length) {
    const expensePaymentsResult = await supabase.from("expense_payments")
      .select("expense_id, payment_date, amount")
      .in("expense_id", otherExpenseIds);
    const parsedExpensePayments = expensePaymentRowsSchema.safeParse(
      expensePaymentsResult.error ? [] : expensePaymentsResult.data ?? [],
    );
    if (expensePaymentsResult.error || !parsedExpensePayments.success) {
      expensePaymentHistoryAvailable = false;
      console.error(
        expensePaymentsResult.error
          ? "Dashboard expense payment query failed"
          : "Dashboard expense payment query returned an unexpected result",
        expensePaymentsResult.error ? { code: expensePaymentsResult.error.code } : undefined,
      );
      partialDataWarning = [
        partialDataWarning,
        "L’historique des paiements de dépenses n’est pas disponible ; les sorties correspondantes ne sont pas tracées.",
      ].filter(Boolean).join(" ");
    } else {
      expensePaymentEvents.push(...parsedExpensePayments.data.map((payment) => ({
        expenseId: payment.expense_id,
        paymentDate: payment.payment_date,
        amount: payment.amount,
      })));
    }
  }
  if (expensesLoadError) expensePaymentHistoryAvailable = false;

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
          invoiceId: supplierExpenseInvoiceById.get(expense.id) ?? null,
          supplierName: null,
          status: expense.status,
          notes: expense.notes,
          createdAt: expense.created_at,
          updatedAt: expense.updated_at,
        }))}
        customerPayments={customerPaymentEvents}
        expensePayments={expensePaymentEvents}
        paymentHistoryAvailability={{
          customer: customerPaymentsAvailable,
          expenses: expensePaymentHistoryAvailable,
        }}
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
