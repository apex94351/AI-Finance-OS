"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  documentClassificationSchema,
  DOCUMENT_MAX_SIZE,
  DOCUMENT_MIME_TYPES,
  documentUploadMetadataSchema,
  detectDocumentMime,
  isDocumentStoragePathForCompany,
  isDocumentStoragePathForUser,
  validateDocumentUpload,
} from "@/services/documents";
import {
  extractPdfText,
  PDF_MAX_PAGES,
  PDF_MAX_SIZE_BYTES,
  PDF_MAX_TEXT_CHARACTERS,
} from "@/services/pdf-text-extraction";

export interface DocumentActionState {
  error?: string;
  success?: string;
}

const uuidSchema = z.uuid();
const bucketName = "documents";
const MAX_CONCURRENT_DOCUMENT_EXTRACTIONS = 2;
let activeDocumentExtractions = 0;

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getDocumentAccess(companyId: string | null) {
  const { supabase, user } = await getAuthenticatedSupabase("/documents");
  if (!companyId) return { supabase, user } as const;
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
  if (code === "403") return "L’accès au stockage est refusé. Vérifiez les policies Storage du propriétaire sélectionné.";
  return "L’opération sur le stockage a échoué. Vérifiez la configuration et réessayez.";
}

export async function uploadDocument(
  _previousState: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const companyId = formValue(formData, "companyId") || null;
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

  if (companyId) {
    const company = await access.supabase.from("companies").select("id")
      .eq("id", companyId).maybeSingle();
    if (company.error || !company.data) {
      if (company.error) console.error("Document company query failed", { code: company.error.code });
      return { error: "Impossible de vérifier l’espace d’entreprise sélectionné." };
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateDocumentUpload(fileMetadata.data, bytes);
  if ("error" in validation) return validation;

  const id = crypto.randomUUID();
  const safeName = validation.data.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document";
  const ownerId = companyId ?? access.user.id;
  const filePath = companyId
    ? `${companyId}/${id}-${safeName}`
    : `${ownerId}/personal/${id}-${safeName}`;
  const upload = await access.supabase.storage.from(bucketName).upload(filePath, bytes, {
    contentType: validation.data.type,
    upsert: false,
  });
  if (upload.error) {
    console.error("Document storage upload failed", { statusCode: upload.error.statusCode });
    if (!companyId && upload.error.statusCode === "403") {
      return { error: "L’import personnel nécessite les policies de stockage de la migration 013_personal_documents.sql." };
    }
    return { error: documentStorageError(upload.error) };
  }

  const metadata = await access.supabase.from("documents").insert({
    id,
    company_id: companyId,
    user_id: companyId ? null : access.user.id,
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
      return {
        error: companyId
          ? "Les champs du registre documentaire ne sont pas disponibles. Appliquez manuellement la migration 011_document_registry.sql."
          : "La propriété personnelle des documents n’est pas disponible. Appliquez manuellement la migration 013_personal_documents.sql après la migration 011_document_registry.sql.",
      };
    }
    if (!companyId && metadata.error?.code === "23502") {
      return { error: "La table Documents exige encore une entreprise. Appliquez manuellement la migration 013_personal_documents.sql." };
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
  companyId: string | null,
  documentId: string,
): Promise<{ url?: string; fileType?: (typeof DOCUMENT_MIME_TYPES)[number]; error?: string }> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const documentQuery = access.supabase.from("documents")
    .select("file_path, file_type")
    .eq("id", documentId)
    .is("deleted_at", null);
  const document = companyId
    ? await documentQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
    : await documentQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
  if (document.error) {
    console.error("Document download metadata query failed", { code: document.error.code });
    return { error: "Impossible de vérifier les droits de consultation du document." };
  }
  if (!document.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  if (!DOCUMENT_MIME_TYPES.includes(document.data.file_type)) {
    console.error("Document preview blocked for unsupported MIME type", { documentId });
    return { error: "Ce format de document ne peut pas être lu dans l’application." };
  }
  const validPath = companyId
    ? isDocumentStoragePathForCompany(document.data.file_path, companyId)
    : isDocumentStoragePathForUser(document.data.file_path, access.user.id);
  if (!validPath) {
    console.error("Document download path does not match its owner", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son propriétaire. Contactez un administrateur." };
  }

  const signed = await access.supabase.storage.from(bucketName).createSignedUrl(document.data.file_path, 60);
  if (signed.error || !signed.data) {
    console.error("Document signed URL creation failed", { statusCode: signed.error?.statusCode });
    return { error: documentStorageError(signed.error) };
  }
  return { url: signed.data.signedUrl, fileType: document.data.file_type };
}

type DocumentExtractionPreparationResult =
  | {
      status: "ready";
      mimeType: "application/pdf";
      pageCount: number;
      extractedCharacterCount: number;
    }
  | {
      status: "ocr_required";
      mimeType: "application/pdf" | "image/jpeg" | "image/png";
      reason: "no_text" | "insufficient_text" | "image";
    }
  | {
      status: "error";
      code: "DOCUMENT_UNAVAILABLE" | "TOO_LARGE" | "INVALID_FILE" | "PROCESSING_FAILED" | "BUSY";
      message: string;
    };

const unavailableExtractionResult: DocumentExtractionPreparationResult = {
  status: "error",
  code: "DOCUMENT_UNAVAILABLE",
  message: "Ce document n’existe pas ou n’est pas accessible.",
};

export async function prepareDocumentExtraction(
  documentId: string,
): Promise<DocumentExtractionPreparationResult> {
  if (!uuidSchema.safeParse(documentId).success) return unavailableExtractionResult;
  const { supabase, user } = await getAuthenticatedSupabase("/documents");
  if (activeDocumentExtractions >= MAX_CONCURRENT_DOCUMENT_EXTRACTIONS) {
    return {
      status: "error",
      code: "BUSY",
      message: "Le service de préparation est momentanément occupé. Réessayez plus tard.",
    };
  }
  activeDocumentExtractions += 1;
  try {
    const metadata = await supabase.from("documents")
      .select("id, user_id, company_id, file_path, file_type, file_size")
      .eq("id", documentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (metadata.error) {
      console.error("Document extraction metadata query failed", { code: metadata.error.code });
      return unavailableExtractionResult;
    }
    const document = metadata.data;
    if (!document || (document.user_id === null) === (document.company_id === null)) {
      return unavailableExtractionResult;
    }

    if (document.company_id !== null) {
      const access = await supabase.from("company_members")
        .select("company_id")
        .eq("company_id", document.company_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (access.error) {
        console.error("Document extraction company access check failed", { code: access.error.code });
        return unavailableExtractionResult;
      }
      if (!access.data) return unavailableExtractionResult;
    } else if (document.user_id !== user.id) {
      return unavailableExtractionResult;
    }

    const validPath = document.company_id !== null
      ? isDocumentStoragePathForCompany(document.file_path, document.company_id)
      : isDocumentStoragePathForUser(document.file_path, user.id);
    if (!validPath || !DOCUMENT_MIME_TYPES.includes(document.file_type)) {
      console.error("Document extraction metadata rejected", { documentId });
      return unavailableExtractionResult;
    }

    const fileSize = Number(document.file_size);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > DOCUMENT_MAX_SIZE) {
      return {
        status: "error",
        code: "TOO_LARGE",
        message: "Le document dépasse la taille maximale autorisée.",
      };
    }
    if (fileSize > PDF_MAX_SIZE_BYTES) {
      return {
        status: "error",
        code: "TOO_LARGE",
        message: "Le document dépasse la taille maximale de traitement.",
      };
    }

    let downloaded;
    try {
      downloaded = await supabase.storage.from(bucketName).download(document.file_path);
    } catch {
      return {
        status: "error",
        code: "PROCESSING_FAILED",
        message: "Le document n’a pas pu être préparé.",
      };
    }
    if (downloaded.error || !downloaded.data) {
      console.error("Document extraction storage download failed", {
        statusCode: downloaded.error?.statusCode,
      });
      return {
        status: "error",
        code: "PROCESSING_FAILED",
        message: "Le document n’a pas pu être préparé.",
      };
    }
    if (downloaded.data.size !== fileSize || downloaded.data.size > PDF_MAX_SIZE_BYTES) {
      return {
        status: "error",
        code: downloaded.data.size > PDF_MAX_SIZE_BYTES ? "TOO_LARGE" : "INVALID_FILE",
        message: downloaded.data.size > PDF_MAX_SIZE_BYTES
          ? "Le document dépasse la taille maximale de traitement."
          : "Le fichier stocké ne correspond pas à ses métadonnées.",
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    } catch {
      return {
        status: "error",
        code: "PROCESSING_FAILED",
        message: "Le document n’a pas pu être préparé.",
      };
    }
    if (detectDocumentMime(bytes) !== document.file_type) {
      return {
        status: "error",
        code: "INVALID_FILE",
        message: "Le contenu du document ne correspond pas à son type déclaré.",
      };
    }

    if (document.file_type !== "application/pdf") {
      return { status: "ocr_required", mimeType: document.file_type, reason: "image" };
    }

    const extraction = await extractPdfText(bytes);
    if (!extraction.ok) {
      const tooLarge = extraction.error.code === "FILE_TOO_LARGE"
        || extraction.error.code === "TOO_MANY_PAGES"
        || extraction.error.code === "TEXT_LIMIT_EXCEEDED";
      return {
        status: "error",
        code: tooLarge ? "TOO_LARGE" : "PROCESSING_FAILED",
        message: tooLarge
          ? "Le document dépasse les limites de traitement autorisées."
          : "Le document n’a pas pu être analysé.",
      };
    }
    if (extraction.readability !== "readable") {
      return {
        status: "ocr_required",
        mimeType: "application/pdf",
        reason: extraction.readability,
      };
    }

    return {
      status: "ready",
      mimeType: "application/pdf",
      pageCount: Math.min(extraction.pageCount, PDF_MAX_PAGES),
      extractedCharacterCount: Math.min(extraction.totalCharacters, PDF_MAX_TEXT_CHARACTERS),
    };
  } catch {
    return {
      status: "error",
      code: "PROCESSING_FAILED",
      message: "Le document n’a pas pu être préparé.",
    };
  } finally {
    activeDocumentExtractions -= 1;
  }
}

export async function deleteDocument(
  companyId: string | null,
  documentId: string,
): Promise<DocumentActionState> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const documentQuery = access.supabase.from("documents")
    .select("file_path")
    .eq("id", documentId)
    .is("deleted_at", null);
  const document = companyId
    ? await documentQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
    : await documentQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
  if (document.error) {
    console.error("Document deletion metadata query failed", { code: document.error.code });
    return { error: "Impossible de vérifier les droits de suppression du document." };
  }
  if (!document.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  const validPath = companyId
    ? isDocumentStoragePathForCompany(document.data.file_path, companyId)
    : isDocumentStoragePathForUser(document.data.file_path, access.user.id);
  if (!validPath) {
    console.error("Document deletion path does not match its owner", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son propriétaire. Contactez un administrateur." };
  }

  if (companyId) {
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
  }

  const archiveQuery = access.supabase.from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .is("deleted_at", null);
  const archived = companyId
    ? await archiveQuery.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await archiveQuery.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
  if (archived.error) {
    console.error("Document archive failed", { code: archived.error.code });
    return { error: "Le document n’a pas pu être supprimé. Vérifiez vos droits et réessayez." };
  }
  if (!archived.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };

  const removal = await access.supabase.storage.from(bucketName).remove([document.data.file_path]);
  if (removal.error) {
    console.error("Document storage removal failed", { statusCode: removal.error.statusCode });
    const rollbackQuery = access.supabase.from("documents")
      .update({ deleted_at: null })
      .eq("id", documentId);
    const rollback = companyId
      ? await rollbackQuery.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
      : await rollbackQuery.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
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
  companyId: string | null,
  documentId: string,
  category: string,
  status: string,
): Promise<DocumentActionState> {
  if (!uuidSchema.safeParse(documentId).success) return { error: "Le document sélectionné n’est pas valide." };
  const classification = documentClassificationSchema.safeParse({ category, status });
  if (!classification.success) return { error: "Sélectionnez une catégorie et un statut documentaire valides." };

  const access = await getDocumentAccess(companyId);
  if ("error" in access) return access;

  const existingQuery = access.supabase.from("documents")
    .select("file_path")
    .eq("id", documentId)
    .is("deleted_at", null);
  const existing = companyId
    ? await existingQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
    : await existingQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
  if (existing.error) {
    console.error("Document classification access check failed", { code: existing.error.code });
    return { error: "Impossible de vérifier les droits de modification du document." };
  }
  if (!existing.data) return { error: "Ce document n’existe pas ou n’est pas accessible dans cet espace." };
  const validPath = companyId
    ? isDocumentStoragePathForCompany(existing.data.file_path, companyId)
    : isDocumentStoragePathForUser(existing.data.file_path, access.user.id);
  if (!validPath) {
    console.error("Document classification path does not match its owner", { companyId, documentId });
    return { error: "Le chemin de stockage du document ne correspond pas à son propriétaire. Contactez un administrateur." };
  }

  const updateQuery = access.supabase.from("documents")
    .update({
      category: classification.data.category,
      document_status: classification.data.status,
    })
    .eq("id", documentId)
    .is("deleted_at", null);
  const update = companyId
    ? await updateQuery.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await updateQuery.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
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
