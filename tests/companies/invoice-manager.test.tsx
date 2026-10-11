// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceCompany, InvoiceRecord } from "@/types/invoice";

const { refresh, deleteInvoice, updateInvoicePaymentStatus } = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteInvoice: vi.fn(),
  updateInvoicePaymentStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/invoices/actions", () => ({
  deleteInvoice,
  updateInvoicePaymentStatus,
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it("applies Dashboard deep-link filters to customer arrears and upcoming supplier invoices", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    const supplierInvoice: InvoiceRecord = {
      ...invoices[0]!,
      id: "supplier-invoice",
      invoiceNumber: "SUP-200",
      supplierId: "supplier-id",
      customerId: null,
      dueDate: "2026-10-20",
      status: "pending",
    };
    const lateCustomerInvoice = {
      ...invoices[0]!,
      id: "late-customer-invoice",
      invoiceNumber: "FAC-LATE",
      dueDate: "2026-10-10",
      status: "overdue" as const,
    };

    const { rerender } = render(
      <InvoiceManager
        companies={companies}
        invoices={[supplierInvoice, lateCustomerInvoice]}
        loadError={null}
        initialDashboardFilter="customer-overdue"
      />,
    );
    expect(screen.getByRole("heading", { name: "Factures clients en retard" })).toBeTruthy();
    expect(screen.getByText("FAC-LATE")).toBeTruthy();
    expect(screen.queryByText("SUP-200")).toBeNull();

    rerender(
      <InvoiceManager
        companies={companies}
        invoices={[supplierInvoice, lateCustomerInvoice]}
        loadError={null}
        initialDashboardFilter="supplier-upcoming"
      />,
    );
    expect(screen.getByRole("heading", { name: "Paiements fournisseurs à venir" })).toBeTruthy();
    expect(screen.getByText("SUP-200")).toBeTruthy();
    expect(screen.queryByText("FAC-LATE")).toBeNull();
    vi.useRealTimers();
  });

  it("does not invent invoices when the company has no records", () => {
    render(<InvoiceManager companies={companies} invoices={[]} loadError={null} />);

    expect(screen.getByRole("link", { name: /Factures clients impayées/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=customer-open&overviewPeriod=all");
    expect(screen.getByRole("link", { name: /Factures fournisseurs à payer/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=supplier-open&overviewPeriod=all");
    expect(screen.getByRole("link", { name: /Factures en retard/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=all-overdue&overviewPeriod=all");
    expect(screen.getByText(/Factures clients − factures fournisseurs/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Récapitulatif clients" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Récapitulatif fournisseurs" })).toBeTruthy();
    expect(screen.getByText("Aucune facture pour le moment")).toBeTruthy();
    expect(screen.getByText(/Aucune donnée de démonstration n’est utilisée ici/)).toBeTruthy();
  });

  it("shows client, supplier, and late invoice links that feed the existing URL filters", () => {
    const supplierInvoice: InvoiceRecord = {
      ...invoices[0]!,
      id: "supplier-overdue",
      invoiceNumber: "SUP-LATE",
      customerId: null,
      supplierId: "supplier-id",
      status: "overdue",
      dueDate: "2026-10-10",
    };
    const { rerender } = render(
      <InvoiceManager companies={companies} invoices={[invoices[0]!, supplierInvoice]} loadError={null} />,
    );

    expect(screen.getByRole("link", { name: /Factures clients impayées/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=customer-open&overviewPeriod=all");
    expect(screen.getByRole("link", { name: /Factures fournisseurs à payer/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=supplier-open&overviewPeriod=all");
    expect(screen.getByRole("link", { name: /Factures en retard/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=all-overdue&overviewPeriod=all");

    rerender(
      <InvoiceManager
        companies={companies}
        invoices={[invoices[0]!, supplierInvoice]}
        loadError={null}
        initialDashboardFilter="supplier-open"
      />,
    );
    expect(screen.getByRole("heading", { name: "Factures fournisseurs à payer" })).toBeTruthy();
    expect(screen.getByText("SUP-LATE")).toBeTruthy();
    expect(screen.queryByText("FAC-100")).toBeNull();
    expect(screen.getByRole("link", { name: "Toutes les factures" }).getAttribute("href")).toBe("/invoices");
  });

  it("scopes overview figures to the existing workspace filter", () => {
    const personalInvoice: InvoiceRecord = {
      ...invoices[0]!,
      id: "personal-invoice",
      companyId: null,
      total: 30,
    };
    render(
      <InvoiceManager
        companies={companies}
        invoices={[invoices[0]!, personalInvoice]}
        loadError={null}
      />,
    );

    const customerOpenCard = screen.getByRole("link", { name: /Factures clients impayées/ });
    expect(customerOpenCard.textContent).toContain("150,00");
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par espace" }), {
      target: { value: "personal" },
    });
    expect(customerOpenCard.textContent).toContain("30,00");
  });

  it("offers the three payment statuses in the invoice form", () => {
    render(<InvoiceManager companies={[]} invoices={[]} loadError={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Nouvelle facture" })[0]);

    const invoiceNumber = screen.getByPlaceholderText("FAC-2026-001");
    const status = screen.getByRole("combobox", { name: "Statut" });
    expect(invoiceNumber.hasAttribute("required")).toBe(true);
    expect(within(status).queryByRole("option", { name: "Brouillon" })).toBeNull();
    expect(within(status).getByRole("option", { name: "À payer" })).toBeTruthy();
    expect(within(status).getByRole("option", { name: "Payée" })).toBeTruthy();
    expect(within(status).getByRole("option", { name: "En retard" })).toBeTruthy();
  });

  it("filters on every character without case sensitivity, normalizes spaces, and restores on clear", () => {
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    const search = screen.getByRole("searchbox", { name: "Rechercher une facture" });

    fireEvent.change(search, { target: { value: " f" } });
    expect(screen.getByText("FAC-100")).toBeTruthy();
    fireEvent.change(search, { target: { value: "  CLIENT   AL" } });
    expect(screen.getByText("FAC-100")).toBeTruthy();
    fireEvent.change(search, { target: { value: "  xyz " } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("FAC-100")).toBeTruthy();
  });

  it("filters by amount and combines search with status filters", () => {
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une facture" }), { target: { value: "120,00" } });
    expect(screen.getByText("FAC-100")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par statut" }), { target: { value: "paid" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });

  it("keeps invoice-summary card results scoped to the selected issue period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    const historical = { ...invoices[0]!, id: "historical", invoiceNumber: "FAC-OLD", issueDate: "2025-10-01" };
    render(
      <InvoiceManager
        companies={companies}
        invoices={[invoices[0]!, historical]}
        loadError={null}
        initialDashboardFilter="customer-open"
        initialOverviewPeriod="month"
      />,
    );

    expect(screen.getByText("FAC-100")).toBeTruthy();
    expect(screen.queryByText("FAC-OLD")).toBeNull();
    expect(screen.getByRole("link", { name: /Factures clients impayées/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=customer-open&overviewPeriod=month");
    expect((screen.getByRole("combobox", { name: "Période des indicateurs" }) as HTMLSelectElement).value).toBe("month");
    vi.useRealTimers();
  });

  it("persists payment status changes from the interactive status badge", async () => {
    updateInvoicePaymentStatus.mockResolvedValue({ success: "Le statut de la facture a été mis à jour." });
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Statut À payer pour FAC-100" }));
    fireEvent.click(screen.getByRole("button", { name: "Payée" }));

    expect(updateInvoicePaymentStatus).toHaveBeenCalledWith(companies[0]!.id, invoices[0]!.id, "paid");
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("lets the user manually mark an upcoming invoice as overdue", async () => {
    updateInvoicePaymentStatus.mockResolvedValue({ success: "Le statut de la facture a été mis à jour." });
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Statut À payer pour FAC-100" }));

    const overdueOption = await screen.findByRole("button", { name: "En retard" });
    expect(overdueOption.closest(".invoice-table-scroll")).toBeNull();
    fireEvent.click(overdueOption);

    expect(updateInvoicePaymentStatus).toHaveBeenCalledWith(companies[0]!.id, invoices[0]!.id, "overdue");
  });

  it("keeps the three status choices visible when the menu opens above the button", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      if (this.classList.contains("invoice-status-button")) {
        return { x: 20, y: 700, top: 700, right: 100, bottom: 730, left: 20, width: 80, height: 30, toJSON: () => ({}) };
      }
      if (this.classList.contains("invoice-status-menu")) {
        return { x: 0, y: 0, top: 0, right: 145, bottom: 100, left: 0, width: 145, height: 100, toJSON: () => ({}) };
      }
      return { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON: () => ({}) };
    });
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Statut À payer pour FAC-100" }));

    const menu = await screen.findByRole("button", { name: "En retard" });
    const menuContainer = menu.parentElement;
    expect(menuContainer?.getAttribute("style")).toContain("top: 595px");
    expect(within(menuContainer as HTMLElement).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["À payer", "Payée", "En retard"]);
    expect(within(menuContainer as HTMLElement).getByRole("button", { name: "À payer" })).toBeTruthy();
    expect(within(menuContainer as HTMLElement).getByRole("button", { name: "Payée" })).toBeTruthy();
  });

  it("shows a clear error instead of success when the status update fails", async () => {
    updateInvoicePaymentStatus.mockResolvedValue({ error: "La mise à jour du statut a échoué." });
    render(<InvoiceManager companies={companies} invoices={invoices} loadError={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Statut À payer pour FAC-100" }));
    fireEvent.click(screen.getByRole("button", { name: "Payée" }));

    expect((await screen.findByRole("alert")).textContent).toContain("La mise à jour du statut a échoué.");
    expect(screen.queryByText("Le statut de la facture a été mis à jour.")).toBeNull();
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
