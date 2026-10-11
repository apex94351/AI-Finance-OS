import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from, storageFrom, extractPdfText } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
  extractPdfText: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/pdf-text-extraction", () => ({
  extractPdfText,
  PDF_MAX_PAGES: 100,
  PDF_MAX_SIZE_BYTES: 10 * 1024 * 1024,
  PDF_MAX_TEXT_CHARACTERS: 100_000,
}));

import {
  createDocumentDownloadUrl,
  deleteDocument,
  prepareDocumentExtraction,
  updateDocumentClassification,
  uploadDocument,
} from "@/app/documents/actions";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const personalUserId = "123e4567-e89b-42d3-a456-426614174099";
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

function extractionDocument(overrides: Record<string, unknown> = {}) {
  return query({
    data: {
      id: "123e4567-e89b-42d3-a456-426614174003",
      user_id: null,
      company_id: companyId,
      file_path: `${companyId}/document.pdf`,
      file_type: "application/pdf",
      file_size: pdfBytes.byteLength,
      ...overrides,
    },
    error: null,
  });
}

function storageDownload(bytes = pdfBytes, error: unknown = null) {
  const download = vi.fn().mockResolvedValue({
    data: error ? null : new Blob([bytes]),
    error,
  });
  storageFrom.mockReturnValue({ download });
  return download;
}

function setupAccess(
  tableQueries: Record<string, ReturnType<typeof query>[]> = {},
  userId = "user-id",
) {
  from.mockImplementation((table: string) => tableQueries[table]?.shift() ?? membershipQuery());
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from, storage: { from: storageFrom } },
    user: { id: userId },
  });
}

describe("document upload server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractPdfText.mockResolvedValue({
      ok: true,
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "synthetic invoice text must not be returned" }],
      totalCharacters: 38,
      readability: "readable",
      ocrRequired: false,
    });
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

  it("uploads personal documents under the authenticated user when no company is selected", async () => {
    const metadata = query({ data: { id: "document-id" }, error: null });
    setupAccess({ documents: [metadata] }, personalUserId);
    const upload = vi.fn().mockResolvedValue({ data: { path: "uploaded" }, error: null });
    storageFrom.mockReturnValue({ upload, remove: vi.fn() });
    const formData = formWithFile();
    formData.set("companyId", "");

    const result = await uploadDocument({}, formData);

    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${personalUserId}/`)), expect.any(Uint8Array), expect.any(Object));
    expect(metadata.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: null,
      user_id: personalUserId,
    }));
    expect(from).not.toHaveBeenCalledWith("company_members");
    expect(from).not.toHaveBeenCalledWith("companies");
    expect(result.success).toContain("importé");
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

describe("document extraction preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractPdfText.mockResolvedValue({
      ok: true,
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "synthetic invoice text must not be returned" }],
      totalCharacters: 38,
      readability: "readable",
      ocrRequired: false,
    });
  });

  it("does not download a document for an unauthenticated user", async () => {
    getAuthenticatedSupabase.mockRejectedValue(new Error("authentication redirect"));
    storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .rejects.toThrow("authentication redirect");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", query({ data: null, error: null })],
    ["inaccessible", query({ data: null, error: { code: "PGRST116" } })],
  ])("returns the same safe result for a %s document", async (_case, documentQuery) => {
    setupAccess({ documents: [documentQuery] });
    storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({
        status: "error",
        code: "DOCUMENT_UNAVAILABLE",
        message: "Ce document n’existe pas ou n’est pas accessible.",
      });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("prepares an authorized personal PDF without returning extracted text", async () => {
    const document = extractionDocument({
      user_id: personalUserId,
      company_id: null,
      file_path: `${personalUserId}/personal/private.pdf`,
    });
    setupAccess({ documents: [document] }, personalUserId);
    const download = storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({
        status: "ready",
        mimeType: "application/pdf",
        pageCount: 1,
        extractedCharacterCount: 38,
      });
    expect(document.eq).toHaveBeenCalledWith("id", "123e4567-e89b-42d3-a456-426614174003");
    expect(document.is).toHaveBeenCalledWith("deleted_at", null);
    expect(download).toHaveBeenCalledWith(`${personalUserId}/personal/private.pdf`);
    expect(extractPdfText).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(JSON.stringify(await prepareDocumentExtraction("not-a-uuid"))).not.toContain("synthetic invoice");
  });

  it("checks company membership before downloading an authorized company PDF", async () => {
    const metadata = extractionDocument();
    const member = membershipQuery();
    setupAccess({ documents: [metadata], company_members: [member] }, personalUserId);
    const download = storageDownload();

    const result = await prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");

    expect(result.status).toBe("ready");
    expect(member.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(member.eq).toHaveBeenCalledWith("user_id", personalUserId);
    expect(download).toHaveBeenCalledWith(`${companyId}/document.pdf`);
  });

  it("does not download a company document when membership is absent", async () => {
    setupAccess({
      documents: [extractionDocument()],
      company_members: [query({ data: null, error: null })],
    });
    storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "DOCUMENT_UNAVAILABLE" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("does not download a personal document owned by another user", async () => {
    setupAccess({
      documents: [extractionDocument({
        user_id: companyId,
        company_id: null,
        file_path: `${companyId}/personal/private.pdf`,
      })],
    }, personalUserId);
    storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "DOCUMENT_UNAVAILABLE" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("returns an OCR-required status for a scanned PDF", async () => {
    setupAccess({
      documents: [extractionDocument({ user_id: personalUserId, company_id: null, file_path: `${personalUserId}/personal/scan.pdf` })],
    }, personalUserId);
    storageDownload();
    extractPdfText.mockResolvedValue({
      ok: true,
      pageCount: 2,
      pages: [{ pageNumber: 1, text: "" }, { pageNumber: 2, text: "" }],
      totalCharacters: 0,
      readability: "no_text",
      ocrRequired: true,
    });

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({
        status: "ocr_required",
        mimeType: "application/pdf",
        reason: "no_text",
      });
  });

  it.each([
    ["image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00]), `${personalUserId}/personal/photo.jpg`],
    ["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), `${personalUserId}/personal/photo.png`],
  ] as const)("returns OCR-required for %s without invoking the PDF parser", async (fileType, bytes, path) => {
    setupAccess({
      documents: [extractionDocument({
        user_id: personalUserId,
        company_id: null,
        file_path: path,
        file_type: fileType,
        file_size: bytes.byteLength,
      })],
    }, personalUserId);
    storageDownload(bytes);

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({ status: "ocr_required", mimeType: fileType, reason: "image" });
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it("rejects oversized metadata before reading from Storage", async () => {
    setupAccess({ documents: [extractionDocument({ file_size: 10 * 1024 * 1024 + 1 })] }, personalUserId);
    storageDownload();

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "TOO_LARGE" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("rejects content whose signature does not match stored MIME metadata", async () => {
    setupAccess({
      documents: [extractionDocument({
        user_id: personalUserId,
        company_id: null,
        file_path: `${personalUserId}/personal/fake.pdf`,
      })],
    }, personalUserId);
    storageDownload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00]));

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "INVALID_FILE" });
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it("rejects a downloaded object whose size differs from its metadata", async () => {
    setupAccess({
      documents: [extractionDocument({
        user_id: personalUserId,
        company_id: null,
        file_path: `${personalUserId}/personal/file.pdf`,
      })],
    }, personalUserId);
    storageDownload(new Uint8Array([...pdfBytes, 0x00]));

    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "INVALID_FILE" });
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it("returns a generic error when Storage download fails", async () => {
    setupAccess({
      documents: [extractionDocument({ user_id: personalUserId, company_id: null, file_path: `${personalUserId}/personal/file.pdf` })],
    }, personalUserId);
    storageDownload(pdfBytes, { statusCode: "403", message: "sensitive private object path" });

    const result = await prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");

    expect(result).toEqual({
      status: "error",
      code: "PROCESSING_FAILED",
      message: "Le document n’a pas pu être préparé.",
    });
    expect(JSON.stringify(result)).not.toContain("sensitive private object path");
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it("sanitizes parser failures and enforces parser page and text limits", async () => {
    setupAccess({
      documents: [extractionDocument({ user_id: personalUserId, company_id: null, file_path: `${personalUserId}/personal/file.pdf` })],
    }, personalUserId);
    storageDownload();
    extractPdfText.mockResolvedValue({
      ok: false,
      error: { code: "PARSER_ERROR", message: "private text and parser stack trace" },
    });

    const result = await prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");

    expect(result).toEqual({
      status: "error",
      code: "PROCESSING_FAILED",
      message: "Le document n’a pas pu être analysé.",
    });
    expect(JSON.stringify(result)).not.toContain("private text");
  });

  it.each(["TOO_MANY_PAGES", "TEXT_LIMIT_EXCEEDED"] as const)(
    "maps parser limit %s to a safe processing-limit response",
    async (code) => {
      setupAccess({
        documents: [extractionDocument({
          user_id: personalUserId,
          company_id: null,
          file_path: `${personalUserId}/personal/file.pdf`,
        })],
      }, personalUserId);
      storageDownload();
      extractPdfText.mockResolvedValue({
        ok: false,
        error: { code, message: "private parser details" },
      });

      await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
        .resolves.toEqual({
          status: "error",
          code: "TOO_LARGE",
          message: "Le document dépasse les limites de traitement autorisées.",
        });
    },
  );

  it("caps simultaneous extraction work per server instance", async () => {
    const document = () => extractionDocument({
      user_id: personalUserId,
      company_id: null,
      file_path: `${personalUserId}/personal/file.pdf`,
    });
    setupAccess({ documents: [document(), document()] }, personalUserId);
    const resolvers: ((value: { data: Blob; error: null }) => void)[] = [];
    const download = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    storageFrom.mockReturnValue({ download });

    const first = prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");
    const second = prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    await expect(prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toMatchObject({ status: "error", code: "BUSY" });

    resolvers.forEach((resolve) => resolve({ data: new Blob([pdfBytes]), error: null }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "ready", mimeType: "application/pdf", pageCount: 1, extractedCharacterCount: 38 },
      { status: "ready", mimeType: "application/pdf", pageCount: 1, extractedCharacterCount: 38 },
    ]);
  });

  it("does not expose a document's identity or storage path when metadata validation fails", async () => {
    setupAccess({
      documents: [extractionDocument({
        user_id: null,
        company_id: null,
        file_path: "private-object-path/document.pdf",
      })],
    }, personalUserId);
    storageDownload();

    const result = await prepareDocumentExtraction("123e4567-e89b-42d3-a456-426614174003");

    expect(result).toEqual({
      status: "error",
      code: "DOCUMENT_UNAVAILABLE",
      message: "Ce document n’existe pas ou n’est pas accessible.",
    });
    expect(JSON.stringify(result)).not.toContain("private-object-path");
    expect(storageFrom).not.toHaveBeenCalled();
  });
});

describe("document access and deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a signed URL only for an authorized document in the selected company", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: `${companyId}/file.pdf`, file_type: "application/pdf" }, error: null })],
    });
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/doc" }, error: null });
    storageFrom.mockReturnValue({ createSignedUrl });

    await expect(createDocumentDownloadUrl(companyId, "123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({ url: "https://signed.example/doc", fileType: "application/pdf" });
    expect(createSignedUrl).toHaveBeenCalledWith(`${companyId}/file.pdf`, 60);
  });

  it("creates a signed URL for a personal document owned by the authenticated user", async () => {
    const document = query({ data: { file_path: `${personalUserId}/personal/file.pdf`, file_type: "application/pdf" }, error: null });
    setupAccess({ documents: [document] }, personalUserId);
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/personal-doc" }, error: null });
    storageFrom.mockReturnValue({ createSignedUrl });

    await expect(createDocumentDownloadUrl(null, "123e4567-e89b-42d3-a456-426614174003"))
      .resolves.toEqual({ url: "https://signed.example/personal-doc", fileType: "application/pdf" });
    expect(document.eq).toHaveBeenCalledWith("user_id", personalUserId);
    expect(document.is).toHaveBeenCalledWith("company_id", null);
    expect(createSignedUrl).toHaveBeenCalledWith(`${personalUserId}/personal/file.pdf`, 60);
  });

  it.each([
    ["application/pdf", `${companyId}/document.pdf`],
    ["image/jpeg", `${companyId}/photo.jpg`],
    ["image/png", `${personalUserId}/personal/image.png`],
  ] as const)("allows a signed preview for supported MIME type %s", async (fileType, filePath) => {
    const document = query({ data: { file_path: filePath, file_type: fileType }, error: null });
    const personal = filePath.includes("/personal/");
    setupAccess(personal
      ? { documents: [document] }
      : { company_members: [membershipQuery()], documents: [document] }, personalUserId);
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/preview" }, error: null });
    storageFrom.mockReturnValue({ createSignedUrl });

    const result = await createDocumentDownloadUrl(personal ? null : companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result).toEqual({ url: "https://signed.example/preview", fileType });
    expect(createSignedUrl).toHaveBeenCalledWith(filePath, 60);
  });

  it("refuses unsupported MIME types before creating a signed URL", async () => {
    setupAccess({
      company_members: [membershipQuery()],
      documents: [query({ data: { file_path: `${companyId}/archive.zip`, file_type: "application/zip" }, error: null })],
    });

    const result = await createDocumentDownloadUrl(companyId, "123e4567-e89b-42d3-a456-426614174003");

    expect(result.error).toContain("ne peut pas être lu");
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("does not issue a signed URL when authentication redirects an unauthenticated user", async () => {
    getAuthenticatedSupabase.mockRejectedValue(new Error("authentication redirect"));

    await expect(createDocumentDownloadUrl(null, "123e4567-e89b-42d3-a456-426614174003"))
      .rejects.toThrow("authentication redirect");
    expect(storageFrom).not.toHaveBeenCalled();
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
      documents: [query({ data: { file_path: "123e4567-e89b-42d3-a456-426614174099/file.pdf", file_type: "application/pdf" }, error: null })],
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
