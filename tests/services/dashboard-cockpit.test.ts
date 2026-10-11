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

  it("uses expense date and status, excludes cancelled expenses, and keeps currencies separate", () => {
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
    const dailyBuckets = result.paidExpenseSeries[0]?.buckets ?? [];
    expect(dailyBuckets).toHaveLength(31);
    expect(dailyBuckets[0]).toEqual({ date: "2026-09-11", amount: 0 });
    expect(dailyBuckets[28]).toEqual({ date: "2026-10-09", amount: 12.5 });
    expect(dailyBuckets.at(-1)).toEqual({ date: "2026-10-11", amount: 0 });
  });

  it("groups only valid paid expenses inside the inclusive one-month range", () => {
    const range = resolveDashboardDateRange("1m", asOfDate);
    const result = buildDashboardCockpit([], [
      expense("paid-in-range-first", {
        status: "paid",
        expenseDate: "2026-09-11",
        amount: 5,
      }),
      expense("paid-in-range-eur-one", {
        status: "paid",
        expenseDate: "2026-10-10",
        amount: 12.34,
      }),
      expense("paid-in-range-eur-two", {
        status: "paid",
        expenseDate: "2026-10-10",
        amount: 7.66,
      }),
      expense("paid-in-range-usd", {
        status: "paid",
        expenseDate: "2026-10-11",
        amount: 4,
        currency: "USD",
      }),
      expense("paid-before-range", {
        status: "paid",
        expenseDate: "2026-09-10",
        amount: 90,
      }),
      expense("paid-after-range", {
        status: "paid",
        expenseDate: "2026-10-12",
        amount: 80,
      }),
      expense("pending-in-range", {
        status: "pending",
        expenseDate: "2026-10-09",
        amount: 70,
      }),
    ], range, asOfDate);

    expect(range).toEqual({
      startDate: "2026-09-11",
      endDate: "2026-10-11",
      valid: true,
    });
    expect(result.paidExpenseSeries).toEqual([
      {
        currency: "EUR",
        interval: "day",
        buckets: expect.arrayContaining([
          { date: "2026-09-11", amount: 5 },
          { date: "2026-10-10", amount: 20 },
        ]),
      },
      {
        currency: "USD",
        interval: "day",
        buckets: expect.arrayContaining([
          { date: "2026-10-11", amount: 4 },
        ]),
      },
    ]);
    expect(result.paidExpenseSeries[0]?.buckets).toHaveLength(31);
    expect(result.paidExpenseSeries[0]?.buckets.find(({ date }) => date === "2026-09-11")?.amount).toBeGreaterThan(0);
    expect(result.paidExpenseSeries[0]?.buckets.find(({ date }) => date === "2026-10-10")?.amount).toBe(20);
    expect(result.paidExpenseSeries[0]?.buckets.some(({ date }) => date === "2026-09-10" || date === "2026-10-12")).toBe(false);
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

  it("keeps chronological zero-value buckets and inclusive range boundaries for a 7-day period", () => {
    const range = resolveDashboardDateRange("7d", asOfDate);
    const result = buildDashboardCockpit([], [
      expense("first-day", { status: "paid", expenseDate: "2026-10-05", amount: 10 }),
      expense("last-day", { status: "paid", expenseDate: "2026-10-11", amount: 30 }),
      expense("before-range", { status: "paid", expenseDate: "2026-10-04", amount: 100 }),
      expense("invalid-date", { status: "paid", expenseDate: "2026-02-30", amount: 50 }),
      expense("invalid-amount", { status: "paid", amount: Number.NaN }),
      expense("invalid-currency", { status: "paid", currency: "EURO" }),
    ], range, asOfDate);

    expect(result.paidExpenseSeries).toEqual([{
      currency: "EUR",
      interval: "day",
      buckets: [
        { date: "2026-10-05", amount: 10 },
        { date: "2026-10-06", amount: 0 },
        { date: "2026-10-07", amount: 0 },
        { date: "2026-10-08", amount: 0 },
        { date: "2026-10-09", amount: 0 },
        { date: "2026-10-10", amount: 0 },
        { date: "2026-10-11", amount: 30 },
      ],
    }]);
  });

  it("creates separate, chronologically ordered monthly series for a year and each currency", () => {
    const result = buildDashboardCockpit([], [
      expense("eur-later", { status: "paid", expenseDate: "2026-10-11", amount: 20 }),
      expense("usd-earlier", { status: "paid", expenseDate: "2025-10-11", amount: 7, currency: "USD" }),
    ], resolveDashboardDateRange("1y", asOfDate), asOfDate);

    expect(result.paidExpenseSeries.map(({ currency }) => currency)).toEqual(["EUR", "USD"]);
    for (const series of result.paidExpenseSeries) {
      expect(series.interval).toBe("month");
      expect(series.buckets).toHaveLength(13);
      expect(series.buckets.map(({ date }) => date)).toEqual(
        [...series.buckets.map(({ date }) => date)].sort(),
      );
    }
    expect(result.paidExpenseSeries[0]?.buckets.at(-1)).toEqual({ date: "2026-10-01", amount: 20 });
    expect(result.paidExpenseSeries[1]?.buckets[0]).toEqual({ date: "2025-10-01", amount: 7 });
  });
});
