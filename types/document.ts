export type SupportedDocumentType = "application/pdf" | "image/jpeg" | "image/png";

export interface DocumentRecord {
  id: string;
  companyId: string | null;
  filePath: string;
  fileName: string;
  fileType: SupportedDocumentType;
  fileSize: number;
  uploadedAt: string;
  deletedAt: string | null;
}

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_DOCUMENT_TYPES: SupportedDocumentType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];
