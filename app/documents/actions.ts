"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  documentClassificationSchema,
  documentUploadMetadataSchema,
  isDocumentStoragePathForCompany,
  validateDocumentUpload,
} from "@/services/documents";

export interface DocumentActionState {
  error?: string;
  success?: string;
}

const uuidSchema = z.uuid();
const bucketName = "documents";

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getDocumentAccess(companyId: string) {
  const { supabase, user } = await getAuthenticatedSupabase("/documents");
  if (!uuidSchema.safeParse(companyId).success) {
    return { error: "Sélectionnez un espace d’entreprise valide." } as const;
  }
  const { data, error } = await supabase.from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Document company membership check failed", { code: error.code });
    return { error: "Impossible de vérifier votre accès à cet espace." } as const;
  }
  if (!data) return { error: "Cet espace d’entreprise n’est pas associé à votre compte." } as const;
  return { supabase, user } as const;
}

function documentStorageError(error: { message?: string; statusCode?: string } | null) {
  const code = error?.statusCode;
  if (code === "404" || error?.message?.toLowerCase().includes("bucket")) {
    return "Le stockage Documents n’est pas configuré. Vérifiez le bucket privé et ses policies Storage.";
  }
  if (code === "413" || error?.message?.toLowerCase().includes("size")) {
    return "Le fichier dépasse la taille maximale autorisée de 10 Mo.";
  }
  if (code === "403") return "L’accès au stockage est refusé. Vérifiez les policies Storage de cet espace.";
  return "L’opération sur le stockage a échoué. Vérifiez la configuration et réessayez.";
}

export async function uploadDocument(
  _previousState: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const companyId = formValue(formData, "companyId");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Sélectionnez un fichier à importer." };

  const fileMetadata = documentUploadMetadataSchema.safeParse(file);
  if (!fileMetadata.success) {
    return { error: fileMetadata.error.issues[0]?.message ?? "Vérifiez le fichier sélectionné." };
  }
  const classification = documentClassificationSchema.safeParse({
    category: formValue(formData, "category"),
    status: formValue(formData, "status"),
  });
  if (!classification.success) return { error: "Sélectionnez une catégorie et un statut documentaire valides." };

  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const company = await access.supabase.from("companies").select("id")
    .eq("id", companyId).maybeSingle();
  if (company.error || !company.data) {
    if (company.error) console.error("Document company query failed", { code: company.error.code });
    return { error: "Impossible de vérifier l’espace d’entreprise sélectionné." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateDocumentUpload(fileMetadata.data, bytes);
  if ("error" in validation) return validation;

  const id = crypto.randomUUID();
  const safeName = validation.data.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document";
  const filePath = `${companyId}/${id}-${safeName}`;
  const upload = await access.supabase.storage.from(bucketName).upload(filePath, bytes, {
    contentType: validation.data.type,
    upsert: false,
  });
  if (upload.error) {
    console.error("Document storage upload failed", { statusCode: upload.error.statusCode });
    return { error: documentStorageError(upload.error) };
  }

  const metadata = await access.supabase.from("documents").insert({
    id,
    company_id: companyId,
    file_path: filePath,
    file_name: validation.data.name,
    file_type: validation.data.type,
    file_size: validation.data.size,
    category: classification.data.category,
    document_status: classification.data.status,
  }).select("id").maybeSingle();
  if (metadata.error || !metadata.data) {
    if (metadata.error) console.error("Document metadata insert failed", { code: metadata.error.code });
    const cleanup = await access.supabase.storage.from(bucketName).remove([filePath]);
    if (cleanup.error) {
      console.error("Document upload compensation failed", { statusCode: cleanup.error.statusCode });
      return { error: "Les métadonnées n’ont pas été enregistrées et le fichier temporaire n’a pas pu être nettoyé. Contactez un administrateur." };
    }
    if (metadata.error?.code === "42703" || metadata.error?.code === "PGRST204") {
      return { error: "Les champs du registre documentaire ne sont pas disponibles. Appliquez manuellement la migration 011_document_registry.sql." };
    }
    if (metadata.error && ["42P01", "PGRST205"].includes(metadata.error.code ?? "")) {
      return { error: "La table Documents n’est pas disponible. Appliquez manuellement la migration 010_documents_storage.sql." };
    }
    return { error: "Les métadonnées du fichier n’ont pas été enregistrées. Le fichier temporaire a été nettoyé." };
  }

  revalidatePath("/documents");
  return { success: "Le document a été importé." };
}

export async function createDocumentDownloadUrl(
  companyId: string,
  documentId: string,
): Promise<{ url?: string; error?: string }> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const document = await access.supabase.from("documents")
    .select("file_path")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (document.error) {
    console.error("Document download metadata query failed", { code: document.error.code });
    return { error: "Impossible de vérifier les droits de consultation du document." };
  }
  if (!document.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  if (!isDocumentStoragePathForCompany(document.data.file_path, companyId)) {
    console.error("Document download path does not match its company", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son espace. Contactez un administrateur." };
  }

  const signed = await access.supabase.storage.from(bucketName).createSignedUrl(document.data.file_path, 60);
  if (signed.error || !signed.data) {
    console.error("Document signed URL creation failed", { statusCode: signed.error?.statusCode });
    return { error: documentStorageError(signed.error) };
  }
  return { url: signed.data.signedUrl };
}

export async function deleteDocument(
  companyId: string,
  documentId: string,
): Promise<DocumentActionState> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const document = await access.supabase.from("documents")
    .select("file_path")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (document.error) {
    console.error("Document deletion metadata query failed", { code: document.error.code });
    return { error: "Impossible de vérifier les droits de suppression du document." };
  }
  if (!document.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  if (!isDocumentStoragePathForCompany(document.data.file_path, companyId)) {
    console.error("Document deletion path does not match its company", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son espace. Contactez un administrateur." };
  }

  const invoiceReference = await access.supabase.from("invoices")
    .select("id")
    .eq("document_id", documentId)
    .eq("company_id", companyId)
    .limit(1)
    .maybeSingle();
  if (invoiceReference.error) {
    console.error("Document invoice reference check failed", { code: invoiceReference.error.code });
    return { error: "Impossible de vérifier si une facture utilise ce document. Aucune suppression n’a été effectuée." };
  }
  if (invoiceReference.data) {
    return { error: "Ce document est utilisé par une facture et ne peut pas être supprimé." };
  }

  const archived = await access.supabase.from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (archived.error) {
    console.error("Document archive failed", { code: archived.error.code });
    return { error: "Le document n’a pas pu être supprimé. Vérifiez vos droits et réessayez." };
  }
  if (!archived.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };

  const removal = await access.supabase.storage.from(bucketName).remove([document.data.file_path]);
  if (removal.error) {
    console.error("Document storage removal failed", { statusCode: removal.error.statusCode });
    const rollback = await access.supabase.from("documents")
      .update({ deleted_at: null })
      .eq("id", documentId)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (rollback.error || !rollback.data) {
      console.error("Document deletion rollback failed", { code: rollback.error?.code });
      revalidatePath("/documents");
      return { error: "Le fichier n’a pas pu être supprimé et sa fiche a été archivée. Une intervention est nécessaire pour rétablir ou nettoyer le document." };
    }
    return { error: documentStorageError(removal.error) };
  }

  revalidatePath("/documents");
  return { success: "Le document et sa fiche ont été supprimés." };
}

export async function updateDocumentClassification(
  companyId: string,
  documentId: string,
  category: string,
  status: string,
): Promise<DocumentActionState> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const classification = documentClassificationSchema.safeParse({ category, status });
  if (!classification.success) return { error: "Sélectionnez une catégorie et un statut documentaire valides." };

  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const existing = await access.supabase.from("documents")
    .select("file_path")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) {
    console.error("Document classification access check failed", { code: existing.error.code });
    return { error: "Impossible de vérifier les droits de modification du document." };
  }
  if (!existing.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  if (!isDocumentStoragePathForCompany(existing.data.file_path, companyId)) {
    console.error("Document classification path does not match its company", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son espace. Contactez un administrateur." };
  }

  const update = await access.supabase.from("documents")
    .update({
      category: classification.data.category,
      document_status: classification.data.status,
    })
    .eq("id", documentId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (update.error || !update.data) {
    if (update.error) console.error("Document classification update failed", { code: update.error.code });
    if (update.error?.code === "42703" || update.error?.code === "PGRST204") {
      return { error: "Les champs du registre documentaire ne sont pas disponibles. Appliquez manuellement la migration 011_document_registry.sql." };
    }
    return { error: "Le classement du document n’a pas pu être enregistré. Vérifiez vos droits et réessayez." };
  }

  revalidatePath("/documents");
  return { success: "Le classement du document a été enregistré." };
}
