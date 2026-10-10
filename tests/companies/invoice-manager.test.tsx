// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceCompany, InvoiceRecord } from "@/types/invoice";

const { refresh, deleteInvoice } = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteInvoice: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/invoices/actions", () => ({
  deleteInvoice,
  saveInvoice: vi.fn(),
}));

import { InvoiceManager } from "@/database/components/invoices/invoice-manager";

const { useActionState } = vi.hoisted(() => ({
  useActionState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState };
});

const formAction = vi.fn();

const companies: InvoiceCompany[] = [{
  id: "123e4567-e89b-42d3-a456-426614174000",
  name: "Entreprise exemple",
  currency: "EUR",
}];

const invoices: InvoiceRecord[] = [{
  id: "123e4567-e89b-42d3-a456-426614174001",
  userId: null,
  companyId: companies[0].id,
  documentId: null,
  invoiceNumber: "FAC-100",
  clientName: "Client Alpha",
  description: "Prestation de conseil",
  issueDate: "2026-10-01",
  dueDate: "2026-10-30",
  subtotal: 100,
  vatRate: 20,
  vatAmount: 20,
  total: 120,
  currency: "EUR",
  status: "pending",
  category: null,
  analysis: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}];

describe("invoice manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActionState.mockReturnValue([{}, formAction, false]);
  });

  it("searches and filters the loaded invoices", () => {
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);

    expect(screen.getByText("FAC-100")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une facture" }), { target: { value: "inexistant" } });
    expect(screen.queryByText("FAC-100")).toBeNull();
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });

  it("does not invent invoices when the company has no records", () => {
    render(<InvoiceManager companies={companies} invoices={[]} loadError={null} />);

    expect(screen.getByText("Aucune facture pour le moment")).toBeTruthy();
    expect(screen.getByText(/Aucune donnée de démonstration n’est utilisée ici/)).toBeTruthy();
  });

  it("allows creating a draft without an invoice number", () => {
    render(<InvoiceManager companies={[]} invoices={[]} loadError={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Nouvelle facture" })[0]);

    const invoiceNumber = screen.getByPlaceholderText("FAC-2026-001");
    const status = screen.getByRole("combobox", { name: "Statut" });
    expect(invoiceNumber.hasAttribute("required")).toBe(true);

    fireEvent.change(status, { target: { value: "draft" } });
    expect(invoiceNumber.hasAttribute("required")).toBe(false);
  });

  it("opens a source-document invoice as a manual form without invented extracted values", () => {
    const { container } = render(<InvoiceManager
      companies={companies}
      invoices={[]}
      loadError={null}
      sourceDocument={{
        id: "123e4567-e89b-42d3-a456-426614174009",
        companyId: companies[0].id,
        fileName: "supplier-invoice.pdf",
        category: "supplier_invoice",
      }}
    />);

    expect(screen.getByText(/Aucune extraction automatique n’a été effectuée/)).toBeTruthy();
    expect(screen.getByText("supplier-invoice.pdf")).toBeTruthy();
    expect((within(container).getByLabelText("Montant HT (EUR)") as HTMLInputElement).value).toBe("");
    expect((within(container).getByLabelText("Taux de TVA (%)") as HTMLInputElement).value).toBe("");
    expect((within(container).getByLabelText("Date d’émission") as HTMLInputElement).value).toBe("");
    expect((within(container).getByLabelText("Date d’échéance") as HTMLInputElement).value).toBe("");
    expect((container.querySelector('input[name="documentId"]') as HTMLInputElement).value)
      .toBe("123e4567-e89b-42d3-a456-426614174009");
  });
});
