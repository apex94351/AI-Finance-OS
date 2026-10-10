// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@/services/documents";

const { refresh, createDocumentDownloadUrl, deleteDocument, updateDocumentClassification, uploadDocument } = vi.hoisted(() => ({
  refresh: vi.fn(),
  createDocumentDownloadUrl: vi.fn(),
  deleteDocument: vi.fn(),
  updateDocumentClassification: vi.fn(),
  uploadDocument: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/documents/actions", () => ({ createDocumentDownloadUrl, deleteDocument, updateDocumentClassification, uploadDocument }));

const { useActionState } = vi.hoisted(() => ({ useActionState: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState };
});

import { DocumentManager } from "@/database/components/documents/document-manager";

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

describe("document manager", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useActionState.mockReturnValue([{}, vi.fn(), false]);
  });

  it("shows real metadata, filters files and requests private signed URLs", async () => {
    createDocumentDownloadUrl.mockResolvedValue({ url: "https://signed.example/document" });
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getAllByText("Atelier Alpha").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher un document" }), { target: { value: "absent" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher un document" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Consulter" }));
    await vi.waitFor(() => expect(createDocumentDownloadUrl).toHaveBeenCalledWith("co1", "d1"));
    await vi.waitFor(() => expect(screen.getByRole("link", { name: "Ouvrir le document" }).getAttribute("href")).toBe("https://signed.example/document"));
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

  it("shows a loading state while preparing a signed document link", async () => {
    let resolveDownload!: (value: { url: string }) => void;
    createDocumentDownloadUrl.mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));
    render(<DocumentManager companies={[{ id: "co1", name: "Atelier Alpha" }]} documents={[documentRecord]} loadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Consulter" }));

    const pendingButton = await screen.findByRole("button", { name: "Préparation du lien…" });
    expect(pendingButton.hasAttribute("disabled")).toBe(true);
    resolveDownload({ url: "https://signed.example/document" });
    expect(await screen.findByRole("link", { name: "Ouvrir le document" })).toBeTruthy();
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
