// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "@/database/components/dashboard/dashboard-client";
import DashboardLoading from "@/app/dashboard/loading";
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
    expect(screen.getByText(/pas des soldes bancaires/)).toBeTruthy();
  });

  it("exposes the dashboard loading skeleton as an accessible busy state", () => {
    render(<DashboardLoading />);

    expect(screen.getByRole("status", { name: "Chargement du tableau de bord" }).getAttribute("aria-busy"))
      .toBe("true");
  });

  it("updates the period-scoped cards and recorded-expense chart using real period controls", () => {
    render(
      <DashboardClient
        invoices={[
          invoice("older-issued", { issueDate: "2026-09-15", total: 200 }),
          invoice("recent-issued", { issueDate: "2026-10-10", total: 50 }),
        ]}
        customerPayments={[
          { invoiceId: "recent-issued", paymentDate: "2026-10-10", amount: 50 },
        ]}
        expenses={[
          expense("older", { expenseDate: "2026-09-15", amount: 40 }),
          expense("recent", { expenseDate: "2026-10-10", amount: 12 }),
        ]}
        expensePayments={[
          { expenseId: "recent", paymentDate: "2026-10-10", amount: 12 },
        ]}
        paymentHistoryAvailability={{ customer: true, expenses: true }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const billed = screen.getByRole("link", { name: /Facturé sur la période.*Factures clients émises/ });
    expect(billed.textContent).toContain("250,00");
    const chart = screen.getByRole("group", { name: "Graphique interactif des flux en EUR" });
    expect(chart.getAttribute("viewBox")).toBe("0 0 720 248");
    expect(chart.querySelectorAll(".dashboard-chart-line path").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "7 jours" }));
    expect(billed.textContent).toContain("50,00");
    expect(screen.getByRole("button", { name: "7 jours" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("group", { name: "Graphique interactif des flux en EUR" })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Graphique interactif des flux en EUR" })
      .querySelectorAll(".dashboard-chart-axis")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Personnalisée" }));
    fireEvent.change(screen.getByLabelText("Date de début personnalisée"), { target: { value: "2026-10-09" } });
    fireEvent.change(screen.getByLabelText("Date de fin personnalisée"), { target: { value: "2026-10-10" } });
    expect(billed.textContent).toContain("50,00");
    expect(screen.getByRole("group", { name: "Graphique interactif des flux en EUR" })
      .querySelectorAll(".dashboard-chart-axis")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "3 mois" }));
    expect(screen.getByRole("button", { name: "3 mois" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Graphique interactif des flux en EUR" })
      .querySelectorAll(".dashboard-chart-axis").length).toBeGreaterThan(3);
    fireEvent.click(screen.getByRole("button", { name: "6 mois" }));
    expect(screen.getByRole("button", { name: "6 mois" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "1 an" }));
    const yearlyChart = screen.getByRole("group", { name: "Graphique interactif des flux en EUR" });
    expect(yearlyChart.textContent).toContain("25");
    expect(yearlyChart.textContent).toContain("26");
  });

  it("draws distinct currency lines only from dated payment entries", () => {
    render(
      <DashboardClient
        invoices={[]}
        expenses={[
          expense("paid-in-month-one", { expenseDate: "2026-10-10", amount: 12.34 }),
          expense("paid-in-month-two", { expenseDate: "2026-10-10", amount: 7.66 }),
          expense("paid-at-month-start", { expenseDate: "2026-09-15", amount: 5 }),
          expense("paid-before-month", { expenseDate: "2026-09-11", amount: 90 }),
          expense("paid-after-month", { expenseDate: "2026-10-12", amount: 80 }),
          expense("pending-in-month", { status: "pending", expenseDate: "2026-10-09", amount: 70 }),
          expense("paid-usd-in-month", { expenseDate: "2026-10-11", amount: 4, currency: "USD" }),
        ]}
        expensePayments={[
          { expenseId: "paid-in-month-one", paymentDate: "2026-10-10", amount: 12.34 },
          { expenseId: "paid-in-month-two", paymentDate: "2026-10-10", amount: 7.66 },
          { expenseId: "paid-at-month-start", paymentDate: "2026-09-15", amount: 5 },
          { expenseId: "paid-usd-in-month", paymentDate: "2026-10-11", amount: 4 },
          { expenseId: "pending-in-month", paymentDate: "2026-10-09", amount: 20 },
        ]}
        paymentHistoryAvailability={{ customer: true, expenses: true }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const charts = screen.getAllByRole("group", { name: /Graphique interactif des flux en/ });
    expect(charts).toHaveLength(2);
    const eurChart = charts.find((chart) => chart.closest(".dashboard-chart-series")?.querySelector("h3")?.textContent === "EUR");
    const usdChart = charts.find((chart) => chart.closest(".dashboard-chart-series")?.querySelector("h3")?.textContent === "USD");
    expect(eurChart).toBeTruthy();
    expect(usdChart).toBeTruthy();

    expect(eurChart!.querySelectorAll(".dashboard-chart-line.outflows path").length).toBeGreaterThan(0);
    expect(eurChart!.querySelectorAll(".dashboard-chart-hit-target")).toHaveLength(60);
    expect(usdChart!.querySelectorAll(".dashboard-chart-hit-target")).toHaveLength(60);
    expect(eurChart!.querySelectorAll(".dashboard-chart-point")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /Dépenses payées.*2026/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /non payé/ })).toBeNull();
  });

  it("selects the nearest line precisely, exposes its own value, and clears the tooltip on exit", () => {
    render(
      <DashboardClient
        invoices={[invoice("nearby-customer")]}
        customerPayments={[
          { invoiceId: "nearby-customer", paymentDate: "2026-10-10", amount: 10 },
        ]}
        expenses={[expense("nearby-expense", { status: "pending" })]}
        expensePayments={[
          { expenseId: "nearby-expense", paymentDate: "2026-10-10", amount: 9.5 },
        ]}
        paymentHistoryAvailability={{ customer: true, expenses: true }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    const chart = screen.getByRole("group", { name: "Graphique interactif des flux en EUR" });
    Object.defineProperty(chart, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 720, bottom: 248, width: 720, height: 248, toJSON: () => ({}) }),
    });
    const incomingPoint = [...chart.querySelectorAll<SVGCircleElement>(".dashboard-chart-line.inflows circle")]
      .find((point) => point.getAttribute("aria-label")?.includes("10,00"));
    const outgoingPoint = [...chart.querySelectorAll<SVGCircleElement>(".dashboard-chart-line.outflows circle")]
      .find((point) => point.getAttribute("aria-label")?.includes("9,50"));
    expect(incomingPoint).toBeTruthy();
    expect(outgoingPoint).toBeTruthy();

    fireEvent.pointerMove(chart, {
      clientX: Number(outgoingPoint!.getAttribute("cx")),
      clientY: Number(outgoingPoint!.getAttribute("cy")),
    });
    expect(screen.getByRole("status").textContent).toContain("Dépenses payées");
    expect(screen.getByRole("status").textContent).toContain("9,50");
    expect(chart.querySelector(".dashboard-chart-line.outflows")?.classList.contains("is-active")).toBe(true);
    expect(chart.querySelector(".dashboard-chart-crosshair")?.getAttribute("x1"))
      .toBe(outgoingPoint!.getAttribute("cx"));

    fireEvent.pointerMove(chart, {
      clientX: Number(incomingPoint!.getAttribute("cx")),
      clientY: Number(incomingPoint!.getAttribute("cy")),
    });
    expect(screen.getByRole("status").textContent).toContain("Entrées clients");
    expect(screen.getByRole("status").textContent).toContain("10,00");

    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("status")).toBeNull();
    expect(chart.querySelector(".dashboard-chart-crosshair")).toBeNull();
  });

  it("supports selecting points with the keyboard and toggling chart lines from the legend", () => {
    render(
      <DashboardClient
        invoices={[invoice("keyboard-client")]}
        customerPayments={[
          { invoiceId: "keyboard-client", paymentDate: "2026-10-10", amount: 30 },
        ]}
        expenses={[expense("keyboard-expense")]}
        expensePayments={[
          { expenseId: "keyboard-expense", paymentDate: "2026-10-10", amount: 15 },
        ]}
        paymentHistoryAvailability={{ customer: true, expenses: true }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );
    const chart = screen.getByRole("group", { name: "Graphique interactif des flux en EUR" });
    const incomingPoint = [...chart.querySelectorAll<SVGCircleElement>(".dashboard-chart-line.inflows circle")]
      .find((point) => point.getAttribute("aria-label")?.includes("30,00"));

    fireEvent.focus(incomingPoint!);
    expect(screen.getByRole("status").textContent).toContain("Entrées clients");
    expect(screen.getByRole("status").textContent).toContain("30,00");
    fireEvent.keyDown(incomingPoint!, { key: "ArrowDown" });
    expect(screen.getByRole("status").textContent).toContain("Dépenses payées");
    expect(screen.getByRole("status").textContent).toContain("15,00");

    const expenseLegend = within(document.querySelector(".dashboard-chart-legend")!)
      .getByRole("button", { name: /Dépenses payées/ });
    fireEvent.click(expenseLegend);
    expect(expenseLegend.getAttribute("aria-pressed")).toBe("false");
    expect(chart.querySelector(".dashboard-chart-line.outflows")).toBeNull();
    fireEvent.click(expenseLegend);
    expect(expenseLegend.getAttribute("aria-pressed")).toBe("true");
    expect(chart.querySelector(".dashboard-chart-line.outflows")).toBeTruthy();
  });

  it("renders currency-separated payment charts and distinguishes empty data from unavailable journals", () => {
    const { rerender } = render(
      <DashboardClient
        invoices={[]}
        expenses={[
          expense("eur", { amount: 15 }),
          expense("usd", { amount: 8, currency: "USD" }),
        ]}
        expensePayments={[
          { expenseId: "eur", paymentDate: "2026-10-10", amount: 15 },
          { expenseId: "usd", paymentDate: "2026-10-10", amount: 8 },
        ]}
        paymentHistoryAvailability={{ customer: true, expenses: true }}
        loadError={null}
        asOfDate="2026-10-11"
      />,
    );

    expect(screen.getAllByRole("group", { name: /Graphique interactif des flux en/ })).toHaveLength(2);
    expect(screen.getByText("EUR")).toBeTruthy();
    expect(screen.getByText("USD")).toBeTruthy();

    rerender(<DashboardClient
      invoices={[]}
      expenses={[]}
      paymentHistoryAvailability={{ customer: true, expenses: true }}
      loadError={null}
      asOfDate="2026-10-11"
    />);
    expect(screen.getByText(/Aucun paiement client ni paiement de dépense enregistré/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Graphique interactif des flux en/ })).toBeNull();

    rerender(<DashboardClient
      invoices={[]}
      expenses={[]}
      paymentHistoryAvailability={{ customer: false, expenses: false }}
      expensesLoadError="Erreur de chargement explicite."
      loadError={null}
      asOfDate="2026-10-11"
    />);
    expect(screen.getByRole("alert").textContent).toContain("Erreur de chargement explicite.");
    expect(screen.queryByText(/Aucun paiement client ni paiement de dépense enregistré/)).toBeNull();
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
    expect(screen.getByText(/aucune connexion bancaire ni solde initial vérifié/)).toBeTruthy();
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
