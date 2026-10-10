import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/012_invoice_document_links.sql", import.meta.url),
  "utf8",
);

describe("invoice document link migration", () => {
  it("requires existing document and invoice tables and columns", () => {
    expect(migration).toContain("public.documents");
    expect(migration).toContain("public.invoices");
    expect(migration).toContain("document_id");
    expect(migration).toContain("company_id");
  });

  it("stops before adding constraints when duplicate or cross-company references exist", () => {
    expect(migration).toContain("having count(*) > 1");
    expect(migration).toContain("missing or cross-company document references");
    expect(migration).toContain("references public.documents (company_id, id)");
  });

  it("uses uniqueness and restrictive foreign-key semantics without deleting data", () => {
    expect(migration).toContain("create unique index if not exists invoices_document_id_unique_idx");
    expect(migration).toContain("on delete restrict");
    expect(migration).not.toMatch(/\b(drop|delete|truncate)\s+(table|from|index|column)\b/i);
  });
});
