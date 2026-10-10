// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "@/database/components/dashboard/dashboard-client";
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function invoice(
  id: string,
  overrides: Partial<InvoiceRecord> = {},
): InvoiceRecord {
  return {
    id,
    userId: null,
    companyId: null,
    documentId: null,
    invoiceNumber: `FAC-${id}`,
    clientName: "Client exemple",
    description: "Prestation",
    issueDate: "2026-10-01",
    dueDate: "2026-10-30",
    subtotal: 100,
    vatRate: 0,
    vatAmount: 0,
    total: 100,
    currency: "EUR",
    status: "pending" satisfies InvoiceStatus,
    category: null,
    analysis: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard", () => {
  afterEach(cleanup);

  it("shows amounts by explicit status without combining currencies", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("pending-eur", { total: 100, currency: "EUR" }),
          invoice("pending-usd", { total: 50, currency: "USD" }),
          invoice("receivable-eur", { status: "receivable", total: 75 }),
          invoice("late-gbp", { status: "overdue", dueDate: "2026-10-08", currency: "GBP", total: 20 }),
        ]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    expect(screen.getByRole("article", { name: /À payer/ }).textContent).toContain("100,00");
    expect(screen.getByRole("article", { name: /À payer/ }).textContent).toContain("50,00");
    expect(screen.getByRole("article", { name: /À recevoir/ }).textContent).toContain("75,00");
    expect(screen.getByRole("article", { name: /Échéances en retard/ }).textContent).toContain("20,00");
    expect(screen.getByText("Échéance dépassée")).toBeTruthy();
    expect(screen.queryByText(/sens/i)).toBeNull();
  });

  it("shows real dated priorities, next due links, and recent timestamp-backed activity", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("late", { dueDate: "2026-10-08", status: "overdue", invoiceNumber: "FAC-LATE" }),
          invoice("soon", { dueDate: "2026-10-12", invoiceNumber: "FAC-SOON" }),
          invoice("later", { dueDate: "2026-11-01", invoiceNumber: "FAC-LATER" }),
          invoice("recent", {
            createdAt: "2026-10-09T09:00:00.000Z",
            updatedAt: "2026-10-10T09:00:00.000Z",
            invoiceNumber: "FAC-RECENT",
          }),
        ]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    const priorityItems = screen.getAllByRole("link", { name: "Ouvrir" });
    expect(priorityItems[0]?.getAttribute("href")).toBe("/invoices#invoice-late");
    expect(priorityItems[1]?.getAttribute("href")).toBe("/invoices#invoice-soon");
    expect(screen.getByRole("link", { name: /FAC-SOON/ }).getAttribute("href")).toBe("/invoices#invoice-soon");
    expect(screen.getByText(/Facture mise à jour/)).toBeTruthy();
    expect(screen.getByText(/Aperçu fondé sur les horodatages des factures/)).toBeTruthy();
  });

  it("shows a draft as a follow-up action but not as an upcoming due date", () => {
    render(
      <DashboardClient
        invoices={[invoice("draft", { status: "draft", dueDate: null })]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    expect(screen.getAllByText("Brouillon à finaliser").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Ouvrir" }).getAttribute("href")).toBe("/invoices#invoice-draft");
    expect(screen.getByText("Aucune échéance future active.")).toBeTruthy();
  });

  it("shows explicitly linked client and supplier names on upcoming invoices", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("customer", { status: "receivable", customerId: "customer-id", clientName: "Old name" }),
          invoice("supplier", { status: "pending", supplierId: "supplier-id", clientName: "Legacy field" }),
        ]}
        counterpartyNames={{ "customer-id": "Client enregistré", "supplier-id": "Fournisseur enregistré" }}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    expect(screen.getAllByText("Client enregistré").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fournisseur enregistré").length).toBeGreaterThan(0);
  });

  it("filters the dashboard to the selected personal or company workspace", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("personal-receivable", { status: "receivable", total: 75 }),
          invoice("company-payable", { companyId: "company-id", total: 20 }),
        ]}
        companies={[{ id: "company-id", name: "Atelier Nova" }]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    const receivables = screen.getByRole("article", { name: /À recevoir/ });
    expect(receivables.textContent).toContain("75,00");
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer l’accueil par espace" }), {
      target: { value: "company-id" },
    });
    expect(receivables.textContent).toContain("—");
    expect(screen.getByRole("article", { name: /À payer/ }).textContent).toContain("20,00");
  });

  it("does not count drafts, cancelled, or paid invoices as active due items and offers draft follow-up", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("paid", { status: "paid", dueDate: "2026-10-01", total: 500 }),
          invoice("draft", { status: "draft", dueDate: "2026-10-01", total: 600 }),
          invoice("cancelled", { status: "cancelled", dueDate: "2026-10-01", total: 700 }),
        ]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    expect(screen.getByText("0 / 0")).toBeTruthy();
    expect(screen.getByText("Brouillon à finaliser")).toBeTruthy();
    expect(screen.getByText("Aucune échéance future active.")).toBeTruthy();
  });

  it("handles incomplete invoice data and load errors without inventing totals", () => {
    const { rerender } = render(
      <DashboardClient
        invoices={[invoice("incomplete", { dueDate: null, total: null, currency: null })]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    expect(screen.getByText(/Date d’échéance absente ou invalide/)).toBeTruthy();
    expect(screen.getByText(/Date manquante/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    rerender(<DashboardClient invoices={[]} loadError="Chargement impossible." asOfDate="2026-10-10" />);
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible.");
    expect(screen.getByText("Les priorités sont indisponibles tant que les données ne sont pas chargées.")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refresh).toHaveBeenCalled();
  });
});
