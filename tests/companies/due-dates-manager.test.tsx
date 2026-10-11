// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DueDateRecord } from "@/services/due-dates";
import { DeadlineManager } from "@/database/components/due-dates/deadline-manager";

const items: DueDateRecord[] = [
  {
    id: "invoice-overdue",
    companyId: null,
    customerId: "customer-1",
    invoiceNumber: "CLI-2026-001",
    clientName: "Client Exemple",
    dueDate: "2026-10-08",
    total: 120,
    currency: "EUR",
    status: "overdue",
  },
  {
    id: "supplier-invoice",
    companyId: "123e4567-e89b-42d3-a456-426614174000",
    supplierId: "supplier-1",
    invoiceNumber: "SUP-2026-002",
    clientName: "Fournisseur Exemple",
    dueDate: "2026-10-15",
    total: 80,
    currency: "EUR",
    status: "pending",
  },
  {
    id: "partially-paid-expense",
    sourceType: "expense",
    companyId: null,
    supplierId: "supplier-2",
    invoiceNumber: null,
    clientName: "Hébergement",
    label: "Cloud annuel",
    dueDate: "2026-10-20",
    total: 75,
    grossTotal: 100,
    paidAmount: 25,
    currency: "EUR",
    status: "pending",
  },
];

describe("deadline manager", () => {
  afterEach(cleanup);

  it("shows the three euro indicators and explains the forecast balance", () => {
    render(
      <DeadlineManager
        invoices={items}
        counterpartyNames={{ "customer-1": "Client Exemple", "supplier-1": "Fournisseur Exemple", "supplier-2": "Hébergement" }}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    const indicators = screen.getByRole("region", { name: "Prévisionnel des échéances" });
    expect(within(indicators).getByText("Total à encaisser")).toBeTruthy();
    expect(within(indicators).getByText("Total à payer")).toBeTruthy();
    expect(within(indicators).getByText("Solde prévisionnel")).toBeTruthy();
    expect(within(indicators).getByText(/120,00/)).toBeTruthy();
    expect(within(indicators).getByText(/155,00/)).toBeTruthy();
    expect(within(indicators).getByText(/35,00/)).toBeTruthy();
    expect(screen.getByText(/ne représente pas le solde bancaire réel/)).toBeTruthy();
  });

  it("includes undated expenses in totals without showing them as dated deadlines", () => {
    render(
      <DeadlineManager
        invoices={[{
          id: "undated-expense",
          sourceType: "expense",
          companyId: null,
          supplierId: "supplier-1",
          invoiceNumber: null,
          clientName: "Abonnement",
          label: "Abonnement",
          dueDate: null,
          total: 75,
          grossTotal: 100,
          paidAmount: 25,
          currency: "EUR",
          status: "pending",
        }]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    const indicators = screen.getByRole("region", { name: "Prévisionnel des échéances" });
    const cards = within(indicators).getAllByRole("article");
    expect(cards[1]?.textContent).toContain("75,00");
    expect(cards[2]?.textContent).toContain("-75,00");
    expect(screen.getByText("Aucune échéance active")).toBeTruthy();
  });

  it("keeps a one-cent forecast balance visually neutral", () => {
    render(
      <DeadlineManager
        invoices={[{
          id: "one-cent-invoice",
          companyId: null,
          customerId: "customer-1",
          invoiceNumber: "CLI-ONE-CENT",
          clientName: "Client Exemple",
          dueDate: "2026-10-15",
          total: 0.01,
          currency: "EUR",
          status: "receivable",
        }]}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    const indicators = screen.getByRole("region", { name: "Prévisionnel des échéances" });
    const cards = within(indicators).getAllByRole("article");
    expect(cards[2]?.className).not.toContain("is-positive");
    expect(cards[2]?.className).not.toContain("is-negative");
  });

  it("exposes exactly the requested filters and retains late obligations in all", () => {
    render(<DeadlineManager invoices={items} loadError={null} asOfDate="2026-10-10" />);

    const filterGroup = screen.getByRole("group", { name: "Type d’échéance" });
    const buttons = within(filterGroup).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Toutes", "À payer", "À encaisser"]);
    expect(screen.getByText("En retard")).toBeTruthy();
    fireEvent.click(within(filterGroup).getByRole("button", { name: "À encaisser" }));
    expect(screen.getByText("Client Exemple")).toBeTruthy();
    expect(screen.queryByText("Fournisseur Exemple")).toBeNull();
    fireEvent.click(within(filterGroup).getByRole("button", { name: "Toutes" }));
    expect(screen.getByText("Fournisseur Exemple")).toBeTruthy();
  });

  it("searches by client, supplier, or invoice reference and links to the source record", () => {
    render(
      <DeadlineManager
        invoices={items}
        counterpartyNames={{ "customer-1": "Client Exemple", "supplier-1": "Fournisseur Exemple", "supplier-2": "Hébergement" }}
        loadError={null}
        asOfDate="2026-10-10"
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une échéance" }), {
      target: { value: "SUP-2026-002" },
    });
    expect(screen.getByText("Fournisseur Exemple")).toBeTruthy();
    expect(screen.queryByText("Client Exemple")).toBeNull();
    expect(screen.getByRole("link", { name: /SUP-2026-002/ }).getAttribute("href")).toBe("/invoices#invoice-supplier-invoice");

    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une échéance" }), {
      target: { value: "Hébergement" },
    });
    expect(screen.getByRole("link", { name: /Dépense · Cloud annuel/ }).getAttribute("href")).toBe("/expenses");
  });

  it("shows useful empty, loading-error, and partial-data messages", () => {
    const { rerender } = render(<DeadlineManager invoices={[]} loadError={null} asOfDate="2026-10-10" />);
    expect(screen.getByText("Aucune échéance active")).toBeTruthy();

    rerender(<DeadlineManager invoices={[]} loadError="Chargement impossible." asOfDate="2026-10-10" />);
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible");

    rerender(<DeadlineManager invoices={items} loadError={null} partialDataWarning="Données partielles." asOfDate="2026-10-10" />);
    expect(screen.getByRole("status").textContent).toContain("Données partielles");
  });
});
