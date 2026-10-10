import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MAX_SIZE,
  filterDocuments,
  isDocumentStoragePathForCompany,
  validateDocumentUpload,
  type DocumentRecord,
} from "@/services/documents";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const records: DocumentRecord[] = [
  { id: "a", companyId: "co1", filePath: "co1/a.pdf", fileName: "Alpha.pdf", fileType: "application/pdf", fileSize: 6, uploadedAt: "2026-10-02T12:00:00Z", category: "customer_invoice", status: "needs_review", relatedInvoices: [] },
  { id: "b", companyId: "co2", filePath: "co2/b.png", fileName: "Beta.png", fileType: "image/png", fileSize: 8, uploadedAt: "2026-10-05T12:00:00Z", category: "receipt", status: "validated", relatedInvoices: [] },
];

describe("document validation and filtering", () => {
  it("accepts only safe storage paths rooted in the owning company", () => {
    expect(isDocumentStoragePathForCompany("co1/document.pdf", "co1")).toBe(true);
    expect(isDocumentStoragePathForCompany("co1/folder/document.pdf", "co1")).toBe(true);
    expect(isDocumentStoragePathForCompany("co10/document.pdf", "co1")).toBe(false);
    expect(isDocumentStoragePathForCompany("co1/../document.pdf", "co1")).toBe(false);
    expect(isDocumentStoragePathForCompany("co1//document.pdf", "co1")).toBe(false);
    expect(isDocumentStoragePathForCompany("co1\\document.pdf", "co1")).toBe(false);
  });

  it("accepts matching PDF, JPEG and PNG signatures and rejects invalid content", () => {
    expect(validateDocumentUpload({ name: "a.pdf", type: "application/pdf", size: pdf.length }, pdf)).toHaveProperty("data");
    expect(validateDocumentUpload({ name: "a.jpg", type: "image/jpeg", size: jpg.length }, jpg)).toHaveProperty("data");
    expect(validateDocumentUpload({ name: "a.png", type: "image/png", size: png.length }, png)).toHaveProperty("data");
    expect(validateDocumentUpload({ name: "fake.pdf", type: "application/pdf", size: png.length }, png)).toHaveProperty("error");
  });

  it("rejects unsupported MIME types, empty files and files over 10 MiB", () => {
    expect(validateDocumentUpload({ name: "a.svg", type: "image/svg+xml", size: 10 }, pdf).error).toBeTruthy();
    expect(validateDocumentUpload({ name: "large.pdf", type: "application/pdf", size: DOCUMENT_MAX_SIZE + 1 }, pdf).error).toBeTruthy();
    expect(validateDocumentUpload({ name: "", type: "application/pdf", size: pdf.length }, pdf).error).toBeTruthy();
    expect(validateDocumentUpload({ name: "truncated.pdf", type: "application/pdf", size: pdf.length + 1 }, pdf).error).toBeTruthy();
  });

  it("filters by name, MIME type, company and civil upload dates and sorts results", () => {
    expect(filterDocuments(records, "beta", "all", "all", "", "", "date-desc").map(({ id }) => id)).toEqual(["b"]);
    expect(filterDocuments(records, "", "application/pdf", "co1", "2026-10-02", "2026-10-02", "name-asc").map(({ id }) => id)).toEqual(["a"]);
    expect(filterDocuments(records, "", "all", "all", "", "", "name-asc").map(({ id }) => id)).toEqual(["a", "b"]);
    expect(filterDocuments([], "", "all", "all", "", "", "date-desc")).toEqual([]);
  });

  it("filters and searches document category and status separately", () => {
    expect(filterDocuments(records, "", "all", "all", "", "", "date-desc", "customer_invoice").map(({ id }) => id)).toEqual(["a"]);
    expect(filterDocuments(records, "", "all", "all", "", "", "date-desc", "all", "validated").map(({ id }) => id)).toEqual(["b"]);
    expect(filterDocuments(records, "à vérifier", "all", "all", "", "", "date-desc").map(({ id }) => id)).toEqual(["a"]);
    expect(filterDocuments(records, "reçu", "all", "all", "", "", "date-desc").map(({ id }) => id)).toEqual(["b"]);
  });
});
