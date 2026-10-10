import { z } from "zod";
import { InvoiceManager } from "@/database/components/invoices/invoice-manager";
import { AppShell } from "@/database/components/app-shell";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { deriveInvoiceStatus } from "@/services/invoice-validation";
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
    ? "Le schéma Supabase des factures doit inclure les migrations Factures et la migration 008_contacts_and_invoice_parties.sql."
    : "Impossible de charger les factures pour le moment. Réessayez plus tard.";
}

function mapCompany(company: z.infer<typeof companySchema>[number]): InvoiceCompany {
  return { id: company.id, name: company.name, currency: company.currency };
}

function mapInvoice(invoice: z.infer<typeof invoiceSchema>[number]): InvoiceRecord {
  const status = invoice.status === "pending" || invoice.status === "overdue"
    ? deriveInvoiceStatus(invoice.due_date)
    : invoice.status;
  return {
    id: invoice.id,
    userId: invoice.user_id,
    companyId: invoice.company_id,
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
  searchParams?: Promise<{ partyType?: string; partyId?: string; companyId?: string; documentId?: string }>;
} = {}) {
  const { partyType, partyId, companyId, documentId } = searchParams ? await searchParams : {};
  const initialPartyType = partyType === "customer" || partyType === "supplier" ? partyType : undefined;
  const { supabase, user } = await getAuthenticatedSupabase("/invoices");
  const membershipResult = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id);

  if (membershipResult.error) {
    console.error("Invoice membership query failed", { code: membershipResult.error.code });
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." initialPartyType={initialPartyType} initialPartyId={partyId} />
      </AppShell>
    );
  }

  const memberships = membershipSchema.safeParse(membershipResult.data);
  if (!memberships.success) {
    console.error("Invoice membership query returned an unexpected result");
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="La liste des espaces d’entreprise reçue est invalide." initialPartyType={initialPartyType} initialPartyId={partyId} />
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
          <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Impossible de charger les entreprises associées à votre compte." initialPartyType={initialPartyType} initialPartyId={partyId} />
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
        <InvoiceManager companies={[]} contacts={[]} invoices={[]} loadError="Les informations d’entreprise reçues sont invalides." initialPartyType={initialPartyType} initialPartyId={partyId} />
      </AppShell>
    );
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

  const invoiceColumns = "id, user_id, company_id, customer_id, supplier_id, document_id, invoice_number, client_name, description, issue_date, due_date, subtotal_ht, vat_rate, vat_amount, total_ttc, currency, status, category, ai_summary, created_at, updated_at";
  const personalInvoiceResult = await supabase
    .from("invoices")
    .select(invoiceColumns)
    .eq("user_id", user.id)
    .is("company_id", null)
    .order("issue_date", { ascending: false, nullsFirst: false });
  if (personalInvoiceResult.error) {
    logInvoiceQueryError("personal_invoices", personalInvoiceResult.error);
    return (
      <AppShell pageTitle="invoices">
        <InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError={databaseSchemaError(personalInvoiceResult.error.code)} contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} />
      </AppShell>
    );
  }

  const accessibleCompanyIds = companies.data.map(({ id }) => id);
  let companyInvoices: unknown[] = [];
  if (accessibleCompanyIds.length > 0) {
    const companyInvoiceResult = await supabase
      .from("invoices")
      .select(invoiceColumns)
      .in("company_id", accessibleCompanyIds)
      .is("user_id", null)
      .order("issue_date", { ascending: false, nullsFirst: false });
    if (companyInvoiceResult.error) {
      logInvoiceQueryError("company_invoices", companyInvoiceResult.error);
      return (
        <AppShell pageTitle="invoices">
          <InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError={databaseSchemaError(companyInvoiceResult.error.code)} contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} />
        </AppShell>
      );
    }
    companyInvoices = companyInvoiceResult.data;
  }

  const parsedInvoices = invoiceSchema.safeParse([...personalInvoiceResult.data, ...companyInvoices]);
  if (!parsedInvoices.success) {
    console.error("Invoice query returned an unexpected result");
    return <AppShell pageTitle="invoices"><InvoiceManager companies={companies.data.map(mapCompany)} contacts={contacts} invoices={[]} loadError="Les factures reçues ne sont pas au format attendu." contactWarning={contactWarning} initialPartyType={initialPartyType} initialPartyId={partyId} /></AppShell>;
  }

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
            .map(mapInvoice)
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
        invoices={parsedInvoices.data.map(mapInvoice)}
        loadError={null}
        contactWarning={contactWarning}
        initialPartyType={initialPartyType}
        initialPartyId={partyId}
        initialCompanyId={companies.data.some(({ id }) => id === companyId) ? companyId : undefined}
        sourceDocument={sourceDocument}
        sourceDocumentError={sourceDocumentError}
      />
    </AppShell>
  );
}
