// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiCfoClient } from "@/database/components/ai-cfo/ai-cfo-client";
import type { InvoiceRecord } from "@/types/invoice";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function invoice(id: string, companyId: string | null): InvoiceRecord {
  return {
    id,
    userId: null,
    companyId,
    invoiceType: "customer",
    documentId: null,
    invoiceNumber: id,
    clientName: "Client",
    description: null,
    issueDate: "2026-10-01",
    dueDate: "2026-10-12",
    subtotal: 25,
    vatRate: 0,
    vatAmount: 0,
    total: 25,
    currency: "EUR",
    status: "pending",
    category: null,
    analysis: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("AI CFO page", () => {
  afterEach(() => {
    cleanup();
    refresh.mockClear();
  });

  it("reports missing financial data and refreshes from the server", () => {
    render(
      <AiCfoClient
        invoices={[]}
        expenses={[]}
        companies={[]}
        invoiceError="Factures indisponibles."
        expenseError="Dépenses indisponibles."
        asOfDate="2026-10-10"
      />,
    );
    expect(screen.getAllByRole("alert")[0]?.textContent).toContain("Factures indisponibles.");
    expect(screen.getAllByRole("alert")[1]?.textContent).toContain("Dépenses indisponibles.");
    expect(screen.getByText("Analyse des factures indisponible")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("filters invoice priorities to the chosen authorized workspace", () => {
    render(
      <AiCfoClient
        invoices={[invoice("personal", null), invoice("company-invoice", "company-a")]}
        expenses={[]}
        companies={[{ id: "company-a", name: "Entreprise A" }]}
        invoiceError={null}
        expenseError={null}
        asOfDate="2026-10-10"
      />,
    );
    expect(screen.getByText("2 facture(s) active(s), toutes échéances confondues")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer AI CFO par espace" }), {
      target: { value: "company-a" },
    });
    expect(screen.getByText("1 facture(s) active(s), toutes échéances confondues")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir company-invoice" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ouvrir personal" })).toBeNull();
  });
});
