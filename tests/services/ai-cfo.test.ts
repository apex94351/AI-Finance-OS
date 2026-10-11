import { describe, expect, it } from "vitest";
import { buildCFOAnalysis, filterCFOData } from "@/services/ai-cfo";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceRecord } from "@/types/invoice";

function invoice(id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id,
    userId: null,
    companyId: null,
    documentId: null,
    invoiceNumber: `FAC-${id}`,
    clientName: "Client",
    description: "Prestation",
    issueDate: "2026-01-01",
    dueDate: "2026-01-10",
    subtotal: 100,
    vatRate: 0,
    vatAmount: 0,
    total: 100,
    currency: "EUR",
    status: "pending",
    category: null,
    analysis: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expense(id: string, overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id,
    userId: null,
    companyId: null,
    label: "Loyer",
    amount: 25,
    currency: "EUR",
    expenseDate: "2026-01-01",
    category: "Frais fixes",
    supplierId: null,
    supplierName: null,
    status: "pending",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AI CFO deterministic analysis", () => {
  it("identifies overdue and seven-day invoices while excluding paid, draft, and cancelled items", () => {
    const analysis = buildCFOAnalysis([
      invoice("late", { dueDate: "2026-01-09" }),
      invoice("today", { dueDate: "2026-01-10" }),
      invoice("within-week", { dueDate: "2026-01-17" }),
      invoice("outside-window", { dueDate: "2026-01-18" }),
      invoice("paid", { status: "paid", dueDate: "2026-01-01" }),
      invoice("draft", { status: "draft", dueDate: "2026-01-01" }),
      invoice("cancelled", { status: "cancelled", dueDate: "2026-01-01" }),
    ], [], "2026-01-10");

    expect(analysis.overdue.map(({ invoice: item }) => item.id)).toEqual(["late"]);
    expect(analysis.upcoming.map(({ invoice: item }) => item.id)).toEqual(["today", "within-week"]);
    expect(analysis.unpaidCount).toBe(4);
    expect(analysis.paidCount).toBe(1);
    expect(analysis.recommendations.some(({ id }) => id === "draft")).toBe(true);
    expect(analysis.recommendations.some(({ id }) => ["paid", "cancelled"].includes(id))).toBe(false);
    expect(analysis.recommendations.find(({ id }) => id === "late")?.priority).toBe("urgent");
  });

  it("keeps payable, receivable, overdue, paid, and expense totals separated by currency", () => {
    const analysis = buildCFOAnalysis([
      invoice("eur-payable", { supplierId: "supplier", total: 10, currency: "EUR" }),
      invoice("usd-payable", { supplierId: "supplier", total: 20, currency: "USD" }),
      invoice("receivable", { customerId: "customer", status: "receivable", total: 30, currency: "EUR" }),
      invoice("late", { supplierId: "supplier", status: "overdue", total: 40, currency: "GBP", dueDate: "2026-01-01" }),
      invoice("paid", { status: "paid", total: 50, currency: "USD" }),
    ], [
      expense("expense-eur", { amount: 5 }),
      expense("expense-usd", { amount: 7, currency: "USD", status: "paid" }),
      expense("expense-cancelled", { amount: 1000, status: "cancelled" }),
    ], "2026-01-10");

    expect(analysis.pendingTotals).toEqual([
      { currency: "EUR", amount: 10 },
      { currency: "GBP", amount: 40 },
      { currency: "USD", amount: 20 },
    ]);
    expect(analysis.receivableTotals).toEqual([{ currency: "EUR", amount: 30 }]);
    expect(analysis.overdueTotals).toEqual([{ currency: "GBP", amount: 40 }]);
    expect(analysis.paidTotals).toEqual([{ currency: "USD", amount: 50 }]);
    expect(analysis.expenseSummaries).toEqual([
      { currency: "EUR", total: 5, pending: 5, paid: 0 },
      { currency: "USD", total: 7, pending: 0, paid: 7 },
    ]);
  });

  it("handles empty and incomplete data without creating totals or recommendations", () => {
    const empty = buildCFOAnalysis([], [], "2026-01-10");
    expect(empty.recommendations).toEqual([]);
    expect(empty.expenseSummaries).toEqual([]);

    const incomplete = buildCFOAnalysis([
      invoice("missing", { dueDate: null, total: null, currency: null }),
    ], [], "2026-01-10");
    expect(incomplete.pendingTotals).toEqual([]);
    expect(incomplete.recommendations).toHaveLength(1);
    expect(incomplete.recommendations[0]?.priority).toBe("review");
    expect(incomplete.recommendations[0]?.evidence).toContain("échéance absente ou invalide");
  });

  it("provides explicit priority evidence and scopes records to the selected workspace", () => {
    const analysis = buildCFOAnalysis([
      invoice("soon", { dueDate: "2026-01-12", status: "receivable" }),
      invoice("draft", { dueDate: null, status: "draft" }),
    ], [], "2026-01-10");
    expect(analysis.recommendations.map(({ priority }) => priority)).toEqual(["soon", "routine"]);
    expect(analysis.recommendations[0]?.evidence).toContain("FAC-soon");
    expect(analysis.recommendations[0]?.explanation).toContain("sept prochains jours");

    const records = [
      { companyId: null, id: "personal" },
      { companyId: "company-a", id: "a" },
      { companyId: "company-b", id: "b" },
    ];
    expect(filterCFOData(records, "personal").map(({ id }) => id)).toEqual(["personal"]);
    expect(filterCFOData(records, "company-a").map(({ id }) => id)).toEqual(["a"]);
    expect(filterCFOData(records, "all")).toHaveLength(3);
  });
});
