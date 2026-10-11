// @vitest-environment jsdom

import { createRequire } from "node:module";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@/services/documents";

const { refresh, createDocumentDownloadUrl, deleteDocument, updateDocumentClassification, uploadDocument, uploadAction } = vi.hoisted(() => ({
  refresh: vi.fn(),
  createDocumentDownloadUrl: vi.fn(),
  deleteDocument: vi.fn(),
  updateDocumentClassification: vi.fn(),
  uploadDocument: vi.fn(),
  uploadAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/documents/actions", () => ({ createDocumentDownloadUrl, deleteDocument, updateDocumentClassification, uploadDocument }));

const { useActionState } = vi.hoisted(() => ({ useActionState: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState };
});

import { DocumentManager } from "@/database/components/documents/document-manager";

const jsdomRequire = createRequire(`${process.cwd()}/package.json`);
const jsdomIdlUtils = jsdomRequire("jsdom/lib/generated/idl/utils.js");

const documentRecord: DocumentRecord = {
  id: "d1",
  companyId: "co1",
  filePath: "co1/d1-invoice.pdf",
  fileName: "invoice.pdf",
  fileType: "application/pdf",
  fileSize: 2048,
  uploadedAt: "2026-10-01T10:00:00Z",
  category: "customer_invoice",
  status: "needs_review",
  relatedInvoices: [{
    id: "invoice-1",
    invoiceNumber: "FA-001",
    customerName: "Client Alpha",
    supplierName: null,
    customerId: "customer-1",
    supplierId: null,
  }],
};

function setInputFiles(input: HTMLInputElement, ...files: File[]) {
  const implementation = jsdomIdlUtils.implForWrapper(input.files);
  if (!implementation) throw new Error("The input does not expose its jsdom FileList implementation.");
  for (const file of files) implementation.push(jsdomIdlUtils.implForWrapper(file));
}

describe("document manager", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useActionState.mockReturnValue([{}, uploadAction, false]);
  });

  it("routes the label click to the file input and submits its selected file through the existing form", async () => {
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[]} loadError={null} />);

    const fileInput = screen.getByLabelText("Sélectionner un document PDF, JPG ou PNG") as HTMLInputElement;
    const uploadLabel = screen.getByText("Importer un document", { selector: "label" }) as HTMLLabelElement;
    expect(uploadLabel.htmlFor).toBe(fileInput.id);
    expect(document.querySelectorAll(`#${fileInput.id}`)).toHaveLength(1);
    expect(fileInput.form?.id).toBe("document-upload-form");
    expect(screen.queryByRole("heading", { name: "Importer un document" })).toBeNull();
    const inputClick = vi.fn();
    fileInput.addEventListener("click", inputClick);
    fireEvent.click(uploadLabel);
    expect(inputClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Importer un document" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("heading", { name: "Importer un document" })).toBeNull();
    fireEvent.click(uploadLabel);
    expect(screen.getByRole("heading", { name: "Importer un document" })).toBeTruthy();

    const file = new File(["%PDF-1.7"], "invoice.pdf", { type: "application/pdf" });
    setInputFiles(fileInput, file);
    fireEvent.change(fileInput);
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(fileInput.files?.length).toBe(1);
    expect(fileInput.files?.item(0)?.name).toBe(file.name);
    expect(fileInput.form?.id).toBe("document-upload-form");
    const nativeFormFile = new FormData(fileInput.form!).get("file") as File;
    expect(nativeFormFile.name).toBe(file.name);
    expect(nativeFormFile.type).toBe(file.type);
    expect(nativeFormFile.size).toBe(file.size);

    fireEvent.submit(fileInput.form!);
    await waitFor(() => expect(uploadAction).toHaveBeenCalled());
    const submittedFile = uploadAction.mock.calls[0][0].get("file") as File;
    expect(submittedFile.name).toBe(file.name);
    expect(submittedFile.type).toBe(file.type);
    expect(submittedFile.size).toBe(file.size);
  });

  it("keeps personal upload available without a company and disables uploads while pending", () => {
    const { container, rerender } = render(<DocumentManager companies={[]} documents={[]} loadError={null} />);
    const fileInput = screen.getByLabelText("Sélectionner un document PDF, JPG ou PNG") as HTMLInputElement;
    expect(fileInput.disabled).toBe(false);
    expect(container.querySelector(".document-upload-trigger-visual")?.classList.contains("disabled-button")).toBe(false);
    fireEvent.click(screen.getByText("Importer un document", { selector: "label" }));
    expect(screen.getByRole("heading", { name: "Importer un document" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Espace de stockage" }) as HTMLSelectElement).value).toBe("");

    useActionState.mockReturnValue([{}, uploadAction, true]);
    rerender(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[]} loadError={null} />);
    expect((screen.getByLabelText("Sélectionner un document PDF, JPG ou PNG") as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector(".document-upload-trigger-visual")?.classList.contains("disabled-button")).toBe(true);
  });

  it("does not disable the file picker when metadata loading fails", () => {
    render(<DocumentManager companies={[]} documents={[]} loadError="Table Documents indisponible" />);

    const fileInput = screen.getByLabelText("Sélectionner un document PDF, JPG ou PNG") as HTMLInputElement;
    expect(fileInput.disabled).toBe(false);
    fireEvent.click(screen.getByText("Importer un document", { selector: "label" }));
    expect(screen.getByRole("heading", { name: "Importer un document" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Table Documents indisponible");
  });

  it("opens a PDF in the integrated reader using a temporary authorized URL", async () => {
    createDocumentDownloadUrl.mockResolvedValue({ url: "https://signed.example/document", fileType: "application/pdf" });
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getAllByText("Atelier Alpha").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Lire" }));
    await vi.waitFor(() => expect(createDocumentDownloadUrl).toHaveBeenCalledWith("co1", "d1"));
    const reader = await screen.findByRole("dialog", { name: "invoice.pdf" });
    expect(within(reader).getByText("Facture client")).toBeTruthy();
    expect(within(reader).getByTitle("Lecture de invoice.pdf").getAttribute("src")).toBe("https://signed.example/document");
    fireEvent.click(within(reader).getByRole("button", { name: "Fermer le lecteur" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["image/jpeg", "image/png"] as const)("opens personal %s documents as proportion-preserving images", async (fileType) => {
    const personalDocument = {
      ...documentRecord,
      companyId: null,
      filePath: "user-id/personal/image",
      fileName: fileType === "image/png" ? "scan.png" : "scan.jpg",
      fileType,
    };
    createDocumentDownloadUrl.mockResolvedValue({ url: "https://signed.example/image", fileType });
    render(<DocumentManager companies={[]} documents={[personalDocument]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Lire" }));

    const image = await screen.findByRole("img", { name: personalDocument.fileName });
    expect(createDocumentDownloadUrl).toHaveBeenCalledWith(null, "d1");
    expect(image.getAttribute("src")).toBe("https://signed.example/image");
  });

  it("shows a readable preview failure without exposing a storage path", async () => {
    createDocumentDownloadUrl.mockResolvedValue({ error: "Ce document n’est pas accessible." });
    render(<DocumentManager companies={[]} documents={[{ ...documentRecord, companyId: null }]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Lire" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Ce document n’est pas accessible.");
    expect(screen.queryByText(documentRecord.filePath)).toBeNull();
  });

  it("shows empty, missing-storage information and retryable errors", () => {
    const { rerender } = render(<DocumentManager companies={[]} documents={[]} loadError={null} information="Aucun espace entreprise." />);
    expect(screen.getByText("Aucun espace entreprise.")).toBeTruthy();
    expect(screen.getByText("Aucun document enregistré")).toBeTruthy();

    rerender(<DocumentManager companies={[]} documents={[]} loadError="Bucket indisponible" />);
    expect(screen.getByRole("alert").textContent).toContain("Bucket indisponible");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows document details, filters category separately from status, and saves classification", async () => {
    updateDocumentClassification.mockResolvedValue({ success: "Classement enregistré." });
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    const documentTable = within(screen.getByRole("table"));
    expect(documentTable.getByText("Facture client")).toBeTruthy();
    expect(documentTable.getByText("À vérifier")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par statut documentaire" }), { target: { value: "validated" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par statut documentaire" }), { target: { value: "all" } });

    fireEvent.click(screen.getByRole("button", { name: "Détails" }));
    expect(screen.getByText("Facture liée n° FA-001 · Client : Client Alpha")).toBeTruthy();
    expect(screen.getByText(/ne définit pas de relation directe entre document et dépense ou devis/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Catégorie documentaire" }), { target: { value: "supporting_document" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Statut documentaire" }), { target: { value: "validated" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le classement" }));

    await vi.waitFor(() => expect(updateDocumentClassification).toHaveBeenCalledWith("co1", "d1", "supporting_document", "validated"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a loading state while preparing the document reader", async () => {
    let resolveDownload!: (value: { url: string; fileType: "application/pdf" }) => void;
    createDocumentDownloadUrl.mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Lire" }));

    expect((await screen.findByRole("status")).textContent).toContain("Chargement du document");
    resolveDownload({ url: "https://signed.example/document", fileType: "application/pdf" });
    expect(await screen.findByTitle("Lecture de invoice.pdf")).toBeTruthy();
  });

  it("confirms successful deletion in the interface", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteDocument.mockResolvedValue({ success: "Le document et sa fiche ont été supprimés." });
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Supprimer invoice.pdf" }));

    await vi.waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("co1", "d1"));
    expect((await screen.findByRole("status")).textContent).toContain("Le document et sa fiche ont été supprimés.");
    expect(refresh).toHaveBeenCalled();
  });
});
