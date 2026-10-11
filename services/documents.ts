import { z } from "zod";

export const DOCUMENT_MAX_SIZE = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const DOCUMENT_CATEGORIES = [
  "customer_invoice",
  "supplier_invoice",
  "quote",
  "supporting_document",
  "receipt",
  "other",
] as const;
export const DOCUMENT_STATUSES = ["to_process", "needs_review", "needs_information", "validated", "archived"] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  customer_invoice: "Facture client",
  supplier_invoice: "Facture fournisseur",
  quote: "Devis",
  supporting_document: "Justificatif",
  receipt: "Reçu",
  other: "Autre",
};

export const documentStatusLabels: Record<DocumentStatus, string> = {
  to_process: "À traiter",
  needs_review: "À vérifier",
  needs_information: "À compléter",
  validated: "Validé",
  archived: "Archivé",
};

export const documentUploadMetadataSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(DOCUMENT_MIME_TYPES),
  size: z.number().int().positive().max(DOCUMENT_MAX_SIZE),
});

export interface DocumentRecord {
  id: string;
  companyId: string | null;
  filePath: string;
  fileName: string;
  fileType: (typeof DOCUMENT_MIME_TYPES)[number];
  fileSize: number;
  uploadedAt: string;
  category: DocumentCategory;
  status: DocumentStatus;
  relatedInvoices: DocumentInvoiceRelation[];
}

export interface DocumentInvoiceRelation {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  supplierName: string | null;
  customerId: string | null;
  supplierId: string | null;
}

export const documentClassificationSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  status: z.enum(DOCUMENT_STATUSES),
});

export const documentRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  file_type: z.enum(DOCUMENT_MIME_TYPES),
  file_size: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
  uploaded_at: z.string(),
  deleted_at: z.string().nullable(),
  category: z.enum(DOCUMENT_CATEGORIES),
  document_status: z.enum(DOCUMENT_STATUSES),
}).refine((row) => (row.user_id === null) !== (row.company_id === null));

export const documentInvoiceRowSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  document_id: z.uuid(),
  invoice_number: z.string().nullable(),
  customer_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
});

export const documentCompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type DocumentCompany = z.infer<typeof documentCompanySchema>;

export function isDocumentStoragePathForCompany(filePath: unknown, companyId: string): filePath is string {
  return isDocumentStoragePathForOwner(filePath, companyId);
}

export function isDocumentStoragePathForUser(filePath: unknown, userId: string): filePath is string {
  return isDocumentStoragePathForOwner(filePath, userId)
    && filePath.split("/")[1] === "personal";
}

function isDocumentStoragePathForOwner(filePath: unknown, ownerId: string): filePath is string {
  if (typeof filePath !== "string" || !filePath.startsWith(`${ownerId}/`)) return false;
  const pathSegments = filePath.split("/");
  return pathSegments.length >= 2
    && pathSegments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\\"));
}

export function detectDocumentMime(bytes: Uint8Array): (typeof DOCUMENT_MIME_TYPES)[number] | null {
  if (bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export function validateDocumentUpload(file: {
  name: string;
  type: string;
  size: number;
}, bytes: Uint8Array) {
  const parsed = documentUploadMetadataSchema.safeParse(file);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Vérifiez le fichier sélectionné." } as const;
  }
  if (bytes.byteLength !== parsed.data.size) {
    return { error: "Le contenu du fichier est incomplet ou invalide." } as const;
  }
  if (detectDocumentMime(bytes) !== parsed.data.type) {
    return { error: "Le contenu du fichier ne correspond pas à son type déclaré." } as const;
  }
  return { data: parsed.data } as const;
}

export function mapDocument(
  row: z.infer<typeof documentRowSchema>,
  relatedInvoices: DocumentInvoiceRelation[] = [],
): DocumentRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: typeof row.file_size === "number" ? row.file_size : Number(row.file_size),
    uploadedAt: row.uploaded_at,
    category: row.category,
    status: row.document_status,
    relatedInvoices,
  };
}

export function filterDocuments(
  documents: readonly DocumentRecord[],
  query: string,
  fileType: string,
  companyId: string,
  startDate: string,
  endDate: string,
  sort: "name-asc" | "date-desc",
  category = "all",
  status = "all",
): DocumentRecord[] {
  const normalized = query.trim().toLocaleLowerCase("fr");
  return documents.filter((document) => (
    (!normalized
      || document.fileName.toLocaleLowerCase("fr").includes(normalized)
      || documentCategoryLabels[document.category].toLocaleLowerCase("fr").includes(normalized)
      || documentStatusLabels[document.status].toLocaleLowerCase("fr").includes(normalized))
    && (fileType === "all" || document.fileType === fileType)
    && (companyId === "all" || document.companyId === companyId)
    && (!startDate || document.uploadedAt.slice(0, 10) >= startDate)
    && (!endDate || document.uploadedAt.slice(0, 10) <= endDate)
    && (category === "all" || document.category === category)
    && (status === "all" || document.status === status)
  )).sort((left, right) => sort === "name-asc"
    ? left.fileName.localeCompare(right.fileName, "fr")
    : right.uploadedAt.localeCompare(left.uploadedAt));
}

export function formatDocumentSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} Ko`;
  return `${(size / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
