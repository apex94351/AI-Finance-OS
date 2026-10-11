import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { contactInvoiceSchema, contactRowSchema, mapContact } from "@/services/contacts";
import type { ContactKind, ContactRecord } from "@/types/invoice";
import type { ContactCompany, ContactInvoice } from "@/database/components/contacts/contact-workspace";
import { expenseRowSchema, type ExpenseRecord } from "@/services/expenses";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";

const membershipsSchema = z.array(z.object({ company_id: z.uuid() }));
const companiesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const linkedInvoiceSchema = contactInvoiceSchema.extend({
  customer_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
});
const invoicePaymentRowsSchema = z.array(z.object({ invoice_id: z.uuid(), amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]) }));
const linkedExpenseRowsSchema = z.array(z.object({
  id: z.uuid(),
  invoice_id: z.uuid(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
}));
const expensePaymentRowsSchema = z.array(z.object({ expense_id: z.uuid(), amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]) }));

export interface ContactWorkspaceData {
  contacts: ContactRecord[];
  companies: ContactCompany[];
  invoicesByContact: Record<string, ContactInvoice[]>;
  expensesBySupplier: Record<string, ExpenseRecord[]>;
  expensesWarning: string | null;
  paymentWarning: string | null;
  loadError: string | null;
}

const emptyData = (loadError: string): ContactWorkspaceData => ({
  contacts: [],
  companies: [],
  invoicesByContact: {},
  expensesBySupplier: {},
  expensesWarning: null,
  paymentWarning: null,
  loadError,
});

export async function loadContactWorkspace(
  kind: ContactKind,
  selectedContactId: string | null,
  pathname = `/${kind}`,
): Promise<ContactWorkspaceData> {
  const { supabase, user } = await getAuthenticatedSupabase(pathname);
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);
  if (membershipResult.error) {
    console.error("Contact workspace membership query failed", { kind, code: membershipResult.error.code });
    return emptyData("Impossible de vérifier les espaces d’entreprise de votre compte.");
  }

  const memberships = membershipsSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Contact workspace membership query returned an unexpected result", { kind });
    return emptyData("La liste des espaces associés reçue est invalide.");
  }
  const companyIds = [...new Set(memberships.data.map((membership) => membership.company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length) {
    const companiesResult = await supabase.from("companies").select("id, name").in("id", companyIds);
    if (companiesResult.error) {
      console.error("Contact workspace company query failed", { kind, code: companiesResult.error.code });
      return emptyData("Impossible de charger les espaces associés à votre compte.");
    }
    companyRows = companiesResult.data;
  }

  const companies = companiesSchema.safeParse(companyRows);
  if (!companies.success) {
    console.error("Contact workspace company query returned an unexpected result", { kind });
    return emptyData("Les informations d’entreprise reçues sont invalides.");
  }

  const table = kind;
  const personalContactsResult = await supabase
    .from(table)
    .select("id, user_id, company_id, name, email, phone, address, notes, created_at, updated_at")
    .eq("user_id", user.id)
    .is("company_id", null)
    .order("name");
  if (personalContactsResult.error) {
    console.error("Personal contact query failed", { kind, code: personalContactsResult.error.code });
    return emptyData("Impossible de charger les fiches pour le moment. Vérifiez que la migration 008 est appliquée.");
  }

  let companyContactRows: unknown[] = [];
  if (companyIds.length) {
    const companyContactsResult = await supabase
      .from(table)
      .select("id, user_id, company_id, name, email, phone, address, notes, created_at, updated_at")
      .in("company_id", companyIds)
      .is("user_id", null)
      .order("name");
    if (companyContactsResult.error) {
      console.error("Company contact query failed", { kind, code: companyContactsResult.error.code });
      return emptyData("Impossible de charger les fiches pour le moment.");
    }
    companyContactRows = companyContactsResult.data;
  }

  const contactsResult = z.array(contactRowSchema).safeParse([
    ...personalContactsResult.data,
    ...companyContactRows,
  ]);
  if (!contactsResult.success) {
    console.error("Contact query returned an unexpected result", { kind });
    return emptyData("Les fiches reçues ne sont pas au format attendu.");
  }
  const contacts = contactsResult.data.map((row) => mapContact(row, kind));
  const invoiceColumns = "id, customer_id, supplier_id, invoice_number, client_name, issue_date, due_date, total_ttc, currency, status";
  const relationColumn = kind === "customers" ? "customer_id" : "supplier_id";
  const personalInvoicesResult = await supabase
    .from("invoices")
    .select(invoiceColumns)
    .eq("user_id", user.id)
    .is("company_id", null)
    .not(relationColumn, "is", null);
  if (personalInvoicesResult.error) {
    console.error("Personal linked invoice query failed", { kind, code: personalInvoicesResult.error.code });
    return emptyData("Impossible de charger les factures associées.");
  }

  let companyInvoiceRows: unknown[] = [];
  if (companyIds.length) {
    const companyInvoicesResult = await supabase
      .from("invoices")
      .select(invoiceColumns)
      .in("company_id", companyIds)
      .is("user_id", null)
      .not(relationColumn, "is", null);
    if (companyInvoicesResult.error) {
      console.error("Company linked invoice query failed", { kind, code: companyInvoicesResult.error.code });
      return emptyData("Impossible de charger les factures associées.");
    }
    companyInvoiceRows = companyInvoicesResult.data;
  }

  const linkedInvoices = z.array(linkedInvoiceSchema).safeParse([
    ...personalInvoicesResult.data,
    ...companyInvoiceRows,
  ]);
  if (!linkedInvoices.success) {
    console.error("Linked invoice query returned an unexpected result", { kind });
    return emptyData("Les factures associées reçues ne sont pas au format attendu.");
  }

  const invoiceIds = linkedInvoices.data.map(({ id }) => id);
  const paidByInvoice = new Map<string, number>();
  let paymentWarning: string | null = null;
  let paymentDataAvailable = true;
  if (invoiceIds.length && kind === "customers") {
    const paymentsResult = await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", invoiceIds);
    const payments = invoicePaymentRowsSchema.safeParse(paymentsResult.data ?? []);
    const paymentTableMissing = Boolean(paymentsResult.error
      && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(paymentsResult.error.code ?? ""));
    if (paymentTableMissing) {
      console.error("Customer invoice payment ledger is not installed", { code: paymentsResult.error?.code });
      paymentWarning = "Les factures et fiches restent accessibles. L’historique de paiements partiels clients nécessite la migration 017.";
    } else if (paymentsResult.error || !payments.success) {
      console.error("Contact customer invoice payment query failed", { code: paymentsResult.error?.code ?? "INVALID_RESULT" });
      paymentDataAvailable = false;
      paymentWarning = ["Les fiches et factures restent accessibles.",
        ["42P01", "PGRST202", "PGRST205"].includes(paymentsResult.error?.code ?? "")
          ? "Les paiements partiels clients nécessitent la migration 017_invoice_directions_and_customer_payments.sql."
          : "L’historique des paiements clients ne peut pas être vérifié avec les permissions ou le schéma chargés."]
      .join(" ");
    } else {
      for (const payment of payments.data) {
        paidByInvoice.set(payment.invoice_id, Math.round(((paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount) * 100) / 100);
      }
    }
  }
  if (invoiceIds.length && kind === "suppliers") {
    const expensesResult = await supabase.from("expenses").select("id, invoice_id, status").in("invoice_id", invoiceIds);
    const linkedExpenses = linkedExpenseRowsSchema.safeParse(expensesResult.data ?? []);
    if (expensesResult.error || !linkedExpenses.success) {
      console.error("Contact supplier invoice expense query failed", { code: expensesResult.error?.code ?? "INVALID_RESULT" });
      paymentDataAvailable = false;
      paymentWarning = "Les fiches et factures restent accessibles, mais les paiements fournisseurs liés ne peuvent pas être vérifiés.";
    } else {
      const expenseIds = linkedExpenses.data.map(({ id }) => id);
      const paymentsResult = expenseIds.length
        ? await supabase.from("expense_payments").select("expense_id, amount").in("expense_id", expenseIds)
        : { data: [], error: null };
      const payments = expensePaymentRowsSchema.safeParse(paymentsResult.data ?? []);
      if (paymentsResult.error || !payments.success) {
        console.error("Contact supplier payment query failed", { code: paymentsResult.error?.code ?? "INVALID_RESULT" });
        paymentDataAvailable = false;
        paymentWarning = "Les fiches et factures restent accessibles, mais l’historique des paiements fournisseurs n’est pas disponible.";
      } else {
        const paidByExpense = new Map<string, number>();
        for (const payment of payments.data) {
          paidByExpense.set(payment.expense_id, Math.round(((paidByExpense.get(payment.expense_id) ?? 0) + payment.amount) * 100) / 100);
        }
        for (const expense of linkedExpenses.data) {
          const invoiceTotal = linkedInvoices.data.find(({ id }) => id === expense.invoice_id)?.total_ttc ?? 0;
          const amount = expense.status === "paid" ? invoiceTotal : paidByExpense.get(expense.id) ?? 0;
          paidByInvoice.set(expense.invoice_id, Math.round(((paidByInvoice.get(expense.invoice_id) ?? 0) + amount) * 100) / 100);
        }
      }
    }
  }

  const invoicesByContact: Record<string, ContactInvoice[]> = {};
  for (const invoice of linkedInvoices.data) {
    const contactId = kind === "customers" ? invoice.customer_id : invoice.supplier_id;
    if (!contactId) continue;
    (invoicesByContact[contactId] ??= []).push({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      clientName: invoice.client_name,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      total: invoice.total_ttc,
      currency: invoice.currency,
      status: getEffectiveInvoiceStatus(invoice.status, invoice.due_date),
      paidAmount: invoice.status === "paid" ? invoice.total_ttc ?? 0
        : paymentDataAvailable ? paidByInvoice.get(invoice.id) ?? 0 : null,
    });
  }

  let expensesBySupplier: Record<string, ExpenseRecord[]> = {};
  let expensesWarning: string | null = null;
  if (kind === "suppliers") {
    const expenseColumns = "id, user_id, company_id, label, amount, currency, expense_date, category, supplier_id, status, notes, created_at, updated_at";
    const personalExpensesResult = await supabase
      .from("expenses")
      .select(expenseColumns)
      .eq("user_id", user.id)
      .is("company_id", null)
      .not("supplier_id", "is", null)
      .order("expense_date", { ascending: false });
    const companyExpensesResult = companyIds.length
      ? await supabase
        .from("expenses")
        .select(expenseColumns)
        .in("company_id", companyIds)
        .is("user_id", null)
        .not("supplier_id", "is", null)
        .order("expense_date", { ascending: false })
      : { data: [], error: null };

    const expenseError = personalExpensesResult.error ?? companyExpensesResult.error;
    if (expenseError) {
      console.error("Supplier expense query failed", { code: expenseError.code });
      const missingTable = ["42P01", "42703", "PGRST204", "PGRST205"].includes(expenseError.code ?? "");
      expensesWarning = missingTable
        ? "Les dépenses associées ne sont pas encore disponibles. La migration 009_expenses.sql n’est peut-être pas appliquée."
        : "Impossible de charger les dépenses associées pour le moment.";
    } else {
      const parsedExpenses = z.array(expenseRowSchema).safeParse([
        ...(personalExpensesResult.data ?? []),
        ...(companyExpensesResult.data ?? []),
      ]);
      if (!parsedExpenses.success) {
        console.error("Supplier expense query returned an unexpected result");
        expensesWarning = "Les dépenses reçues ne sont pas au format attendu.";
      } else {
        expensesBySupplier = {};
        for (const row of parsedExpenses.data) {
          if (!row.supplier_id) continue;
          const expense: ExpenseRecord = {
            id: row.id,
            userId: row.user_id,
            companyId: row.company_id,
            label: row.label,
            amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
            currency: row.currency,
            expenseDate: row.expense_date,
            category: row.category,
            supplierId: row.supplier_id,
            supplierName: null,
            status: row.status,
            notes: row.notes,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
          (expensesBySupplier[row.supplier_id] ??= []).push(expense);
        }
      }
    }
  }

  const selectedContact = contacts.find(({ id }) => id === selectedContactId);
  if (selectedContactId && !selectedContact) {
    return { contacts, companies: companies.data, invoicesByContact, expensesBySupplier, expensesWarning, paymentWarning, loadError: "Cette fiche n’existe pas ou n’est pas accessible avec votre compte." };
  }

  return { contacts, companies: companies.data, invoicesByContact, expensesBySupplier, expensesWarning, paymentWarning, loadError: null };
}
