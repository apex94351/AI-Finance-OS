import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { contactInvoiceSchema, contactRowSchema, mapContact } from "@/services/contacts";
import type { ContactKind, ContactRecord } from "@/types/invoice";
import type { ContactCompany, ContactInvoice } from "@/database/components/contacts/contact-workspace";
import { expenseRowSchema, type ExpenseRecord } from "@/services/expenses";

const membershipsSchema = z.array(z.object({ company_id: z.uuid() }));
const companiesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
const linkedInvoiceSchema = contactInvoiceSchema.extend({
  customer_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
});

export interface ContactWorkspaceData {
  contacts: ContactRecord[];
  companies: ContactCompany[];
  invoicesByContact: Record<string, ContactInvoice[]>;
  expensesBySupplier: Record<string, ExpenseRecord[]>;
  expensesWarning: string | null;
  loadError: string | null;
}

const emptyData = (loadError: string): ContactWorkspaceData => ({
  contacts: [],
  companies: [],
  invoicesByContact: {},
  expensesBySupplier: {},
  expensesWarning: null,
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
      status: invoice.status,
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
    return { contacts, companies: companies.data, invoicesByContact, expensesBySupplier, expensesWarning, loadError: "Cette fiche n’existe pas ou n’est pas accessible avec votre compte." };
  }

  return { contacts, companies: companies.data, invoicesByContact, expensesBySupplier, expensesWarning, loadError: null };
}
