// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "@/database/components/dashboard/dashboard-client";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function invoice(id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id,
    userId: null,
    companyId: null,
    customerId: "customer-id",
    supplierId: null,
    documentId: null,
    invoiceNumber: `FAC-${id}`,
    clientName: "Client enregistré",
    description: "Prestation",
    issueDate: "2026-10-05",
    dueDate: "2026-10-30",
    subtotal: 100,
    vatRate: 0,
    vatAmount: 0,
    total: 100,
    currency: "EUR",
    status: "receivable" satisfies InvoiceStatus,
    category: null,
    analysis: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

function expense(id: string, overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id,
    userId: null,
    companyId: null,
    label: `Dépense ${id}`,
    amount: 12,
    currency: "EUR",
    expenseDate: "2026-10-10",
    category: "Frais",
    supplierId: null,
    supplierName: null,
    status: "paid",
    notes: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard cockpit", () => {
  afterEach(cleanup);

  it("shows the four finance cards from outstanding invoices, issued invoices and recorded expenses", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("client-open", { total: 120 }),
          invoice("client-paid", { status: "paid", total: 75 }),
          invoice("supplier-open", { customerId: null, supplierId: "supplier-id", status: "pending", total: 80 }),
          invoice("issued-paid", { status: "paid", issueDate: "2026-10-08", total: 50 }),
        ]}
        expenses={[expense("pending", { status: "pending", amount: 15 })]}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const receivableCard = screen.getByRole("link", { name: /À encaisser.*Solde à date/ });
    const payableCard = screen.getByRole("link", { name: /À payer.*Solde à date/ });
    const invoicedCard = screen.getByRole("link", { name: /Facturé sur la période.*Factures clients émises/ });
    const expenseCard = screen.getByRole("link", { name: /Dépenses enregistrées.*Dépenses non annulées/ });
    expect(receivableCard.textContent).toContain("120,00");
    expect(payableCard.textContent).toContain("80,00");
    expect(invoicedCard.textContent).toContain("245,00");
    expect(expenseCard.textContent).toContain("15,00");
    expect(invoicedCard.getAttribute("href"))
      .toBe("/invoices?dashboardFilter=customer-invoices");
    expect(screen.getByText(/Les règlements partiels ne sont pas enregistrés/)).toBeTruthy();
  });

  it("updates the period-scoped cards and paid-expense chart using real period controls", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("older-issued", { issueDate: "2026-09-15", total: 200 }),
          invoice("recent-issued", { issueDate: "2026-10-10", total: 50 }),
        ]}
        expenses={[
          expense("older", { expenseDate: "2026-09-15", amount: 40 }),
          expense("recent", { expenseDate: "2026-10-10", amount: 12 }),
        ]}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const billed = screen.getByRole("link", { name: /Facturé sur la période.*Factures clients émises/ });
    expect(billed.textContent).toContain("250,00");
    const chart = screen.getByRole("img", { name: "Dépenses enregistrées comme payées par date" });
    expect(chart.getAttribute("width")).toBe("720");
    expect(chart.getAttribute("height")).toBe("220");
    expect(chart.querySelectorAll(".dashboard-chart-bar")).toHaveLength(2);
    expect(chart.querySelectorAll(".dashboard-chart-axis")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "7 jours" }));
    expect(billed.textContent).toContain("50,00");
    expect(screen.getByRole("button", { name: "7 jours" }).getAttribute("aria-pressed")).toBe("true");
    expect(chart.querySelectorAll(".dashboard-chart-bar")).toHaveLength(1);
    expect(chart.querySelectorAll(".dashboard-chart-axis")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Personnalisée" }));
    fireEvent.change(screen.getByLabelText("Date de début personnalisée"), { target: { value: "2026-10-09" } });
    fireEvent.change(screen.getByLabelText("Date de fin personnalisée"), { target: { value: "2026-10-10" } });
    expect(billed.textContent).toContain("50,00");
    expect(screen.getByRole("img", { name: "Dépenses enregistrées comme payées par date" })
      .querySelectorAll(".dashboard-chart-axis")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "1 an" }));
    const yearlyChart = screen.getByRole("img", { name: "Dépenses enregistrées comme payées par date" });
    expect(yearlyChart.textContent).toContain("25");
    expect(yearlyChart.textContent).toContain("26");
  });

  it("draws positive, in-bounds SVG bars only for paid expenses in the selected month", () => {
    render(
      <DashboardClient
        invoices={[]}
        expenses={[
          expense("paid-in-month-one", { expenseDate: "2026-10-10", amount: 12.34 }),
          expense("paid-in-month-two", { expenseDate: "2026-10-10", amount: 7.66 }),
          expense("paid-at-month-start", { expenseDate: "2026-09-11", amount: 5 }),
          expense("paid-before-month", { expenseDate: "2026-09-10", amount: 90 }),
          expense("paid-after-month", { expenseDate: "2026-10-12", amount: 80 }),
          expense("pending-in-month", { status: "pending", expenseDate: "2026-10-09", amount: 70 }),
          expense("paid-usd-in-month", { expenseDate: "2026-10-11", amount: 4, currency: "USD" }),
        ]}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const charts = screen.getAllByRole("img", { name: "Dépenses enregistrées comme payées par date" });
    expect(charts).toHaveLength(2);
    const eurChart = charts.find((chart) => chart.closest(".dashboard-chart-series")?.querySelector("h3")?.textContent === "EUR");
    const usdChart = charts.find((chart) => chart.closest(".dashboard-chart-series")?.querySelector("h3")?.textContent === "USD");
    expect(eurChart).toBeTruthy();
    expect(usdChart).toBeTruthy();

    const eurBars = [...eurChart!.querySelectorAll<SVGRectElement>(".dashboard-chart-bar")];
    expect(eurBars).toHaveLength(2);
    const aggregatedBar = eurBars.find((bar) => bar.querySelector("title")?.textContent.includes("20,00"));
    expect(aggregatedBar).toBeTruthy();

    for (const bar of [...eurBars, ...usdChart!.querySelectorAll<SVGRectElement>(".dashboard-chart-bar")]) {
      const x = Number(bar.getAttribute("x"));
      const y = Number(bar.getAttribute("y"));
      const width = Number(bar.getAttribute("width"));
      const height = Number(bar.getAttribute("height"));
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(720);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y + height).toBeLessThanOrEqual(180);
    }
  });

  it("renders separate currency charts and an explicit empty state without confusing it with load errors", () => {
    const { rerender } = render(
      <DashboardClient
        invoices={[]}
        expenses={[
          expense("eur", { amount: 15 }),
          expense("usd", { amount: 8, currency: "USD" }),
        ]}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    expect(screen.getAllByRole("img", { name: "Dépenses enregistrées comme payées par date" })).toHaveLength(2);
    expect(screen.getByText("EUR")).toBeTruthy();
    expect(screen.getByText("USD")).toBeTruthy();

    rerender(<DashboardClient invoices={[]} expenses={[]} loadError={null} asOfDate="2026-10-11" />);
    expect(screen.getByText(/Aucune dépense marquée comme payée sur cette période/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Dépenses enregistrées comme payées par date" })).toBeNull();

    rerender(<DashboardClient
      invoices={[]}
      expenses={[]}
      expensesLoadError="Erreur de chargement explicite."
      loadError={null}
      asOfDate="2026-10-11"
    />);
    expect(screen.getByRole("alert").textContent).toContain("Erreur de chargement explicite.");
    expect(screen.queryByText(/Aucune dépense marquée comme payée/)).toBeNull();
  });

  it("shows priority and due items with links to filtered lists and invoice details", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("late-customer", { dueDate: "2026-10-10", total: 100 }),
          invoice("near-customer", { dueDate: "2026-10-12", total: 80 }),
          invoice("near-supplier", { customerId: null, supplierId: "supplier-id", status: "pending", dueDate: "2026-10-13", total: 60 }),
          invoice("paid-late", { status: "paid", dueDate: "2026-10-01", total: 900 }),
        ]}
        counterpartyNames={{ "supplier-id": "Fournisseur enregistré" }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    expect(screen.getByRole("link", { name: /Factures clients en retard/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=customer-overdue");
    expect(screen.getByRole("link", { name: /Paiements fournisseurs à venir/ }).getAttribute("href"))
      .toBe("/invoices?dashboardFilter=supplier-upcoming");
    expect(screen.getByRole("link", { name: /Documents à vérifier/ }).getAttribute("href")).toBe("/documents");
    expect(screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/invoices#invoice-late-customer")).toBeTruthy();
    expect(screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/invoices#invoice-near-supplier")).toBeTruthy();
    expect(screen.queryByText("FAC-paid-late")).toBeNull();
    expect(within(screen.getByRole("heading", { name: "Échéances" }).parentElement!.parentElement!)
      .getByRole("link", { name: "Liste complète" }).getAttribute("href")).toBe("/due-dates");
  });

  it("keeps global balances at-date while filtering personal or company workspace", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("personal", { total: 75 }),
          invoice("company", { companyId: "company-id", total: 20 }),
        ]}
        companies={[{ id: "company-id", name: "Atelier Nova", currency: "EUR" }]}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const receivables = screen.getByRole("link", { name: /À encaisser.*Solde à date/ });
    expect(receivables.textContent).toContain("95,00");
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer le Dashboard par espace" }), {
      target: { value: "company-id" },
    });
    expect(receivables.textContent).toContain("20,00");
  });

  it("reports extraction-review and payment-history limitations rather than guessing", () => {
    render(
      <DashboardClient
        invoices={[]}
        expenses={[]}
        loadError={null}
        expensesLoadError="Les dépenses sont indisponibles dans le schéma chargé."
        asOfDate="2026-10-11"
      />,
    );

    expect(screen.getByText(/son état de vérification n’est pas enregistré/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("dépenses");
    expect(screen.getByText(/Aucun journal de règlements clients\/fournisseurs ni solde initial bancaire/)).toBeTruthy();
    expect(screen.getByText(/Aucune facture en retard/)).toBeTruthy();
  });

  it("surfaces invoice load errors and provides a functioning refresh control", () => {
    render(<DashboardClient invoices={[]} loadError="Chargement impossible." asOfDate="2026-10-11" />);
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /À encaisser/ }).textContent).toContain("—");
  });
});
