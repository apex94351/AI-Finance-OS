import { z } from "zod";
import { AppShell } from "@/database/components/app-shell";
import { DocumentManager } from "@/database/components/documents/document-manager";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  documentCompanySchema,
  documentInvoiceRowSchema,
  documentRowSchema,
  mapDocument,
} from "@/services/documents";

const membershipSchema = z.array(z.object({ company_id: z.uuid() }));
const documentBaseColumns = "id, company_id, file_path, file_name, file_type, file_size, uploaded_at, deleted_at";
const documentRegistryColumns = `${documentBaseColumns}, category, document_status`;
const personalDocumentColumns = `id, user_id, company_id, file_path, file_name, file_type, file_size, uploaded_at, deleted_at, category, document_status`;

type DocumentQueryError = {
  code?: string;
  message: string;
};

function isMissingColumn(error: DocumentQueryError) {
  return ["42703", "PGRST204"].includes(error.code ?? "");
}

function documentQueryErrorMessage(error: DocumentQueryError, queryName: string) {
  logDocumentQueryFailure(error, queryName);

  if (["42P01", "PGRST205"].includes(error.code ?? "")) {
    return "La table public.documents n’est pas disponible. Vérifiez le schéma distant et appliquez manuellement la migration 010_documents_storage.sql si nécessaire.";
  }
  if (isMissingColumn(error)) {
    return "Le schéma distant ne contient pas les colonnes Documents demandées. Les migrations 011_document_registry.sql (catégorie/statut) et 013_personal_documents.sql (propriété personnelle) sont à vérifier.";
  }
  if (error.code === "42501" || error.code === "403") {
    return "L’accès aux métadonnées Documents est refusé par les permissions ou les policies RLS. Vérifiez les policies du schéma distant.";
  }
  if (["401", "PGRST301", "PGRST302"].includes(error.code ?? "")) {
    return "La session ne permet pas de lire les métadonnées Documents. Reconnectez-vous puis réessayez.";
  }
  if (!error.code || /fetch|network|connection/i.test(error.message)) {
    return "Le service de données n’a pas répondu lors du chargement des documents. Vérifiez la connexion et réessayez.";
  }
  return "Une erreur de base de données a empêché le chargement des documents. Consultez le journal serveur pour le code de la requête.";
}

function logDocumentQueryFailure(error: DocumentQueryError, queryName: string) {
  console.error(`Document ${queryName} query failed`, {
    code: error.code ?? null,
    message: error.message,
  });
}

function normalizeDocumentRows(rows: Record<string, unknown>[], owner: "personal" | "company") {
  return rows.map((row) => ({
    ...row,
    user_id: owner === "personal" ? row.user_id : null,
    category: row.category ?? "other",
    document_status: row.document_status ?? "to_process",
  }));
}

export default async function DocumentsPage() {
  const { supabase, user } = await getAuthenticatedSupabase("/documents");
  const memberships = await supabase.from("company_members").select("company_id").eq("user_id", user.id);
  if (memberships.error) {
    logDocumentQueryFailure(memberships.error, "company membership");
    const message = memberships.error.code === "42501" || memberships.error.code === "403"
      ? "L’accès aux espaces d’entreprise a été refusé par les permissions ou les policies RLS."
      : ["401", "PGRST301", "PGRST302"].includes(memberships.error.code ?? "")
        ? "La session ne permet pas de vérifier les espaces d’entreprise. Reconnectez-vous puis réessayez."
        : "Impossible de vérifier les espaces d’entreprise. Consultez le journal serveur pour le code de la requête.";
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError={message} /></AppShell>;
  }
  const parsedMemberships = membershipSchema.safeParse(memberships.data);
  if (!parsedMemberships.success) {
    console.error("Document membership query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="La liste des espaces associés reçue est invalide." /></AppShell>;
  }

  const companyIds = [...new Set(parsedMemberships.data.map(({ company_id }) => company_id))];
  let companyMembershipRows: unknown[] = [];
  if (companyIds.length) {
    const companiesResult = await supabase.from("companies").select("id, name").in("id", companyIds).order("name");
    if (companiesResult.error) {
      logDocumentQueryFailure(companiesResult.error, "company");
      const message = companiesResult.error.code === "42501" || companiesResult.error.code === "403"
        ? "L’accès aux informations des entreprises est refusé par les permissions ou les policies RLS."
        : "Impossible de charger les espaces associés. Consultez le journal serveur pour le code de la requête.";
      return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError={message} /></AppShell>;
    }
    companyMembershipRows = companiesResult.data;
  }
  const companies = z.array(documentCompanySchema).safeParse(companyMembershipRows);
  if (!companies.success) {
    console.error("Document company query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="Les informations d’entreprise reçues ne sont pas au format attendu." /></AppShell>;
  }

  const companyIdsAccessible = companies.data.map(({ id }) => id);
  const warnings: string[] = [];
  let companyRows: Record<string, unknown>[] = [];
  let personalRows: Record<string, unknown>[] = [];
  let successfulQueries = 0;

  if (companyIdsAccessible.length) {
    const companyResult = await supabase.from("documents")
      .select(documentRegistryColumns)
      .in("company_id", companyIdsAccessible)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });
    if (companyResult.error) {
      if (isMissingColumn(companyResult.error)) {
        const legacyCompanyResult = await supabase.from("documents")
          .select(documentBaseColumns)
          .in("company_id", companyIdsAccessible)
          .is("deleted_at", null)
          .order("uploaded_at", { ascending: false });
        if (legacyCompanyResult.error) {
          warnings.push(documentQueryErrorMessage(legacyCompanyResult.error, "company metadata"));
        } else {
          companyRows = legacyCompanyResult.data ?? [];
          successfulQueries += 1;
          warnings.push("Les documents d’entreprise sont chargés, mais leur classement nécessite la migration locale 011_document_registry.sql.");
        }
      } else {
        warnings.push(documentQueryErrorMessage(companyResult.error, "company metadata"));
      }
    } else {
      companyRows = companyResult.data ?? [];
      successfulQueries += 1;
    }
  }

  const personalResult = await supabase.from("documents")
    .select(personalDocumentColumns)
    .eq("user_id", user.id)
    .is("company_id", null)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (personalResult.error) {
    if (isMissingColumn(personalResult.error)) {
      const legacyPersonalResult = await supabase.from("documents")
        .select(`id, user_id, company_id, file_path, file_name, file_type, file_size, uploaded_at, deleted_at`)
        .eq("user_id", user.id)
        .is("company_id", null)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false });
      if (legacyPersonalResult.error && isMissingColumn(legacyPersonalResult.error)) {
        warnings.push("Les documents personnels ne sont pas disponibles : la migration locale 013_personal_documents.sql n’est pas présente dans le schéma distant.");
      } else if (legacyPersonalResult.error) {
        warnings.push(documentQueryErrorMessage(legacyPersonalResult.error, "personal metadata"));
      } else {
        personalRows = legacyPersonalResult.data ?? [];
        successfulQueries += 1;
        warnings.push("Les documents personnels sont chargés, mais leur classement nécessite la migration locale 011_document_registry.sql.");
      }
    } else {
      warnings.push(documentQueryErrorMessage(personalResult.error, "personal metadata"));
    }
  } else {
    personalRows = personalResult.data ?? [];
    successfulQueries += 1;
  }

  const parsedDocuments = z.array(documentRowSchema).safeParse([
    ...normalizeDocumentRows(personalRows, "personal"),
    ...normalizeDocumentRows(companyRows, "company"),
  ]);
  if (!parsedDocuments.success) {
    console.error("Document metadata query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={companies.data} documents={[]} loadError="Les métadonnées reçues ne sont pas au format attendu." /></AppShell>;
  }
  const documentLoadError = successfulQueries === 0
    ? warnings[0] ?? "Aucune requête de métadonnées Documents n’a pu être exécutée."
    : null;

  const documents = [...parsedDocuments.data]
    .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at));
  const relationsByDocument = new Map<string, {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    supplierName: string | null;
    customerId: string | null;
    supplierId: string | null;
  }[]>();
  let relationshipWarning: string | null = null;

  const companyDocuments = documents.filter(({ company_id }) => company_id !== null);
  if (companyDocuments.length) {
    const invoiceResult = await supabase.from("invoices")
      .select("id, company_id, document_id, invoice_number, customer_id, supplier_id")
      .in("company_id", companies.data.map(({ id }) => id))
      .in("document_id", companyDocuments.map(({ id }) => id));
    if (invoiceResult.error) {
      console.error("Document invoice relation query failed", { code: invoiceResult.error.code });
      relationshipWarning = "Les relations avec les factures n’ont pas pu être chargées.";
    } else {
      const parsedInvoices = z.array(documentInvoiceRowSchema).safeParse(invoiceResult.data);
      if (!parsedInvoices.success) {
        console.error("Document invoice relation query returned an unexpected result");
        relationshipWarning = "Les relations avec les factures reçues ne sont pas au format attendu.";
      } else {
        const contactIds = [...new Set(parsedInvoices.data.flatMap((invoice) => [
          invoice.customer_id,
          invoice.supplier_id,
        ]).filter((id): id is string => Boolean(id)))];
        const contactNames = new Map<string, string>();
        if (contactIds.length) {
          for (const table of ["customers", "suppliers"] as const) {
            const contactResult = await supabase.from(table)
                .select("id, company_id, name")
                .is("user_id", null)
                .in("company_id", companies.data.map(({ id }) => id))
                .in("id", contactIds);
            if (contactResult.error) {
              console.error("Document invoice contact relation query failed", { table, code: contactResult.error.code });
              relationshipWarning = "Certaines relations avec les clients ou fournisseurs ne sont pas disponibles.";
              continue;
            }
            const contacts = z.array(z.object({ id: z.uuid(), company_id: z.uuid(), name: z.string() })).safeParse(contactResult.data);
            if (!contacts.success) {
              console.error("Document invoice contact relation query returned an unexpected result", { table });
              relationshipWarning = "Certaines relations avec les clients ou fournisseurs ne sont pas au format attendu.";
              continue;
            }
            for (const contact of contacts.data) contactNames.set(`${contact.company_id}:${contact.id}`, contact.name);
          }
        }
        for (const invoice of parsedInvoices.data) {
          if (!companyDocuments.some((document) => document.id === invoice.document_id && document.company_id === invoice.company_id)) continue;
          const current = relationsByDocument.get(invoice.document_id) ?? [];
          current.push({
            id: invoice.id,
            invoiceNumber: invoice.invoice_number,
            customerName: invoice.customer_id ? contactNames.get(`${invoice.company_id}:${invoice.customer_id}`) ?? null : null,
            supplierName: invoice.supplier_id ? contactNames.get(`${invoice.company_id}:${invoice.supplier_id}`) ?? null : null,
            customerId: invoice.customer_id,
            supplierId: invoice.supplier_id,
          });
          relationsByDocument.set(invoice.document_id, current);
        }
      }
    }
  }

  return (
    <AppShell pageTitle="documents">
      <DocumentManager
        companies={companies.data}
        documents={documents.map((document) => mapDocument(document, relationsByDocument.get(document.id)))}
        loadError={documentLoadError}
        documentWarning={warnings.length ? [...new Set(warnings)].join(" ") : null}
        relationshipWarning={relationshipWarning}
      />
    </AppShell>
  );
}
