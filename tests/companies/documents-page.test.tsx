import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from, documentManager } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
  documentManager: vi.fn(() => null),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/database/components/documents/document-manager", () => ({
  DocumentManager: documentManager,
}));

import DocumentsPage from "@/app/documents/page";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const documentId = "123e4567-e89b-42d3-a456-426614174001";

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("documents page schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedSupabase.mockResolvedValue({
      supabase: { from },
      user: { id: "123e4567-e89b-42d3-a456-426614174099" },
    });
  });

  it("keeps company documents visible when personal ownership columns are not installed", async () => {
    const existingDocument = {
      id: documentId,
      company_id: companyId,
      file_path: `${companyId}/invoice.pdf`,
      file_name: "invoice.pdf",
      file_type: "application/pdf",
      file_size: 1024,
      uploaded_at: "2026-10-01T10:00:00Z",
      deleted_at: null,
      category: "other",
      document_status: "to_process",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [{ company_id: companyId }], error: null })],
      companies: [query({ data: [{ id: companyId, name: "Atelier Alpha" }], error: null })],
      documents: [
        query({ data: [existingDocument], error: null }),
        query({ data: null, error: { code: "42703", message: "column documents.user_id does not exist" } }),
        query({ data: null, error: { code: "42703", message: "column documents.user_id does not exist" } }),
      ],
      invoices: [query({ data: [], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift());

    const page = await DocumentsPage() as ReactElement<{ children: ReactElement<{ documents: unknown[]; loadError: string | null; documentWarning: string }> }>;
    const manager = page.props.children;

    expect(manager.props.documents).toHaveLength(1);
    expect(manager.props.documents[0]).toMatchObject({ id: documentId, companyId });
    expect(manager.props.loadError).toBeNull();
    expect(manager.props.documentWarning).toContain("013_personal_documents.sql");
  });

  it("renders a table-specific explanation rather than an empty state when the table is missing", async () => {
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      documents: [query({ data: null, error: { code: "PGRST205", message: "table public.documents not found" } })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift());

    const page = await DocumentsPage() as ReactElement<{ children: ReactElement<{ documents: unknown[]; loadError: string }> }>;
    const manager = page.props.children;

    expect(manager.props.documents).toEqual([]);
    expect(manager.props.loadError).toContain("table public.documents n’est pas disponible");
    expect(manager.props.loadError).toContain("010_documents_storage.sql");
  });
});
