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
const expenseSchema = z.array(z.object({
  id: z.uuid(),
  company_id: z.uuid().nullable(),
  label: z.string(),
  due_date: z.iso.date().nullable(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
  supplier_id: z.uuid().nullable(),
  invoice_id: z.uuid().nullable(),
}));
const expensePaymentSchema = z.array(z.object({
  expense_id: z.uuid(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]),
}));

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
    sourceType: "invoice",
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
  let expenseDataWarning: string | null = null;
  const [personalExpenseResult, companyExpenseResult, personalLinkedExpenseResult, companyLinkedExpenseResult] = await Promise.all([
    supabase.from("expenses").select("id, company_id, label, due_date, amount, currency, status, supplier_id, invoice_id")
      .eq("user_id", user.id).is("company_id", null).not("due_date", "is", null).is("invoice_id", null),
    companyIds.length
      ? supabase.from("expenses").select("id, company_id, label, due_date, amount, currency, status, supplier_id, invoice_id")
        .in("company_id", companyIds).is("user_id", null).not("due_date", "is", null).is("invoice_id", null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("expenses").select("id, company_id, label, due_date, amount, currency, status, supplier_id, invoice_id")
      .eq("user_id", user.id).is("company_id", null).not("invoice_id", "is", null),
    companyIds.length
      ? supabase.from("expenses").select("id, company_id, label, due_date, amount, currency, status, supplier_id, invoice_id")
        .in("company_id", companyIds).is("user_id", null).not("invoice_id", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const expenseQueryError = personalExpenseResult.error
    ?? companyExpenseResult.error
    ?? personalLinkedExpenseResult.error
    ?? companyLinkedExpenseResult.error;
  const expenseSchemaUnavailable = Boolean(expenseQueryError
    && ["42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(expenseQueryError.code ?? ""));
  if (expenseQueryError && !expenseSchemaUnavailable) {
    console.error("Due date expense query failed", { code: expenseQueryError.code });
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de charger les échéances de dépenses. Vérifiez la migration corrective 016_supabase_managed_schedulers.sql." asOfDate={asOfDate} /></AppShell>;
  }
  if (expenseSchemaUnavailable) {
    console.error("Due date expense query requires migration 015", { code: expenseQueryError?.code });
    expenseDataWarning = "Les échéances de dépenses nécessitent la migration corrective locale 016_supabase_managed_schedulers.sql.";
  }
  const parsedExpenses = expenseSchema.safeParse(expenseSchemaUnavailable
    ? []
    : [
      ...(personalExpenseResult.data ?? []),
      ...(companyExpenseResult.data ?? []),
      ...(personalLinkedExpenseResult.data ?? []),
      ...(companyLinkedExpenseResult.data ?? []),
    ]);
  if (!parsedExpenses.success) {
    console.error("Due date expense query returned an unexpected result");
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Les échéances de dépenses reçues ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }
  const expenseIds = parsedExpenses.data.map(({ id }) => id);
  const paymentResult = expenseIds.length
    ? await supabase.from("expense_payments").select("expense_id, amount").in("expense_id", expenseIds)
    : { data: [], error: null };
  const paymentSchemaUnavailable = Boolean(paymentResult.error
    && ["42P01", "PGRST202", "PGRST205"].includes(paymentResult.error.code ?? ""));
  if (paymentResult.error && !paymentSchemaUnavailable) {
    console.error("Due date expense payment query failed", { code: paymentResult.error.code });
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Impossible de charger les paiements des dépenses. Vérifiez la migration corrective 016_supabase_managed_schedulers.sql." asOfDate={asOfDate} /></AppShell>;
  }
  if (paymentSchemaUnavailable) {
    console.error("Due date expense payment query requires migration 015", { code: paymentResult.error?.code });
    expenseDataWarning = [expenseDataWarning, "L’historique des paiements partiels est indisponible tant que la migration corrective 016 n’est pas installée."]
      .filter(Boolean).join(" ");
  }
  const parsedPayments = expensePaymentSchema.safeParse(paymentSchemaUnavailable ? [] : paymentResult.data ?? []);
  if (!parsedPayments.success) {
    console.error("Due date expense payment query returned an unexpected result");
    return <AppShell pageTitle="dueDates"><DeadlineManager invoices={[]} loadError="Les paiements reçus ne sont pas au format attendu." asOfDate={asOfDate} /></AppShell>;
  }
  const paidByExpense = new Map<string, number>();
  for (const payment of parsedPayments.data) {
    paidByExpense.set(payment.expense_id, (paidByExpense.get(payment.expense_id) ?? 0) + payment.amount);
  }
  const expenseItems: DueDateRecord[] = parsedExpenses.data
    .filter((expense) => expense.invoice_id === null && expense.due_date !== null)
    .map((expense) => {
    const paidAmount = Math.round((paidByExpense.get(expense.id) ?? (expense.status === "paid" ? expense.amount : 0)) * 100) / 100;
    return {
      id: expense.id,
      sourceType: "expense",
      companyId: expense.company_id,
      customerId: null,
      supplierId: expense.supplier_id,
      invoiceNumber: null,
      clientName: expense.label,
      label: expense.label,
      dueDate: expense.due_date,
      total: Math.max(0, Math.round((expense.amount - paidAmount) * 100) / 100),
      grossTotal: expense.amount,
      currency: expense.currency,
      status: expense.status,
      paidAmount,
    };
  });
  const linkedExpensePayments = new Map<string, number>();
  for (const expense of parsedExpenses.data) {
    if (!expense.invoice_id) continue;
    const paidAmount = expense.status === "paid"
      ? expense.amount
      : paidByExpense.get(expense.id) ?? 0;
    linkedExpensePayments.set(
      expense.invoice_id,
      Math.round(((linkedExpensePayments.get(expense.invoice_id) ?? 0) + paidAmount) * 100) / 100,
    );
  }
  const invoicesWithPayments = invoices.map((invoice) => ({
    ...invoice,
    grossTotal: invoice.total,
    paidAmount: invoice.status === "paid"
      ? invoice.total ?? 0
      : linkedExpensePayments.get(invoice.id) ?? 0,
  }));
  const customerIds = [...new Set(invoicesWithPayments.flatMap(({ customerId }) => customerId ? [customerId] : []))];
  const supplierIds = [...new Set([...invoicesWithPayments, ...expenseItems].flatMap(({ supplierId }) => supplierId ? [supplierId] : []))];
  const [customers, suppliers] = await Promise.all([
    customerIds.length ? supabase.from("customers").select("id, name").in("id", customerIds) : null,
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : null,
  ]);
  const counterpartyNames: Record<string, string> = {};
  let partialDataWarning: string | null = expenseDataWarning;
  for (const [label, result] of [["client", customers], ["fournisseur", suppliers]] as const) {
    if (!result) continue;
    const parsed = result.error ? null : contactNamesSchema.safeParse(result.data);
    if (!parsed?.success) {
      console.error(`Due date ${label} query failed`, { code: result.error?.code ?? "INVALID_RESULT" });
      partialDataWarning = [partialDataWarning, "Certains noms de tiers sont indisponibles."]
        .filter(Boolean).join(" ");
      continue;
    }
    for (const contact of parsed.data) counterpartyNames[contact.id] = contact.name;
  }
  if (!personalResult.hasPartyLinks || !companyHasPartyLinks) {
    partialDataWarning = [partialDataWarning, "Les liens Clients/Fournisseurs ne sont pas disponibles dans le schéma chargé."]
      .filter(Boolean).join(" ");
  }
  const unusableCurrencies = new Set([...invoicesWithPayments, ...expenseItems]
    .filter((record) => record.status !== "paid" && record.status !== "cancelled" && record.status !== "draft")
    .map((record) => record.currency)
    .filter((currency): currency is string => Boolean(currency && currency !== "EUR")));
  if (unusableCurrencies.size > 0) {
    partialDataWarning = [partialDataWarning, `${unusableCurrencies.size} devise${unusableCurrencies.size === 1 ? "" : "s"} autre${unusableCurrencies.size === 1 ? "" : "s"} que l’euro reste${unusableCurrencies.size === 1 ? "" : "nt"} affichée${unusableCurrencies.size === 1 ? "" : "s"} dans la liste mais exclue${unusableCurrencies.size === 1 ? "" : "s"} des totaux (aucun taux de conversion n’est disponible).`]
      .filter(Boolean).join(" ");
  }

  return (
    <AppShell pageTitle="dueDates">
      <DeadlineManager
        invoices={[...invoicesWithPayments, ...expenseItems]}
        counterpartyNames={counterpartyNames}
        loadError={null}
        partialDataWarning={partialDataWarning}
        asOfDate={asOfDate}
      />
    </AppShell>
  );
}
