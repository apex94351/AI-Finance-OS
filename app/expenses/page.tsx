import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { ExpenseManager } from "@/database/components/expenses/expense-manager";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  expensePaymentRowSchema,
  expenseRowSchema,
  expenseSupplierRowSchema,
  mapExpense,
  mapRecurringExpense,
  recurringExpenseRowSchema,
  type ExpenseRecord,
  type ExpensePaymentRecord,
} from "@/services/expenses";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({
  id: z.uuid(),
  name: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}));
const invoiceAmount = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const supplierInvoiceSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  supplier_id: z.uuid(),
  document_id: z.uuid().nullable(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  description: z.string().nullable(),
  issue_date: z.iso.date().nullable(),
  due_date: z.iso.date().nullable(),
  subtotal_ht: invoiceAmount,
  vat_rate: invoiceAmount.optional(),
  vat_amount: invoiceAmount,
  total_ttc: invoiceAmount,
  currency: z.string().nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
  category: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const expenseColumns = "id, user_id, company_id, label, amount, currency, expense_date, due_date, subtotal_ht, vat_rate, vat_amount, category, supplier_id, document_id, invoice_id, recurrence_id, recurrence_date, status, notes, created_at, updated_at";
const supplierColumns = "id, user_id, company_id, name";
const recurringColumns = "id, user_id, company_id, label, amount, currency, subtotal_ht, vat_rate, vat_amount, supplier_id, document_id, category, frequency, start_date, next_due_date, end_date, status, paused_on, notes, created_at, updated_at";
const invoiceColumns = "id, user_id, company_id, supplier_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_rate, vat_amount, total_ttc, currency, status, category, created_at, updated_at";
const documentColumns = "id, user_id, company_id, file_name, deleted_at";

export default async function ExpensesPage() {
  const today = new Date().toISOString().slice(0, 10);
  const { supabase, user } = await getAuthenticatedSupabase("/expenses");
  const membershipResult = await supabase.from("company_members").select("company_id").eq("user_id", user.id);
  if (membershipResult.error) {
    console.error("Expense membership query failed", { code: membershipResult.error.code });
    return renderError("Impossible de vérifier les espaces d’entreprise de votre compte.");
  }
  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Expense membership query returned an unexpected result");
    return renderError("La liste des espaces associés reçue est invalide.");
  }
  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  const companyResult = companyIds.length
    ? await supabase.from("companies").select("id, name, currency").in("id", companyIds)
    : { data: [], error: null };
  if (companyResult.error) {
    console.error("Expense company query failed", { code: companyResult.error.code });
    return renderError("Impossible de charger les entreprises associées à votre compte.");
  }
  const companies = companySchema.safeParse(companyResult.data ?? []);
  if (!companies.success) {
    console.error("Expense company query returned an unexpected result");
    return renderError("Les informations d’entreprise reçues ne sont pas au format attendu.");
  }
  const accessibleCompanyIds = companies.data.map(({ id }) => id);

  const [
    personalExpenses,
    companyExpenses,
    personalSuppliers,
    companySuppliers,
    personalInvoices,
    companyInvoices,
    personalRecurring,
    companyRecurring,
    personalDocuments,
    companyDocuments,
  ] = await Promise.all([
    supabase.from("expenses").select(expenseColumns).eq("user_id", user.id).is("company_id", null).order("expense_date", { ascending: false }),
    accessibleCompanyIds.length
      ? supabase.from("expenses").select(expenseColumns).in("company_id", accessibleCompanyIds).is("user_id", null).order("expense_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("suppliers").select(supplierColumns).eq("user_id", user.id).is("company_id", null).order("name"),
    accessibleCompanyIds.length
      ? supabase.from("suppliers").select(supplierColumns).in("company_id", accessibleCompanyIds).is("user_id", null).order("name")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("invoices").select(invoiceColumns).eq("user_id", user.id).is("company_id", null).not("supplier_id", "is", null),
    accessibleCompanyIds.length
      ? supabase.from("invoices").select(invoiceColumns).in("company_id", accessibleCompanyIds).is("user_id", null).not("supplier_id", "is", null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("recurring_expenses").select(recurringColumns).eq("user_id", user.id).is("company_id", null).order("next_due_date"),
    accessibleCompanyIds.length
      ? supabase.from("recurring_expenses").select(recurringColumns).in("company_id", accessibleCompanyIds).is("user_id", null).order("next_due_date")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("documents").select(documentColumns).eq("user_id", user.id).is("company_id", null).is("deleted_at", null).order("uploaded_at", { ascending: false }),
    accessibleCompanyIds.length
      ? supabase.from("documents").select(documentColumns).in("company_id", accessibleCompanyIds).is("user_id", null).is("deleted_at", null).order("uploaded_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const requiredError = personalExpenses.error ?? companyExpenses.error
    ?? personalRecurring.error ?? companyRecurring.error;
  if (requiredError) {
    console.error("Expense workspace query failed", { code: requiredError.code });
    return renderError(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(requiredError.code ?? "")
      ? "Le modèle Dépenses étendu n’est pas disponible. Appliquez manuellement la migration 015_expense_operations.sql après ses prérequis."
      : "Impossible de charger les dépenses et récurrences. Réessayez plus tard.", companies.data);
  }

  const parsedExpenses = z.array(expenseRowSchema).safeParse([
    ...(personalExpenses.data ?? []),
    ...(companyExpenses.data ?? []),
  ]);
  const parsedSuppliers = z.array(expenseSupplierRowSchema).safeParse([
    ...(personalSuppliers.data ?? []),
    ...(companySuppliers.data ?? []),
  ]);
  const parsedInvoices = supplierInvoiceSchema.safeParse([
    ...(personalInvoices.data ?? []),
    ...(companyInvoices.data ?? []),
  ]);
  const parsedRecurring = z.array(recurringExpenseRowSchema).safeParse([
    ...(personalRecurring.data ?? []),
    ...(companyRecurring.data ?? []),
  ]);
  if (!parsedExpenses.success || !parsedSuppliers.success || !parsedInvoices.success || !parsedRecurring.success) {
    console.error("Expense workspace query returned unexpected data");
    return renderError("Les données reçues pour les dépenses ne sont pas au format attendu.", companies.data);
  }

  const [expenseDocuments, invoiceDocuments] = [personalDocuments, companyDocuments];
  const parsedDocuments = z.array(z.object({
    id: z.uuid(),
    user_id: z.uuid().nullable(),
    company_id: z.uuid().nullable(),
    file_name: z.string(),
    deleted_at: z.string().nullable(),
  })).safeParse([...(personalDocuments.data ?? []), ...(companyDocuments.data ?? [])]);
  const warningMessages: string[] = [];
  if (personalSuppliers.error || companySuppliers.error) {
    warningMessages.push("Certains fournisseurs ne peuvent pas être affichés.");
    console.error("Expense supplier query failed", { code: personalSuppliers.error?.code ?? companySuppliers.error?.code });
  }
  if (personalInvoices.error || companyInvoices.error) {
    warningMessages.push("Certaines factures fournisseurs ne peuvent pas être affichées.");
    console.error("Expense invoice query failed", { code: personalInvoices.error?.code ?? companyInvoices.error?.code });
  }
  if (expenseDocuments.error || invoiceDocuments.error || !parsedDocuments.success) {
    warningMessages.push("Certains justificatifs ne peuvent pas être affichés.");
    console.error("Expense document query failed", { code: expenseDocuments.error?.code ?? invoiceDocuments.error?.code });
  }
  const documentWarning = warningMessages.length
    ? `Les dépenses restent disponibles. ${warningMessages.join(" ")}`
    : null;
  const documents = parsedDocuments.success ? parsedDocuments.data : [];
  const suppliers = parsedSuppliers.data;
  const documentOptions = documents.map(({ id, user_id, company_id, file_name }) => ({
    id, user_id, company_id, file_name,
  }));

  const invoiceById = new Map(parsedInvoices.data.map((invoice) => [invoice.id, invoice]));
  const invoiceDerivedStatus = (invoice: (typeof parsedInvoices.data)[number]) => {
    const status = getEffectiveInvoiceStatus(invoice.status, invoice.due_date, new Date(`${today}T00:00:00Z`));
    return status === "cancelled" ? "cancelled" : status === "paid" ? "paid" : status === "overdue" ? "overdue" : "pending";
  };
  const storedExpenses: ExpenseRecord[] = parsedExpenses.data.map((row) => {
    const expense = mapExpense(row, suppliers);
    const invoice = row.invoice_id ? invoiceById.get(row.invoice_id) : undefined;
    if (!invoice) return expense;
    const amount = invoice.total_ttc ?? expense.amount;
    return {
      ...expense,
      label: invoice.invoice_number ? `Facture ${invoice.invoice_number}` : invoice.client_name ?? expense.label,
      amount,
      currency: invoice.currency ?? expense.currency,
      expenseDate: invoice.issue_date ?? invoice.created_at.slice(0, 10),
      dueDate: invoice.due_date,
      subtotalHt: invoice.subtotal_ht,
      vatRate: invoice.vat_rate ?? null,
      vatAmount: invoice.vat_amount,
      category: invoice.category ?? expense.category,
      supplierId: invoice.supplier_id,
      supplierName: suppliers.find(({ id }) => id === invoice.supplier_id)?.name ?? expense.supplierName,
      documentId: invoice.document_id ?? expense.documentId,
      invoiceNumber: invoice.invoice_number,
      status: invoiceDerivedStatus(invoice),
      paidAmount: invoice.status === "paid" ? amount : 0,
    };
  });

  const linkedInvoiceIds = new Set(parsedExpenses.data.flatMap(({ invoice_id }) => invoice_id ? [invoice_id] : []));
  const unlinkedSupplierInvoices: ExpenseRecord[] = parsedInvoices.data
    .filter((invoice) => invoice.status !== "draft" && !linkedInvoiceIds.has(invoice.id))
    .map((invoice) => {
      const status = invoiceDerivedStatus(invoice);
      const amount = invoice.total_ttc ?? 0;
      return {
        id: invoice.id,
        userId: invoice.user_id,
        companyId: invoice.company_id,
        label: invoice.invoice_number ? `Facture ${invoice.invoice_number}` : invoice.client_name ?? "Facture fournisseur",
        amount,
        currency: invoice.currency ?? companies.data.find(({ id }) => id === invoice.company_id)?.currency ?? "EUR",
        expenseDate: invoice.issue_date ?? invoice.created_at.slice(0, 10),
        dueDate: invoice.due_date,
        subtotalHt: invoice.subtotal_ht,
        vatRate: invoice.vat_rate ?? null,
        vatAmount: invoice.vat_amount,
        category: invoice.category,
        supplierId: invoice.supplier_id,
        supplierName: suppliers.find(({ id }) => id === invoice.supplier_id)?.name ?? null,
        status,
        documentId: invoice.document_id,
        documentName: documents.find(({ id }) => id === invoice.document_id)?.file_name ?? null,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        sourceType: "supplier_invoice",
        paidAmount: status === "paid" ? amount : 0,
        notes: invoice.description,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at,
      };
    });
  const expenses = [...storedExpenses, ...unlinkedSupplierInvoices].map((expense) => ({
    ...expense,
    documentName: documents.find(({ id }) => id === expense.documentId)?.file_name ?? null,
  }));

  const expenseIds = parsedExpenses.data.map(({ id }) => id);
  const paymentResult = expenseIds.length
    ? await supabase.from("expense_payments")
      .select("id, expense_id, payment_date, amount, created_at")
      .in("expense_id", expenseIds)
      .order("payment_date", { ascending: false })
    : { data: [], error: null };
  if (paymentResult.error) {
    console.error("Expense payment query failed", { code: paymentResult.error.code });
    return renderError("Impossible de charger l’historique des paiements. Vérifiez la migration 015.", companies.data);
  }
  const paymentsParsed = z.array(expensePaymentRowSchema).safeParse(paymentResult.data ?? []);
  if (!paymentsParsed.success) {
    console.error("Expense payment query returned unexpected data");
    return renderError("L’historique des paiements reçus n’est pas au format attendu.", companies.data);
  }
  const payments: ExpensePaymentRecord[] = paymentsParsed.data.map((payment) => ({
    id: payment.id,
    expenseId: payment.expense_id,
    paymentDate: payment.payment_date,
    amount: payment.amount,
    createdAt: payment.created_at,
  }));
  const paymentsByExpense = new Map<string, number>();
  for (const payment of payments) {
    paymentsByExpense.set(payment.expenseId, (paymentsByExpense.get(payment.expenseId) ?? 0) + payment.amount);
  }
  for (const expense of expenses) {
    if (expense.sourceType === "supplier_invoice") continue;
    if (expense.status === "cancelled") continue;
    expense.paidAmount = Math.round((paymentsByExpense.get(expense.id) ?? (expense.status === "paid" ? expense.amount : 0)) * 100) / 100;
    if (expense.status === "paid" || expense.paidAmount >= expense.amount) expense.status = "paid";
    else if (expense.dueDate && expense.dueDate < today) expense.status = "overdue";
  }

  return (
    <AppShell pageTitle="expenses">
      <ExpenseManager
        companies={companies.data}
        suppliers={suppliers}
        documents={documentOptions}
        expenses={expenses}
        payments={payments}
        recurringExpenses={parsedRecurring.data.map((row) => mapRecurringExpense(row, suppliers, documents))}
        loadError={null}
        supplierWarning={documentWarning}
        today={today}
      />
    </AppShell>
  );
}

function renderError(message: string, companies: { id: string; name: string; currency: string }[] = []) {
  return (
    <AppShell pageTitle="expenses">
      <ExpenseManager
        companies={companies}
        suppliers={[]}
        documents={[]}
        expenses={[]}
        payments={[]}
        recurringExpenses={[]}
        loadError={message}
        supplierWarning={null}
      />
    </AppShell>
  );
}
