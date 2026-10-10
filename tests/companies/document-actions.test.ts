import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from, storageFrom } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createDocumentDownloadUrl, deleteDocument, updateDocumentClassification, uploadDocument } from "@/app/documents/actions";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function formWithFile(bytes = pdfBytes, mime = "application/pdf") {
  const formData = new FormData();
  formData.set("companyId", companyId);
  formData.set("file", new File([bytes], "test.pdf", { type: mime }));
  formData.set("category", "other");
  formData.set("status", "to_process");
  return formData;
}

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "limit", "insert", "update"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  return builder;
}

function membershipQuery() {
  return query({ data: { company_id: companyId }, error: null });
}

function setupAccess(tableQueries: Record<string, ReturnType<typeof query>[]> = {}) {
  from.mockImplementation((table: string) => tableQueries[table]?.shift() ?? membershipQuery());
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from, storage: { from: storageFrom } },
    user: { id: "user-id" },
  });
}

describe("document upload server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects forged file contents before authenticating or accessing Storage", async () => {
    const membershipQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { company_id: companyId }, error: null }),
    };
    membershipQuery.select.mockReturnValue(membershipQuery);
    membershipQuery.eq.mockReturnValue(membershipQuery);
    const companyQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: companyId }, error: null }),
    };
    companyQuery.select.mockReturnValue(companyQuery);
    companyQuery.eq.mockReturnValue(companyQuery);
    from.mockImplementation((table: string) => table === "company_members" ? membershipQuery : companyQuery);
    const supabase = { from, storage: { from: storageFrom } };
    getAuthenticatedSupabase.mockResolvedValue({ supabase, user: { id: "user-id" } });
    const result = await uploadDocument({}, formWithFile(pdfBytes, "image/png"));

    expect(result.error).toContain("ne correspond pas");
    expect(getAuthenticatedSupabase).toHaveBeenCalledOnce();
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses company access before attempting upload when membership is absent", async () => {
    const membershipQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    membershipQuery.select.mockReturnValue(membershipQuery);
    membershipQuery.eq.mockReturnValue(membershipQuery);
    from.mockReturnValue(membershipQuery);
    const supabase = { from, storage: { from: storageFrom } };
    getAuthenticatedSupabase.mockResolvedValue({ supabase, user: { id: "user-id" } });

    const result = await uploadDocument({}, formWithFile());

    expect(result.error).toContain("n’est pas associé");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("surfaces the missing private bucket instead of claiming upload success", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      companies: [query({ data: { id: companyId }, error: null })],
    });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: null, error: { statusCode: "404", message: "Bucket not found" } }),
    });

    const result = await uploadDocument({}, formWithFile());

    expect(result.error).toContain("bucket privé");
    expect(storageFrom).toHaveBeenCalledWith("documents");
  });

  it("cleans up the uploaded object when metadata insertion fails", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      companies: [query({ data: { id: companyId }, error: null })],
      documents: [query({ data: null, error: { code: "42501" } })],
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "uploaded" }, error: null }),
      remove,
    });

    const result = await uploadDocument({}, formWithFile());

    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0]?.[0][0]).toMatch(new RegExp(`^${companyId}/`));
    expect(result.error).toContain("métadonnées");
  });

  it("persists the selected category and documentary status with upload metadata", async () => {
    const metadata = query({ data: { id: "document-id" }, error: null });
    setupAccess({
      company_members: [membershipQuery()],
      companies: [query({ data: { id: companyId }, error: null })],
      documents: [metadata],
    });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "uploaded" }, error: null }),
      remove: vi.fn(),
    });
    const formData = formWithFile();
    formData.set("category", "supplier_invoice");
    formData.set("status", "needs_review");

    const result = await uploadDocument({}, formData);

    expect(metadata.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "supplier_invoice",
      document_status: "needs_review",
    }));
    expect(result.success).toContain("importé");
  });

  it("rejects invalid document classification before uploading", async () => {
    const formData = formWithFile();
    formData.set("category", "paid");

    const result = await uploadDocument({}, formData);

    expect(result.error).toContain("catégorie et un statut");
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("reports an unrecoverable orphan when metadata insertion and cleanup both fail", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      companies: [query({ data: { id: companyId }, error: null })],
      documents: [query({ data: null, error: { code: "42501" } })],
    });
    storageFrom.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "uploaded" }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: { statusCode: "403" } }),
    });

    const result = await uploadDocument({}, formWithFile());

    expect(result.error).toContain("fichier temporaire n’a pas pu être nettoyé");
  });
});

describe("document access and deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a signed URL only for an authorized document in the selected company", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: `${companyId}/file.pdf` }, error: null })],
    });
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/doc" }, error: null });
    storageFrom.mockReturnValue({ createSignedUrl });

    await expect(createDocumentDownloadUrl(companyId, "123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({ url: "https://signed.example/doc" });
    expect(createSignedUrl).toHaveBeenCalledWith(`${companyId}/file.pdf`, 60);
  });

  it("updates classification only for a document in an authorized company", async () => {
    const update = query({ data: { id: "document-id" }, error: null });
    setupAccess({
      company_members: [membershipQuery()],
      documents: [
        query({ data: { file_path: `${companyId}/file.pdf` }, error: null }),
        update,
      ],
    });

    const result = await updateDocumentClassification(companyId, "123e4567-e89b-42d3-a456-426614174003", "quote", "validated");

    expect(update.update).toHaveBeenCalledWith({ category: "quote", document_status: "validated" });
    expect(update.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(result.success).toContain("enregistré");
  });

  it("does not update classification when company membership is missing", async () => {
    setupAccess({
      company_members: [query({ data: null, error: null })],
    });

    const result = await updateDocumentClassification(companyId, "123e4567-e89b-42d3-a456-426614174003", "quote", "validated");

    expect(result.error).toContain("n’est pas associé");
    expect(from).not.toHaveBeenCalledWith("documents");
  });

  it("refuses a document belonging to another company before accessing its storage path", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: null, error: null })],
    });

    const result = await createDocumentDownloadUrl(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("n’existe pas ou n’est pas accessible");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("rejects a stored path whose company prefix does not match its metadata", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: "123e4567-e89b-42d3-a456-426614174099/file.pdf" }, error: null })],
    });

    const result = await createDocumentDownloadUrl(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("ne correspond pas");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("does not delete when the metadata path belongs to a different company", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: "123e4567-e89b-42d3-a456-426614174099/file.pdf" }, error: null })],
    });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("ne correspond pas");
    expect(from).not.toHaveBeenCalledWith("invoices");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses to delete a document referenced by an invoice", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: `${companyId}/file.pdf` }, error: null })],
      invoices: [query({ data: { id: "invoice-id" }, error: null })],
    });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("utilisé par une facture");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("fails closed when invoice references cannot be checked", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: `${companyId}/file.pdf` }, error: null })],
      invoices: [query({ data: null, error: { code: "42P01" } })],
    });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("Aucune suppression n’a été effectuée");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("removes an independent document after archiving its metadata", async () => {
    const archive = query({ data: { id: "document-id" }, error: null });
    setupAccess({
      company_members: [membershipQuery()],
      documents: [
        query({ data: { file_path: `${companyId}/file.pdf` }, error: null }),
        archive,
      ],
      invoices: [query({ data: null, error: null })],
    });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    storageFrom.mockReturnValue({ remove });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(archive.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(archive.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(remove).toHaveBeenCalledWith([`${companyId}/file.pdf`]);
    expect(result.success).toContain("supprimés");
  });

  it("restores metadata when Storage deletion fails", async () => {
    const archive = query({ data: { id: "document-id" }, error: null });
    const rollback = query({ data: { id: "document-id" }, error: null });
    setupAccess({
      company_members: [membershipQuery()],
      documents: [
        query({ data: { file_path: `${companyId}/file.pdf` }, error: null }),
        archive,
        rollback,
      ],
      invoices: [query({ data: null, error: null })],
    });
    storageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({ data: null, error: { statusCode: "403" } }) });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(rollback.update).toHaveBeenCalledWith({ deleted_at: null });
    expect(result.error).toContain("policies Storage");
  });

  it("does not remove the Storage object if metadata archiving fails", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [
        query({ data: { file_path: `${companyId}/file.pdf` }, error: null }),
        query({ data: null, error: { code: "42501" } }),
      ],
      invoices: [query({ data: null, error: null })],
    });
    storageFrom.mockReturnValue({ remove: vi.fn() });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("n’a pas pu être supprimé");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("reports when Storage deletion and metadata recovery both fail", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [
        query({ data: { file_path: `${companyId}/file.pdf` }, error: null }),
        query({ data: { id: "document-id" }, error: null }),
        query({ data: null, error: { code: "42501" } }),
      ],
      invoices: [query({ data: null, error: null })],
    });
    storageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({ data: null, error: { statusCode: "403" } }) });

    const result = await deleteDocument(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("intervention est nécessaire");
  });
});
