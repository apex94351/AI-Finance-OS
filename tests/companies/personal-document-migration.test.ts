import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/013_personal_documents.sql", import.meta.url),
  "utf8",
);

describe("personal document ownership migration", () => {
  it("allows either a personal or company owner without changing existing company rows", () => {
    expect(migration.indexOf("$preflight$")).toBeLessThan(migration.indexOf("alter table public.documents"));
    expect(migration).toContain("Verify migrations 010_documents_storage.sql and 011_document_registry.sql");
    expect(migration).toContain("alter column company_id drop not null");
    expect(migration).toContain("add column if not exists user_id uuid references auth.users(id)");
    expect(migration).toContain("documents_single_owner");
    expect(migration).toContain("user_id is not null and company_id is null");
    expect(migration).toContain("user_id is null and company_id is not null");
  });

  it("adds authenticated personal metadata and Storage policies", () => {
    expect(migration).toContain("documents_personal_select");
    expect(migration).toContain("documents_personal_insert");
    expect(migration).toContain("documents_personal_update");
    expect(migration).toContain("documents_storage_personal_select");
    expect(migration).toContain("documents_storage_personal_insert");
    expect(migration).toContain("documents_storage_personal_delete");
    expect(migration).toContain("(select auth.uid())");
    expect(migration).toContain("(storage.foldername(name))[2] = 'personal'");
    expect(migration).toContain("select 1 from storage.buckets where id = 'documents'");
    expect(migration).toContain("alter policy %I on storage.objects");
    expect(migration).toContain("coalesce((storage.foldername(name))[2], '''') <> ''personal''");
    expect(migration).toContain("'document_storage_member_read'");
    expect(migration).toContain("'documents_storage_member_select'");
  });

  it("contains no statements that delete documents or existing policies", () => {
    expect(migration).not.toMatch(/\b(drop|delete|truncate)\s+(table|from|index|column|policy)\b/i);
  });
});
