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

export default async function DocumentsPage() {
  const { supabase, user } = await getAuthenticatedSupabase("/documents");
  const memberships = await supabase.from("company_members").select("company_id").eq("user_id", user.id);
  if (memberships.error) {
    console.error("Document membership query failed", { code: memberships.error.code });
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="Impossible de vérifier les espaces d’entreprise de votre compte." /></AppShell>;
  }
  const parsedMemberships = membershipSchema.safeParse(memberships.data);
  if (!parsedMemberships.success) {
    console.error("Document membership query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="La liste des espaces associés reçue est invalide." /></AppShell>;
  }

  const companyIds = [...new Set(parsedMemberships.data.map(({ company_id }) => company_id))];
  let companyRows: unknown[] = [];
  if (companyIds.length) {
    const companiesResult = await supabase.from("companies").select("id, name").in("id", companyIds).order("name");
    if (companiesResult.error) {
      console.error("Document company query failed", { code: companiesResult.error.code });
      return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="Impossible de charger les espaces associés à votre compte." /></AppShell>;
    }
    companyRows = companiesResult.data;
  }
  const companies = z.array(documentCompanySchema).safeParse(companyRows);
  if (!companies.success) {
    console.error("Document company query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={[]} documents={[]} loadError="Les informations d’entreprise reçues ne sont pas au format attendu." /></AppShell>;
  }

  if (!companies.data.length) {
    return (
      <AppShell pageTitle="documents">
        <DocumentManager
          companies={[]}
          documents={[]}
          loadError={null}
          information="Le schéma Documents actuel ne prend en charge que les espaces d’entreprise. Associez une entreprise pour importer des documents."
        />
      </AppShell>
    );
  }

  const result = await supabase.from("documents")
    .select("id, company_id, file_path, file_name, file_type, file_size, uploaded_at, deleted_at, category, document_status")
    .in("company_id", companies.data.map(({ id }) => id))
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (result.error) {
    console.error("Document metadata query failed", { code: result.error.code });
    const migrationMissing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(result.error.code ?? "");
    const message = migrationMissing
      ? result.error.code === "42703" || result.error.code === "PGRST204"
        ? "Les champs du registre documentaire ne sont pas disponibles. Vérifiez le schéma distant et appliquez manuellement la migration 011_document_registry.sql si nécessaire."
        : "Les métadonnées Documents ne sont pas disponibles. Vérifiez le schéma distant et appliquez manuellement la migration 010_documents_storage.sql si nécessaire."
      : "Impossible de charger les documents. Vérifiez les droits RLS et réessayez.";
    return <AppShell pageTitle="documents"><DocumentManager companies={companies.data} documents={[]} loadError={message} /></AppShell>;
  }

  const parsedDocuments = z.array(documentRowSchema).safeParse(result.data);
  if (!parsedDocuments.success) {
    console.error("Document metadata query returned an unexpected result");
    return <AppShell pageTitle="documents"><DocumentManager companies={companies.data} documents={[]} loadError="Les métadonnées reçues ne sont pas au format attendu." /></AppShell>;
  }

  const documents = parsedDocuments.data;
  const relationsByDocument = new Map<string, {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    supplierName: string | null;
    customerId: string | null;
    supplierId: string | null;
  }[]>();
  let relationshipWarning: string | null = null;

  if (documents.length) {
    const invoiceResult = await supabase.from("invoices")
      .select("id, company_id, document_id, invoice_number, customer_id, supplier_id")
      .in("company_id", companies.data.map(({ id }) => id))
      .in("document_id", documents.map(({ id }) => id));
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
          if (!documents.some((document) => document.id === invoice.document_id && document.company_id === invoice.company_id)) continue;
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
        loadError={null}
        relationshipWarning={relationshipWarning}
      />
    </AppShell>
  );
}
