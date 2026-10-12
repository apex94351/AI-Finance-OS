import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { TreasuryClient } from "@/database/components/treasury/treasury-client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { buildTreasuryMovements } from "@/services/treasury";
import {
  expenseRowSchema,
  expenseSupplierRowSchema,
  mapExpense,
} from "@/services/expenses";
import { getEffectiveInvoiceStatus, getInvoiceDirection, getInvoiceRemainingAmount } from "@/services/invoice-validation";
import type {
  DashboardExpensePayment,
  DashboardInvoicePayment,
  DashboardPaymentHistoryAvailability,
} from "@/services/dashboard";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceRecord } from "@/types/invoice";
import type { TreasuryMovement, TreasuryOpeningBalance, TreasuryScope } from "@/services/treasury";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({
  id: z.uuid(),
  name: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}));
const amountSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceRowsSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  invoice_type: z.enum(["customer", "supplier"]).nullable(),
  customer_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
  document_id: z.uuid().nullable(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  description: z.string().nullable(),
  issue_date: z.iso.date().nullable(),
  due_date: z.iso.date().nullable(),
  subtotal_ht: amountSchema,
  vat_amount: amountSchema,
  total_ttc: amountSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
  created_at: z.string(),
  updated_at: z.string(),
}));
const paymentRowsSchema = z.array(z.object({
  id: z.uuid(),
  invoice_id: z.uuid(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).refine((amount) => amount > 0),
  payment_date: z.iso.date(),
}));
const expensePaymentRowsSchema = z.array(z.object({
  id: z.uuid(),
  expense_id: z.uuid(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).refine((amount) => amount > 0),
  payment_date: z.iso.date(),
}));
const balanceRowsSchema = z.array(z.object({
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  opening_balance: amountSchema.refine((amount) => amount !== null),
  opening_date: z.iso.date(),
}));
const contactNamesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));

const invoiceColumns = "id, user_id, company_id, invoice_type, customer_id, supplier_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_amount, total_ttc, currency, status, created_at, updated_at";
const expenseColumns = "id, user_id, company_id, label, amount, currency, expense_date, due_date, subtotal_ht, vat_rate, vat_amount, category, supplier_id, document_id, invoice_id, recurrence_id, recurrence_date, status, notes, created_at, updated_at";
const missingSchemaCodes = ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"];

function isMissingSchema(code: string | undefined): boolean {
  return missingSchemaCodes.includes(code ?? "");
}

function treasuryPage({
  asOfDate,
  scopes = [],
  invoices = [],
  expenses = [],
  customerPayments = [],
  expensePayments = [],
  historyAvailability = { customer: false, expenses: false },
  openingBalances = [],
  balanceSchemaAvailable = false,
  counterpartyNames = {},
  loadError = null,
  warning = null,
}: {
  asOfDate: string;
  scopes?: TreasuryScope[];
  invoices?: InvoiceRecord[];
  expenses?: ExpenseRecord[];
  customerPayments?: DashboardInvoicePayment[];
  expensePayments?: DashboardExpensePayment[];
  historyAvailability?: DashboardPaymentHistoryAvailability;
  openingBalances?: TreasuryOpeningBalance[];
  balanceSchemaAvailable?: boolean;
  counterpartyNames?: Record<string, string>;
  loadError?: string | null;
  warning?: string | null;
}) {
  const movements = loadError ? [] : buildTreasuryMovements(
    invoices,
    expenses,
    customerPayments,
    expensePayments,
    counterpartyNames,
  );
  return (
    <AppShell pageTitle="treasury">
      <TreasuryClient
        asOfDate={asOfDate}
        scopes={scopes}
        invoices={invoices}
        expenses={expenses}
        customerPayments={customerPayments}
        expensePayments={expensePayments}
        movements={movements}
        historyAvailability={historyAvailability}
        openingBalances={openingBalances}
        balanceSchemaAvailable={balanceSchemaAvailable}
        counterpartyNames={counterpartyNames}
        loadError={loadError}
        warning={warning}
      />
    </AppShell>
  );
}

export default async function TreasuryPage() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/treasury");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);
  if (membershipResult.error) {
    console.error("Treasury membership query failed", { code: membershipResult.error.code });
    return treasuryPage({ asOfDate, loadError: "Impossible de vérifier les espaces d’entreprise de votre compte." });
  }
  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Treasury membership query returned an unexpected result");
    return treasuryPage({ asOfDate, loadError: "La liste des espaces associés reçue est invalide." });
  }
  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  const companyResult = companyIds.length
    ? await supabase.from("companies").select("id, name, currency").in("id", companyIds)
    : { data: [], error: null };
  if (companyResult.error) {
    console.error("Treasury company query failed", { code: companyResult.error.code });
    return treasuryPage({ asOfDate, loadError: "Impossible de charger les entreprises associées à votre compte." });
  }
  const companies = companySchema.safeParse(companyResult.data ?? []);
  if (!companies.success) {
    console.error("Treasury company query returned an unexpected result");
    return treasuryPage({ asOfDate, loadError: "Les informations d’entreprise reçues ne sont pas au format attendu." });
  }

  const [personalInvoicesResult, companyInvoicesResult] = await Promise.all([
    supabase.from("invoices").select(invoiceColumns).eq("user_id", user.id).is("company_id", null),
    companyIds.length
      ? supabase.from("invoices").select(invoiceColumns).in("company_id", companyIds).is("user_id", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const invoiceError = personalInvoicesResult.error ?? companyInvoicesResult.error;
  if (invoiceError) {
    console.error("Treasury invoice query failed", { code: invoiceError.code });
    return treasuryPage({
      asOfDate,
      loadError: isMissingSchema(invoiceError.code)
        ? "Les factures ou leurs liens de tiers ne sont pas disponibles dans le schéma Supabase chargé."
        : "Impossible de charger les factures pour la trésorerie.",
    });
  }
  const parsedInvoices = invoiceRowsSchema.safeParse([
    ...(personalInvoicesResult.data ?? []),
    ...(companyInvoicesResult.data ?? []),
  ]);
  if (!parsedInvoices.success) {
    console.error("Treasury invoice query returned an unexpected result");
    return treasuryPage({ asOfDate, loadError: "Les factures reçues ne sont pas au format attendu." });
  }
  const companyCurrency = new Map(companies.data.map(({ id, currency }) => [id, currency]));
  let invoices: InvoiceRecord[] = parsedInvoices.data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    invoiceType: row.invoice_type,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    documentId: row.document_id,
    invoiceNumber: row.invoice_number,
    clientName: row.client_name,
    description: row.description,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: row.subtotal_ht,
    vatRate: null,
    vatAmount: row.vat_amount,
    total: row.total_ttc,
    currency: row.currency ?? companyCurrency.get(row.company_id ?? "") ?? null,
    status: getEffectiveInvoiceStatus(row.status, row.due_date, new Date(`${asOfDate}T00:00:00Z`)),
    category: null,
    analysis: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const expenseQuery = await Promise.all([
    supabase.from("expenses").select(expenseColumns).eq("user_id", user.id).is("company_id", null),
    companyIds.length
      ? supabase.from("expenses").select(expenseColumns).in("company_id", companyIds).is("user_id", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const expenseError = expenseQuery[0].error ?? expenseQuery[1].error;
  if (expenseError) {
    console.error("Treasury expense query failed", { code: expenseError.code });
    return treasuryPage({ asOfDate, loadError: "Impossible de charger les dépenses et paiements fournisseurs." });
  }
  const parsedExpenses = expenseRowSchema.array().safeParse([
    ...(expenseQuery[0].data ?? []),
    ...(expenseQuery[1].data ?? []),
  ]);
  if (!parsedExpenses.success) {
    console.error("Treasury expense query returned an unexpected result");
    return treasuryPage({ asOfDate, loadError: "Les dépenses reçues ne sont pas au format attendu." });
  }

  const invoiceIds = invoices.map(({ id }) => id);
  const customerPaymentResult = invoiceIds.length
    ? await supabase.from("invoice_payments").select("id, invoice_id, amount, payment_date").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  const parsedCustomerPayments = paymentRowsSchema.safeParse(
    customerPaymentResult.error ? [] : customerPaymentResult.data ?? [],
  );
  const customerHistoryAvailable = !customerPaymentResult.error && parsedCustomerPayments.success;

  const expenseIds = parsedExpenses.data.map(({ id }) => id);
  const expensePaymentResult = expenseIds.length
    ? await supabase.from("expense_payments").select("id, expense_id, amount, payment_date").in("expense_id", expenseIds)
    : { data: [], error: null };
  const parsedExpensePayments = expensePaymentRowsSchema.safeParse(
    expensePaymentResult.error ? [] : expensePaymentResult.data ?? [],
  );
  const expenseHistoryAvailable = !expensePaymentResult.error && parsedExpensePayments.success;
  if (customerPaymentResult.error || !parsedCustomerPayments.success) {
    console.error("Treasury customer payment history query failed", {
      code: customerPaymentResult.error?.code ?? "INVALID_RESULT",
    });
  }
  if (expensePaymentResult.error || !parsedExpensePayments.success) {
    console.error("Treasury expense payment history query failed", {
      code: expensePaymentResult.error?.code ?? "INVALID_RESULT",
    });
  }

  const customerPayments: DashboardInvoicePayment[] = customerHistoryAvailable
    ? parsedCustomerPayments.data.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoice_id,
      paymentDate: payment.payment_date,
      amount: payment.amount,
    }))
    : [];
  const expensePayments: DashboardExpensePayment[] = expenseHistoryAvailable
    ? parsedExpensePayments.data.map((payment) => ({
      id: payment.id,
      expenseId: payment.expense_id,
      paymentDate: payment.payment_date,
      amount: payment.amount,
    }))
    : [];
  const paidByInvoice = new Map<string, number>();
  for (const payment of customerPayments) {
    paidByInvoice.set(payment.invoiceId, Math.round(((paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amount) * 100) / 100);
  }
  const paidByExpense = new Map<string, number>();
  for (const payment of expensePayments) {
    paidByExpense.set(payment.expenseId, Math.round(((paidByExpense.get(payment.expenseId) ?? 0) + payment.amount) * 100) / 100);
  }
  const paidBySupplierInvoice = new Map<string, number>();
  for (const expense of parsedExpenses.data) {
    if (!expense.invoice_id) continue;
    paidBySupplierInvoice.set(
      expense.invoice_id,
      Math.round(((paidBySupplierInvoice.get(expense.invoice_id) ?? 0) + (paidByExpense.get(expense.id) ?? 0)) * 100) / 100,
    );
  }
  invoices = invoices.map((invoice) => {
    const paidAmount = getInvoiceDirection(invoice) === "customer"
      ? customerHistoryAvailable ? paidByInvoice.get(invoice.id) ?? 0 : null
      : getInvoiceDirection(invoice) === "supplier"
        ? expenseHistoryAvailable ? paidBySupplierInvoice.get(invoice.id) ?? 0 : null
        : null;
    return {
      ...invoice,
      paidAmount,
      remainingAmount: getInvoiceRemainingAmount(invoice.total, paidAmount, invoice.status),
    };
  });

  const supplierIds = [...new Set(parsedExpenses.data.flatMap(({ supplier_id }) => supplier_id ? [supplier_id] : []))];
  const customerIds = [...new Set(invoices.flatMap(({ customerId }) => customerId ? [customerId] : []))];
  const [supplierResult, customerResult] = await Promise.all([
    supplierIds.length
      ? supabase.from("suppliers").select("id, user_id, company_id, name").in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? supabase.from("customers").select("id, name").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const parsedSuppliers = expenseSupplierRowSchema.array().safeParse(supplierResult.data ?? []);
  const parsedCustomers = contactNamesSchema.safeParse(customerResult.data ?? []);
  const counterpartyNames: Record<string, string> = {};
  if (parsedCustomers.success) {
    for (const row of parsedCustomers.data) counterpartyNames[row.id] = row.name;
  }
  if (parsedSuppliers.success) {
    for (const row of parsedSuppliers.data) counterpartyNames[row.id] = row.name;
  }
  const contactWarning = supplierResult.error || customerResult.error || !parsedSuppliers.success || !parsedCustomers.success;
  if (contactWarning) console.error("Treasury counterparty name query failed");

  const suppliersForExpenses = parsedSuppliers.success ? parsedSuppliers.data : [];
  const expenses: ExpenseRecord[] = parsedExpenses.data.map((row) => mapExpense(row, suppliersForExpenses));

  let openingBalances: TreasuryOpeningBalance[] = [];
  const balanceResult = await supabase.from("treasury_opening_balances")
    .select("user_id, company_id, currency, opening_balance, opening_date");
  let balanceSchemaAvailable = !balanceResult.error;
  if (balanceResult.error) {
    console.error("Treasury opening balance query failed", { code: balanceResult.error.code });
  } else {
    const parsedBalances = balanceRowsSchema.safeParse(balanceResult.data ?? []);
    if (!parsedBalances.success) {
      balanceSchemaAvailable = false;
      console.error("Treasury opening balance query returned an unexpected result");
    } else {
      openingBalances = parsedBalances.data.map((balance) => ({
        userId: balance.user_id,
        companyId: balance.company_id,
        currency: balance.currency,
        amount: balance.opening_balance!,
        date: balance.opening_date,
      }));
    }
  }

  const scopes: TreasuryScope[] = [
    { id: null, label: "Personnel", currency: null },
    ...companies.data.map(({ id, name, currency }) => ({ id, label: name, currency })),
  ];
  const warningParts = [
    !customerHistoryAvailable || !expenseHistoryAvailable ? "Un historique de paiement est indisponible." : null,
    contactWarning ? "Certains noms de tiers ne sont pas disponibles." : null,
  ].filter((message): message is string => Boolean(message));
  return treasuryPage({
    asOfDate,
    scopes,
    invoices,
    expenses,
    customerPayments,
    expensePayments,
    historyAvailability: { customer: customerHistoryAvailable, expenses: expenseHistoryAvailable },
    openingBalances,
    balanceSchemaAvailable,
    counterpartyNames,
    warning: warningParts.join(" "),
  });
}
