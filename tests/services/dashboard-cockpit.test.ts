import { describe, expect, it } from "vitest";
import { buildDashboardCockpit, resolveDashboardDateRange } from "@/services/dashboard";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceRecord } from "@/types/invoice";

function invoice(id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id,
    userId: "user",
    companyId: null,
    customerId: "customer",
    supplierId: null,
    documentId: null,
    invoiceNumber: `INV-${id}`,
    clientName: "Client synthétique",
    description: "Service fictif",
    issueDate: "2026-10-05",
    dueDate: "2026-10-15",
    subtotal: 100,
    vatRate: 20,
    vatAmount: 20,
    total: 120,
    currency: "EUR",
    status: "receivable",
    category: null,
    analysis: null,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

function expense(id: string, overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id,
    userId: "user",
    companyId: null,
    label: `Dépense ${id}`,
    amount: 25,
    currency: "EUR",
    expenseDate: "2026-10-09",
    category: null,
    supplierId: null,
    supplierName: null,
    status: "pending",
    notes: null,
    createdAt: "2026-10-09T00:00:00Z",
    updatedAt: "2026-10-09T00:00:00Z",
    ...overrides,
  };
}

describe("financial dashboard cockpit", () => {
  const asOfDate = "2026-10-11";

  it("uses active invoice statuses for outstanding balances and excludes fully paid or cancelled obligations", () => {
    const result = buildDashboardCockpit([
      invoice("customer-open", { total: 120 }),
      invoice("customer-paid", { status: "paid", total: 60 }),
      invoice("customer-cancelled", { status: "cancelled", total: 70 }),
      invoice("supplier-open", { customerId: null, supplierId: "supplier", status: "pending", total: 80 }),
      invoice("supplier-paid", { customerId: null, supplierId: "supplier", status: "paid", total: 90 }),
    ], [], resolveDashboardDateRange("1m", asOfDate), asOfDate);

    expect(result.receivableTotals).toEqual([{ currency: "EUR", amount: 120 }]);
    expect(result.payableTotals).toEqual([{ currency: "EUR", amount: 80 }]);
  });

  it("includes partial-payable status totals only as full outstanding amounts because no partial amount is stored", () => {
    const result = buildDashboardCockpit([
      invoice("status-overdue", { status: "overdue", dueDate: "2026-10-10", total: 120 }),
      invoice("status-pending", { status: "pending", dueDate: "2026-10-10", total: 30 }),
    ], [], resolveDashboardDateRange("1m", asOfDate), asOfDate);

    expect(result.receivableTotals).toEqual([{ currency: "EUR", amount: 150 }]);
    expect(result.overdueCustomerInvoices.map(({ id }) => id)).toEqual(["status-overdue", "status-pending"]);
  });

  it("calculates customer invoices issued in the selected period separately from open balances", () => {
    const result = buildDashboardCockpit([
      invoice("period-invoice", { issueDate: "2026-09-15", total: 120, status: "paid" }),
      invoice("outside-invoice", { issueDate: "2026-08-01", total: 40 }),
      invoice("draft", { issueDate: "2026-10-01", status: "draft", total: 90 }),
    ], [], resolveDashboardDateRange("1m", asOfDate), asOfDate);

    expect(result.invoicedTotals).toEqual([{ currency: "EUR", amount: 120 }]);
    expect(result.receivableTotals).toEqual([{ currency: "EUR", amount: 40 }]);
  });

  it("keeps recorded expense totals separate from cash movements and excludes cancelled expenses", () => {
    const result = buildDashboardCockpit([], [
      expense("paid-eur", { status: "paid", amount: 12.5 }),
      expense("pending-usd", { currency: "USD", amount: 20 }),
      expense("cancelled", { status: "cancelled", amount: 100 }),
      expense("older", { expenseDate: "2026-08-01", status: "paid", amount: 45 }),
    ], resolveDashboardDateRange("1m", asOfDate), asOfDate);

    expect(result.expenseTotals).toEqual([
      { currency: "EUR", amount: 12.5 },
      { currency: "USD", amount: 20 },
    ]);
    expect(result.cashflowSeries).toEqual([]);
  });

  it("plots only dated client receipts and expense payments, without counting linked supplier invoices twice", () => {
    const range = resolveDashboardDateRange("1m", asOfDate);
    const result = buildDashboardCockpit(
      [
        invoice("customer-open"),
        invoice("customer-legacy-paid", { status: "paid" }),
        invoice("supplier-invoice", { invoiceType: "supplier", customerId: null, supplierId: "supplier", status: "paid" }),
        invoice("cancelled-customer", { status: "cancelled" }),
      ],
      [
        expense("linked-supplier-payment", { status: "paid", invoiceId: "supplier-invoice" }),
        expense("pending-partial", { status: "pending" }),
        expense("paid-without-date", { status: "paid" }),
        expense("cancelled-payment", { status: "cancelled" }),
      ],
      range,
      asOfDate,
      [
        { invoiceId: "customer-open", paymentDate: "2026-09-15", amount: 25 },
        { invoiceId: "supplier-invoice", paymentDate: "2026-10-10", amount: 90 },
        { invoiceId: "cancelled-customer", paymentDate: "2026-10-10", amount: 80 },
      ],
      [
        { expenseId: "linked-supplier-payment", paymentDate: "2026-10-10", amount: 35 },
        { expenseId: "pending-partial", paymentDate: "2026-10-09", amount: 12.34 },
        { expenseId: "pending-partial", paymentDate: "2026-10-09", amount: 7.66 },
        { expenseId: "cancelled-payment", paymentDate: "2026-10-10", amount: 88 },
      ],
    );

    expect(range).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-10-11",
      valid: true,
    });
    expect(result.customerPaymentTotals).toEqual([{ currency: "EUR", amount: 25 }]);
    expect(result.expensePaymentTotals).toEqual([{ currency: "EUR", amount: 55 }]);
    expect(result.cashflowSeries).toHaveLength(1);
    expect(result.cashflowSeries[0]?.buckets).toHaveLength(30);
    expect(result.cashflowSeries[0]?.buckets.find(({ date }) => date === "2026-09-15")?.inflows).toBe(25);
    expect(result.cashflowSeries[0]?.buckets.find(({ date }) => date === "2026-10-10")?.inflows).toBe(0);
    expect(result.cashflowSeries[0]?.buckets.find(({ date }) => date === "2026-10-09")?.outflows).toBe(20);
    expect(result.cashflowSeries[0]?.buckets.find(({ date }) => date === "2026-10-10")?.outflows).toBe(35);
    expect(result.cashflowSeries[0]?.buckets.some(({ date }) => date === "2026-09-11" || date === "2026-10-12")).toBe(false);
  });

  it("returns overdue customer invoices and sorted upcoming supplier and mixed due items without settled invoices", () => {
    const result = buildDashboardCockpit([
      invoice("late-customer", { dueDate: "2026-10-10" }),
      invoice("near-customer", { dueDate: "2026-10-12" }),
      invoice("near-supplier", { customerId: null, supplierId: "supplier", status: "pending", dueDate: "2026-10-11" }),
      invoice("far-supplier", { customerId: null, supplierId: "supplier", status: "pending", dueDate: "2026-11-20" }),
      invoice("paid-customer", { status: "paid", dueDate: "2026-10-11" }),
    ], [], resolveDashboardDateRange("1m", asOfDate), asOfDate);

    expect(result.overdueCustomerInvoices.map(({ id }) => id)).toEqual(["late-customer"]);
    expect(result.upcomingSupplierInvoices.map(({ id }) => id)).toEqual(["near-supplier"]);
    expect(result.upcomingInvoices.map(({ id }) => id)).toEqual(["near-supplier", "near-customer"]);
  });

  it("resolves rolling periods and validates custom ranges", () => {
    expect(resolveDashboardDateRange("7d", asOfDate)).toEqual({
      startDate: "2026-10-05",
      endDate: asOfDate,
      valid: true,
    });
    expect(resolveDashboardDateRange("6m", asOfDate).startDate).toBe("2026-04-11");
    expect(resolveDashboardDateRange("custom", asOfDate, "2026-10-01", "2026-10-10").valid).toBe(true);
    expect(resolveDashboardDateRange("custom", asOfDate, "2026-10-10", "2026-10-01").valid).toBe(false);
  });

  it("aggregates recorded payment amounts into chronological 7-day buckets and excludes out-of-range dates", () => {
    const range = resolveDashboardDateRange("7d", asOfDate);
    const result = buildDashboardCockpit([], [
      expense("first-day", { status: "paid", expenseDate: "2026-10-05", amount: 10 }),
      expense("last-day", { status: "paid", expenseDate: "2026-10-11", amount: 30 }),
      expense("before-range", { status: "paid", expenseDate: "2026-10-04", amount: 100 }),
      expense("invalid-date", { status: "paid", expenseDate: "2026-02-30", amount: 50 }),
      expense("invalid-amount", { status: "paid", amount: Number.NaN }),
      expense("invalid-currency", { status: "paid", currency: "EURO" }),
    ], range, asOfDate, [], [
      { expenseId: "first-day", paymentDate: "2026-10-05", amount: 10 },
      { expenseId: "last-day", paymentDate: "2026-10-11", amount: 30 },
      { expenseId: "before-range", paymentDate: "2026-10-04", amount: 100 },
      { expenseId: "invalid-date", paymentDate: "2026-02-30", amount: 50 },
      { expenseId: "invalid-amount", paymentDate: "2026-10-08", amount: Number.NaN },
      { expenseId: "invalid-currency", paymentDate: "2026-10-08", amount: 20 },
    ]);

    expect(result.cashflowSeries).toEqual([{
      currency: "EUR",
      interval: "day",
      buckets: [
        { date: "2026-10-05", inflows: 0, outflows: 10 },
        { date: "2026-10-06", inflows: 0, outflows: 0 },
        { date: "2026-10-07", inflows: 0, outflows: 0 },
        { date: "2026-10-08", inflows: 0, outflows: 0 },
        { date: "2026-10-09", inflows: 0, outflows: 0 },
        { date: "2026-10-10", inflows: 0, outflows: 0 },
        { date: "2026-10-11", inflows: 0, outflows: 30 },
      ],
    }]);
  });

  it("creates chronologically ordered currency-separated flow series for a year", () => {
    const result = buildDashboardCockpit([], [
      expense("eur-later", { status: "paid", expenseDate: "2026-10-11", amount: 20 }),
      expense("usd-earlier", { status: "paid", expenseDate: "2025-10-11", amount: 7, currency: "USD" }),
    ], resolveDashboardDateRange("1y", asOfDate), asOfDate, [], [
      { expenseId: "eur-later", paymentDate: "2026-10-11", amount: 20 },
      { expenseId: "usd-earlier", paymentDate: "2025-10-11", amount: 7 },
    ]);

    expect(result.cashflowSeries.map(({ currency }) => currency)).toEqual(["EUR", "USD"]);
    for (const series of result.cashflowSeries) {
      expect(series.interval).toBe("month");
      expect(series.buckets).toHaveLength(13);
      expect(series.buckets.map(({ date }) => date)).toEqual(
        [...series.buckets.map(({ date }) => date)].sort(),
      );
    }
    expect(result.cashflowSeries[0]?.buckets.at(-1)).toEqual({ date: "2026-10-01", inflows: 0, outflows: 20 });
    expect(result.cashflowSeries[1]?.buckets[0]).toEqual({ date: "2025-10-01", inflows: 0, outflows: 7 });
  });

  it("keeps payment history unavailable as a gap instead of inventing zero values", () => {
    const result = buildDashboardCockpit(
      [invoice("client")],
      [expense("expense")],
      resolveDashboardDateRange("7d", asOfDate),
      asOfDate,
      [{ invoiceId: "client", paymentDate: "2026-10-10", amount: 15 }],
      [{ expenseId: "expense", paymentDate: "2026-10-10", amount: 8 }],
      { customer: false, expenses: true },
    );

    expect(result.cashflowSeries[0]?.buckets.find(({ date }) => date === "2026-10-10")).toEqual({
      date: "2026-10-10",
      inflows: null,
      outflows: 8,
    });
  });
});
