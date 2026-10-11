import { z } from "zod";
import { InvoiceManager } from "@/database/components/invoices/invoice-manager";
import type { InvoiceDashboardFilter } from "@/database/components/invoices/invoice-manager";
import { AppShell } from "@/database/components/app-shell";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { getEffectiveInvoiceStatus, getInvoiceRemainingAmount, getVerifiedInvoiceSourceDocumentCategory } from "@/services/invoice-validation";
import { contactRowSchema, mapContact } from "@/services/contacts";
import type { ContactRecord, InvoiceCompany, InvoiceRecord } from "@/types/invoice";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const companySchema = z.array(z.object({
  id: z.uuid(),
  name: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}));
const numericValue = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number),
]).nullable();
const invoiceSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  invoice_type: z.enum(["customer", "supplier"]).nullable().optional(),
  customer_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
  document_id: z.uuid().nullable(),
  invoice_number: z.string().nullable(),
  client_name: z.string().nullable(),
  description: z.string().nullable(),
  issue_date: z.string().nullable(),
  due_date: z.string().nullable(),
  subtotal_ht: numericValue,
  vat_rate: numericValue,
  vat_amount: numericValue,
  total_ttc: numericValue,
  currency: z.string().nullable(),
  status: z.enum(["draft", "pending", "paid", "overdue", "receivable", "cancelled"]),
  category: z.string().nullable(),
  ai_summary: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));
const invoiceSourceDocumentSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  file_name: z.string(),
  category: z.enum(["customer_invoice", "supplier_invoice"]),
});
const invoicePaymentSchema = z.array(z.object({ invoice_id: z.uuid(), amount: numericValue }));
const linkedSupplierExpenseSchema = z.array(z.object({
  id: z.uuid(),
  invoice_id: z.uuid(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
}));
const expensePaymentSchema = z.array(z.object({ expense_id: z.uuid(), amount: numericValue }));
const sourceDocumentRowSchema = z.array(z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  category: z.string(),
}));

function readErrorString(error: unknown, key: string): string | null {
  if (error === null || typeof error !== "object") return null;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function serializeInvoiceQueryError(error: unknown, depth = 0): Record<string, unknown> {
  if (typeof error === "string") {
    return { name: null, message: error, code: null, details: null, hint: null, cause: null };
  }
  if (error === null || typeof error !== "object") {
    return {
      name: null,
      message: null,
      code: null,
      details: null,
      hint: null,
      cause: null,
      errorType: typeof error,
    };
  }

  const cause = (error as Record<string, unknown>).cause;
  return {
    name: readErrorString(error, "name") ?? (error instanceof Error ? error.name : null),
    message: readErrorString(error, "message"),
    code: readErrorString(error, "code"),
    details: readErrorString(error, "details"),
    hint: readErrorString(error, "hint"),
    cause: depth < 2 && cause !== undefined
      ? serializeInvoiceQueryError(cause, depth + 1)
      : null,
    errorType: error instanceof Error ? error.constructor.name : "object",
    ownProperties: Object.getOwnPropertyNames(error)
      .filter((key) => ["name", "message", "code", "details", "hint", "cause"].includes(key)),
  };
}

function logInvoiceQueryError(context: "personal_invoices" | "company_invoices", error: unknown) {
  console.error(
    "Invoice query failed",
    JSON.stringify({ context, ...serializeInvoiceQueryError(error) }),
  );
}

function databaseSchemaError(code: string): string {
  return code === "42703" || code === "PGRST204" || code === "22P02"
    ? "Le schéma Supabase des factures doit inclure les migrations Factures, 008_contacts_and_invoice_parties.sql et 017_invoice_directions_and_customer_payments.sql."
    : "Impossible de charger les factures pour le moment. Réessayez plus tard.";
}

function mapCompany(company: z.infer<typeof companySchema>[number]): InvoiceCompany {
  return { id: company.id, name: company.name, currency: company.currency };
}

function mapInvoice(
  invoice: z.infer<typeof invoiceSchema>[number],
  sourceDocumentCategory: "customer_invoice" | "supplier_invoice" | null = null,
): InvoiceRecord {
  const status = getEffectiveInvoiceStatus(invoice.status, invoice.due_date);
  return {
    id: invoice.id,
    userId: invoice.user_id,
    companyId: invoice.company_id,
    invoiceType: invoice.invoice_type,
    sourceDocumentCategory,
    customerId: invoice.customer_id,
    supplierId: invoice.supplier_id,
    documentId: invoice.document_id,
    invoiceNumber: invoice.invoice_number,
    clientName: invoice.client_name,
    description: invoice.description,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    subtotal: invoice.subtotal_ht,
    vatRate: invoice.vat_rate,
    vatAmount: invoice.vat_amount,
    total: invoice.total_ttc,
    currency: invoice.currency,
    status,
    category: invoice.category,
    analysis: null,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ partyType?: string; partyId?: string; companyId?: string; documentId?: string; dashboardFilter?: string; overviewPeriod?: string }>;
} = {}) {
  const { partyType, partyId, companyId, documentId, dashboardFilter, overviewPeriod } = searchParams ? await searchParams : {};
  const initialPartyType = partyType === "customer" || partyType === "supplier" ? partyType : undefined;
  const dashboardFilters: InvoiceDashboardFilter[] = [
    "customer-open",
    "supplier-open",
    "customer-invoices",
    "customer-overdue",
    "supplier-upcoming",
    "all-overdue",
  ];
  const initialDashboardFilter = dashboardFilters.find((filter) => filter === dashboardFilter);
  const initialOverviewPeriod = overviewPeriod === "month" || overviewPeriod === "year" || overviewPeriod === "all"
    ? overviewPeriod
    : undefined;
  const { supabase, user } = await getAuthenticatedSupabase("/invoices");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Invoice membership query failed", { code: membershipResult.error.code });
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
      </AppShell>
    );
  }

  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Invoice membership query returned an unexpected result");
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="La liste des espaces d’entreprise reçue est invalide." initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
      </AppShell>
    );
  }

  const companyIds = [...new Set(memberships.data.map(({ company_id }) => company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length > 0) {
    const companyResult = await supabase
      .from("companies")
      .select("id, name, currency")
      .in("id", companyIds);
    if (companyResult.error) {
      console.error("Invoice company query failed", { code: companyResult.error.code });
      return (
        <AppShell pageTitle="invoices">
          <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Impossible de charger les entreprises associées à votre compte." initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
        </AppShell>
      );
    }
    companyRows = companyResult.data;
  }

  const companies = companySchema.safeParse(companyRows);
  if (!companies.success) {
    console.error("Invoice company query returned an unexpected result");
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Les informations d’entreprise reçues sont invalides." initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
      </AppShell>
    );
  }

  const accessibleCompanyIds = companies.data.map(({ id }) => id);
  const asOfDate = new Date().toISOString().slice(0, 10);
  const syncPersonalOverdue = await supabase
    .from("invoices")
    .update({ status: "overdue" })
    .eq("user_id", user.id)
    .is("company_id", null)
    .in("status", ["pending", "receivable"])
    .lt("due_date", asOfDate)
    .not("due_date", "is", null);
  if (syncPersonalOverdue.error) {
    console.error("Personal overdue invoice synchronization failed", { code: syncPersonalOverdue.error.code });
  }
  if (accessibleCompanyIds.length > 0) {
    const syncCompanyOverdue = await supabase
      .from("invoices")
      .update({ status: "overdue" })
      .in("company_id", accessibleCompanyIds)
      .is("user_id", null)
      .in("status", ["pending", "receivable"])
      .lt("due_date", asOfDate)
      .not("due_date", "is", null);
    if (syncCompanyOverdue.error) {
      console.error("Company overdue invoice synchronization failed", { code: syncCompanyOverdue.error.code });
    }
  }

  let contacts: ContactRecord[] = [];
  let contactWarning: string | null = null;
  const contactColumns = "id, user_id, company_id, name, email, phone, address, notes, created_at, updated_at";
  const [personalCustomers, personalSuppliers] = await Promise.all([
    supabase.from("customers").select(contactColumns).eq("user_id", user.id).is("company_id", null).order("name"),
    supabase.from("suppliers").select(contactColumns).eq("user_id", user.id).is("company_id", null).order("name"),
  ]);
  const companyContacts = companyIds.length
    ? await Promise.all([
      supabase.from("customers").select(contactColumns).in("company_id", companyIds).is("user_id", null).order("name"),
      supabase.from("suppliers").select(contactColumns).in("company_id", companyIds).is("user_id", null).order("name"),
    ])
    : null;
  const contactErrors = [
    personalCustomers.error,
    personalSuppliers.error,
    companyContacts?.[0].error ?? null,
    companyContacts?.[1].error ?? null,
  ].filter(Boolean);
  if (contactErrors.length) {
    console.error("Invoice counterparty query failed", { code: contactErrors[0]?.code });
    contactWarning = "La migration 008 des clients et fournisseurs n’est pas encore disponible. Les factures sans tiers associé restent utilisables.";
  } else {
    const parsedCustomers = z.array(contactRowSchema).safeParse([
      ...(personalCustomers.data ?? []),
      ...(companyContacts?.[0].data ?? []),
    ]);
    const parsedSuppliers = z.array(contactRowSchema).safeParse([
      ...(personalSuppliers.data ?? []),
      ...(companyContacts?.[1].data ?? []),
    ]);
    if (parsedCustomers.success && parsedSuppliers.success) {
      contacts = [
        ...parsedCustomers.data.map((row) => mapContact(row, "customers")),
        ...parsedSuppliers.data.map((row) => mapContact(row, "suppliers")),
      ];
    } else {
      console.error("Invoice counterparty query returned an unexpected result");
      contactWarning = "Les fiches clients et fournisseurs reçues ne sont pas au format attendu.";
    }
  }

  const invoiceColumns = "id, user_id, company_id, invoice_type, customer_id, supplier_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_rate, vat_amount, total_ttc, currency, status, category, ai_summary, created_at, updated_at";
  const legacyInvoiceColumns = invoiceColumns.replace("invoice_type, ", "");
  let invoiceTypeAvailable = true;
  let personalInvoiceResult = await supabase
    .from("invoices")
    .select(invoiceColumns)
    .eq("user_id", user.id)
    .is("company_id", null)
    .order("issue_date", { ascending: false, nullsFirst: false });
  if (["42703", "PGRST204"].includes(personalInvoiceResult.error?.code ?? "")) {
    personalInvoiceResult = await supabase
      .from("invoices")
      .select(legacyInvoiceColumns)
      .eq("user_id", user.id)
      .is("company_id", null)
      .order("issue_date", { ascending: false, nullsFirst: false }) as typeof personalInvoiceResult;
    invoiceTypeAvailable = false;
  }
  if (personalInvoiceResult.error) {
    logInvoiceQueryError("personal_invoices", personalInvoiceResult.error);
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError={databaseSchemaError(personalInvoiceResult.error.code)} contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
      </AppShell>
    );
  }

  let companyInvoices: unknown[] = [];
  if (accessibleCompanyIds.length > 0) {
    let companyInvoiceResult = await supabase
      .from("invoices")
      .select(invoiceColumns)
      .in("company_id", accessibleCompanyIds)
      .is("user_id", null)
      .order("issue_date", { ascending: false, nullsFirst: false });
    if (["42703", "PGRST204"].includes(companyInvoiceResult.error?.code ?? "")) {
      companyInvoiceResult = await supabase
        .from("invoices")
        .select(legacyInvoiceColumns)
        .in("company_id", accessibleCompanyIds)
        .is("user_id", null)
        .order("issue_date", { ascending: false, nullsFirst: false }) as typeof companyInvoiceResult;
      invoiceTypeAvailable = false;
    }
    if (companyInvoiceResult.error) {
      logInvoiceQueryError("company_invoices", companyInvoiceResult.error);
      return (
        <AppShell pageTitle="invoices">
          <InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError={databaseSchemaError(companyInvoiceResult.error.code)} contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} />
        </AppShell>
      );
    }
    companyInvoices = companyInvoiceResult.data;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalInvoiceResult.data, ...companyInvoices]);
  if (!parsedInvoices.success) {
    console.error("Invoice query returned an unexpected result");
    return <AppShell pageTitle="invoices"><InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError="Les factures reçues ne sont pas au format attendu." contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} initialDashboardFilter={initialDashboardFilter} /></AppShell>;
  }

  const sourceDocumentIds = [...new Set(parsedInvoices.data.flatMap(({ document_id }) => document_id ? [document_id] : []))];
  const sourceDocumentCategories = new Map<string, "customer_invoice" | "supplier_invoice">();
  let schemaWarning: string | null = invoiceTypeAvailable
    ? null
    : "La migration 017 n’est pas installée : les types enregistrés sont indisponibles. Les factures liées à un tiers ou à un document catégorisé restent classées ; les autres demandent une qualification.";
  if (sourceDocumentIds.length) {
    const sourceDocumentsResult = await supabase.from("documents")
      .select("id, user_id, company_id, category")
      .in("id", sourceDocumentIds);
    const sourceDocuments = sourceDocumentRowSchema.safeParse(sourceDocumentsResult.data ?? []);
    if (sourceDocumentsResult.error || !sourceDocuments.success) {
      console.error("Invoice source document category lookup failed", { code: sourceDocumentsResult.error?.code ?? "INVALID_RESULT" });
      schemaWarning = [schemaWarning, "Les catégories des documents sources ne sont pas disponibles ; les factures sans tiers lié restent à qualifier."]
        .filter(Boolean).join(" ");
    } else {
      for (const invoice of parsedInvoices.data) {
        if (!invoice.document_id) continue;
        const sourceDocument = sourceDocuments.data.find(({ id }) => id === invoice.document_id);
        if (!sourceDocument) continue;
        const category = getVerifiedInvoiceSourceDocumentCategory({
          documentId: invoice.document_id,
          userId: invoice.user_id,
          companyId: invoice.company_id,
        }, {
          id: sourceDocument.id,
          userId: sourceDocument.user_id,
          companyId: sourceDocument.company_id,
          category: sourceDocument.category,
        });
        if (category) sourceDocumentCategories.set(invoice.id, category);
      }
    }
  }
  const classifiedInvoiceRows = parsedInvoices.data.map((row) => ({
    ...row,
    invoice_type: row.invoice_type ?? (sourceDocumentCategories.get(row.id) === "customer_invoice"
      ? "customer"
      : sourceDocumentCategories.get(row.id) === "supplier_invoice" ? "supplier" : null),
  }));

  const invoiceIds = classifiedInvoiceRows.map(({ id }) => id);
  const customerPaymentsResult = invoiceIds.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  const parsedCustomerPayments = invoicePaymentSchema.safeParse(customerPaymentsResult.data ?? []);
  const customerPaymentsUnavailable = Boolean(customerPaymentsResult.error || !parsedCustomerPayments.success);
  const customerPaymentLedgerMissing = Boolean(customerPaymentsResult.error
    && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(customerPaymentsResult.error.code ?? ""));
  if (customerPaymentsUnavailable) {
    console.error("Customer invoice payment query unavailable", { code: customerPaymentsResult.error?.code ?? "INVALID_RESULT" });
    schemaWarning = [schemaWarning, customerPaymentLedgerMissing
      ? "La migration 017 n’est pas installée : les factures restent affichées, mais les paiements partiels clients ne sont pas disponibles."
      : "Le registre de paiements clients est inaccessible ; les soldes concernés sont marqués à vérifier."]
      .filter(Boolean).join(" ");
  }
  const customerPaymentRows = !customerPaymentsUnavailable && !customerPaymentsResult.error && parsedCustomerPayments.success
    ? parsedCustomerPayments.data
    : [];
  const paidByInvoice = new Map<string, number>();
  for (const payment of customerPaymentRows) {
    if (payment.amount === null) continue;
    paidByInvoice.set(payment.invoice_id, Math.round(((paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount) * 100) / 100);
  }

  const supplierInvoiceIds = classifiedInvoiceRows
    .filter(({ invoice_type, supplier_id }) => invoice_type === "supplier" || supplier_id !== null)
    .map(({ id }) => id);
  const supplierExpensesResult = supplierInvoiceIds.length
    ? await supabase.from("expenses").select("id, invoice_id, status").in("invoice_id", supplierInvoiceIds)
    : { data: [], error: null };
  const parsedSupplierExpenses = linkedSupplierExpenseSchema.safeParse(supplierExpensesResult.data ?? []);
  const supplierExpensesUnavailable = Boolean(supplierExpensesResult.error || !parsedSupplierExpenses.success);
  if (supplierExpensesUnavailable) {
    console.error("Linked supplier expense query unavailable", { code: supplierExpensesResult.error?.code ?? "INVALID_RESULT" });
    schemaWarning = [schemaWarning, "Les paiements fournisseurs liés à une dépense ne peuvent pas être vérifiés ; leurs soldes sont marqués à vérifier."]
      .filter(Boolean).join(" ");
  }
  const linkedSupplierExpenses = !supplierExpensesUnavailable && !supplierExpensesResult.error && parsedSupplierExpenses.success
    ? parsedSupplierExpenses.data
    : [];
  const expenseIds = linkedSupplierExpenses.map(({ id }) => id);
  const supplierPaymentsResult = expenseIds.length
    ? await supabase.from("expense_payments").select("expense_id, amount").in("expense_id", expenseIds)
    : { data: [], error: null };
  const parsedSupplierPayments = expensePaymentSchema.safeParse(supplierPaymentsResult.data ?? []);
  const supplierPaymentsUnavailable = Boolean(supplierPaymentsResult.error || !parsedSupplierPayments.success);
  if (supplierPaymentsUnavailable) {
    console.error("Linked supplier invoice payment query unavailable", { code: supplierPaymentsResult.error?.code ?? "INVALID_RESULT" });
    schemaWarning = [schemaWarning, "L’historique de paiements fournisseurs est inaccessible ; les factures liées restent visibles, avec un solde à vérifier."]
      .filter(Boolean).join(" ");
  }
  const paidByExpense = new Map<string, number>();
  const supplierPaymentRows = !supplierPaymentsUnavailable && !supplierPaymentsResult.error && parsedSupplierPayments.success
    ? parsedSupplierPayments.data
    : [];
  for (const payment of supplierPaymentRows) {
    if (payment.amount === null) continue;
    paidByExpense.set(payment.expense_id, Math.round(((paidByExpense.get(payment.expense_id) ?? 0) + payment.amount) * 100) / 100);
  }
  const paidBySupplierInvoice = new Map<string, number>();
  for (const expense of linkedSupplierExpenses) {
    const invoiceTotal = classifiedInvoiceRows.find(({ id }) => id === expense.invoice_id)?.total_ttc ?? 0;
    const paidAmount = expense.status === "paid" ? invoiceTotal : paidByExpense.get(expense.id) ?? 0;
    paidBySupplierInvoice.set(expense.invoice_id, Math.round(((paidBySupplierInvoice.get(expense.invoice_id) ?? 0) + paidAmount) * 100) / 100);
  }
  const invoicesWithPayments = classifiedInvoiceRows.map((row) => {
    const invoice = mapInvoice(row, sourceDocumentCategories.get(row.id) ?? null);
    const isCustomer = row.invoice_type === "customer" || row.customer_id !== null;
    const isSupplier = row.invoice_type === "supplier" || row.supplier_id !== null;
    const paidAmount = isCustomer
      ? customerPaymentsUnavailable && !customerPaymentLedgerMissing ? null : paidByInvoice.get(row.id) ?? 0
      : isSupplier
        ? supplierExpensesUnavailable || supplierPaymentsUnavailable ? null : paidBySupplierInvoice.get(row.id) ?? 0
        : 0;
    return {
      ...invoice,
      paidAmount: invoice.status === "paid" ? invoice.total ?? 0 : paidAmount,
      remainingAmount: getInvoiceRemainingAmount(invoice.total, paidAmount, invoice.status),
    };
  });

  let sourceDocument: {
    id: string;
    companyId: string;
    fileName: string;
    category: "customer_invoice" | "supplier_invoice";
    linkedInvoice?: InvoiceRecord;
  } | null = null;
  let sourceDocumentError: string | null = null;
  if (documentId) {
    if (!z.uuid().safeParse(documentId).success
      || !z.uuid().safeParse(companyId).success
      || !companies.data.some((company) => company.id === companyId)) {
      sourceDocumentError = "Le document source demandé n’appartient pas à un espace accessible.";
    } else {
      const sourceResult = await supabase.from("documents")
        .select("id, company_id, file_name, category")
        .eq("id", documentId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (sourceResult.error) {
        console.error("Invoice source document query failed", { code: sourceResult.error.code });
        sourceDocumentError = "Le document source n’est pas disponible. Vérifiez les migrations Documents 010 et 011.";
      } else {
        const parsedSource = invoiceSourceDocumentSchema.safeParse(sourceResult.data);
        if (!parsedSource.success) {
          sourceDocumentError = "Le document source est absent, archivé ou n’est pas classé comme facture.";
        } else {
          const linkedInvoice = parsedInvoices.data
            .map((row) => mapInvoice(row, sourceDocumentCategories.get(row.id) ?? null))
            .find((invoice) => invoice.documentId === parsedSource.data.id);
          sourceDocument = {
            id: parsedSource.data.id,
            companyId: parsedSource.data.company_id,
            fileName: parsedSource.data.file_name,
            category: parsedSource.data.category,
            ...(linkedInvoice ? { linkedInvoice } : {}),
          };
        }
      }
    }
  }

  return (
    <AppShell pageTitle="invoices">
      <InvoiceManager
        companies={companies.data.map(mapCompany)}
        contacts={contacts}
        invoices={invoicesWithPayments}
        loadError={null}
        contactWarning={[contactWarning, schemaWarning].filter(Boolean).join(" ") || null}
        initialPartyType={initialPartyType}
        initialPartyId={partyId}
        initialDashboardFilter={initialDashboardFilter}
        initialOverviewPeriod={initialOverviewPeriod}
        initialCompanyId={companies.data.some(({ id }) => id === companyId) ? companyId : undefined}
        sourceDocument={sourceDocument}
        sourceDocumentError={sourceDocumentError}
      />
    </AppShell>
  );
}
