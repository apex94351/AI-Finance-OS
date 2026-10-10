// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DueDateRecord } from "@/services/due-dates";

const { refresh, markInvoiceSettled } = vi.hoisted(() => ({
  refresh: vi.fn(),
  markInvoiceSettled: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/invoices/actions", () => ({ markInvoiceSettled }));

import { DeadlineManager } from "@/database/components/due-dates/deadline-manager";

const invoices: DueDateRecord[] = [
  {
    id: "upcoming",
    companyId: null,
    invoiceNumber: "FAC-2026-001",
    clientName: "Client Exemple",
    dueDate: "2026-10-15",
    total: 120,
    currency: "EUR",
    status: "pending",
  },
  {
    id: "receivable",
    companyId: "123e4567-e89b-42d3-a456-426614174000",
    invoiceNumber: "FAC-2026-002",
    clientName: "Client à encaisser",
    dueDate: "2026-10-08",
    total: 80,
    currency: "USD",
    status: "receivable",
  },
];

describe("deadline manager", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    markInvoiceSettled.mockResolvedValue({ success: "Le statut a été mis à jour." });
  });

  it("shows actual upcoming and overdue items, their amounts, dates and invoice links", () => {
    render(<DeadlineManager invoices={invoices} loadError={null} asOfDate="2026-10-10" />);

    expect(screen.getByText("Dans 5 jours")).toBeTruthy();
    expect(screen.getByText("En retard de 2 jours")).toBeTruthy();
    expect(screen.getByText(/120,00/)).toBeTruthy();
    expect(screen.getByText(/80,00/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Voir la facture/ })
      .some((link) => link.getAttribute("href") === "/invoices#invoice-upcoming")).toBe(true);
  });

  it("filters upcoming and overdue items separately", () => {
    render(<DeadlineManager invoices={invoices} loadError={null} asOfDate="2026-10-10" />);

    fireEvent.click(screen.getByRole("button", { name: "À venir" }));
    expect(screen.getByText(/Facture FAC-2026-001/)).toBeTruthy();
    expect(screen.queryByText(/Facture FAC-2026-002/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "En retard" }));
    expect(screen.queryByText(/Facture FAC-2026-001/)).toBeNull();
    expect(screen.getByText(/Facture FAC-2026-002/)).toBeTruthy();
  });

  it("filters by period and payable/receivable direction", () => {
    render(<DeadlineManager invoices={[
      ...invoices,
      {
        id: "later",
        companyId: null,
        invoiceNumber: "FAC-LATER",
        clientName: "Client futur",
        dueDate: "2026-11-20",
        total: 500,
        currency: "EUR",
        status: "pending",
      },
    ]} loadError={null} asOfDate="2026-10-10" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par période" }), { target: { value: "next7" } });
    expect(screen.getByText(/Facture FAC-2026-001/)).toBeTruthy();
    expect(screen.queryByText(/Facture FAC-LATER/)).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par période" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par sens" }), { target: { value: "receivable" } });
    expect(screen.getByText(/Facture FAC-2026-002/)).toBeTruthy();
    expect(screen.queryByText(/Facture FAC-2026-001/)).toBeNull();
  });

  it("persists settlement and refreshes the current data", async () => {
    render(<DeadlineManager invoices={invoices} loadError={null} asOfDate="2026-10-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Marquer payée" }));

    expect(markInvoiceSettled).toHaveBeenCalledWith(null, "upcoming");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a clear empty state and errors returned by the server action", async () => {
    const { rerender } = render(<DeadlineManager invoices={[]} loadError={null} asOfDate="2026-10-10" />);
    expect(screen.getByText("Aucune échéance enregistrée")).toBeTruthy();
    expect(screen.getByText(/brouillon ou annulées/)).toBeTruthy();

    markInvoiceSettled.mockResolvedValue({ error: "La mise à jour du statut a échoué." });
    rerender(<DeadlineManager invoices={invoices} loadError={null} asOfDate="2026-10-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Marquer payée" }));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("mise à jour du statut"));
  });

  it("shows incomplete amounts without treating missing dates as due dates", () => {
    render(<DeadlineManager invoices={[
      {
        id: "missing-date",
        companyId: null,
        invoiceNumber: "FAC-NO-DATE",
        clientName: "Client sans date",
        dueDate: null,
        total: null,
        currency: null,
        status: "pending",
      },
      {
        id: "missing-amount",
        companyId: null,
        invoiceNumber: "FAC-NO-AMOUNT",
        clientName: "Client sans montant",
        dueDate: "2026-10-11",
        total: null,
        currency: null,
        status: "pending",
      },
    ]} loadError={null} asOfDate="2026-10-10" />);

    expect(screen.getByText("Montant/devise à vérifier")).toBeTruthy();
    expect(screen.queryByText(/Facture FAC-NO-DATE/)).toBeNull();
    expect(screen.getByRole("link", { name: /Voir la facture/ }).getAttribute("href")).toBe("/invoices#invoice-missing-amount");
  });
});
