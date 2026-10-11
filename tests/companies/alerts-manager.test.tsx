// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AlertsManager } from "@/database/components/alerts/alerts-manager";
import type { InvoiceRecord } from "@/types/invoice";

function invoice(id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id,
    userId: null,
    companyId: null,
    invoiceType: "customer",
    documentId: null,
    invoiceNumber: `FAC-${id}`,
    clientName: "Client exemple",
    description: "Prestation",
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
    ...overrides,
  };
}

describe("alerts manager", () => {
  afterEach(cleanup);

  it("renders categorized prioritized invoice alerts with due date and source links", () => {
    render(<AlertsManager
      invoices={[
        invoice("late", { dueDate: "2026-10-08" }),
        invoice("soon", { dueDate: "2026-10-15" }),
        invoice("draft", { status: "draft", dueDate: null, invoiceNumber: null }),
        invoice("missing-date", { dueDate: null }),
      ]}
      loadError={null}
      asOfDate="2026-10-10"
    />);

    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByText("Facture en retard")).toBeTruthy();
    expect(screen.getByText("Échéance dans les 7 jours")).toBeTruthy();
    expect(screen.getByText("Brouillon à finaliser")).toBeTruthy();
    expect(screen.getByText("Vérification requise")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Ouvrir la facture" })[0]?.getAttribute("href")).toBe("/invoices#invoice-late");
    const lateRow = screen.getAllByRole("link", { name: "Ouvrir la facture" })[0]?.closest("article");
    expect(lateRow?.textContent).toContain("08 octobre 2026");
  });

  it("shows an explicit empty state and reports query errors without showing false alerts", () => {
    const { rerender } = render(<AlertsManager invoices={[
      invoice("paid", { status: "paid", dueDate: "2026-10-01" }),
      invoice("cancelled", { status: "cancelled" }),
    ]} loadError={null} asOfDate="2026-10-10" />);

    expect(screen.getByText("Aucune alerte à traiter")).toBeTruthy();
    rerender(<AlertsManager invoices={[]} loadError="Chargement impossible." asOfDate="2026-10-10" />);
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible.");
    expect(screen.queryByText("Aucune alerte à traiter")).toBeNull();
  });
});
