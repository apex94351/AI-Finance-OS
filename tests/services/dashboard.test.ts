import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "@/services/dashboard";
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
    issueDate: "2026-10-01",
    dueDate: "2026-10-30",
    subtotal: 100,
    vatRate: 0,
    vatAmount: 0,
    total: 100,
    currency: "EUR",
    status: "pending",
    category: null,
    analysis: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard summary", () => {
  it("groups payable, receivable and overdue totals by currency", () => {
    const summary = buildDashboardSummary([
      invoice("pay-eur", { total: 100, currency: "EUR" }),
      invoice("pay-usd", { total: 30, currency: "USD" }),
      invoice("receive-eur", { status: "receivable", total: 40 }),
      invoice("late-unknown", { status: "overdue", dueDate: "2026-10-09", total: 5, currency: "GBP" }),
      invoice("paid", { status: "paid", total: 900 }),
    ], "2026-10-10");

    expect(summary.payableTotals).toEqual([
      { currency: "EUR", amount: 100 },
      { currency: "USD", amount: 30 },
    ]);
    expect(summary.receivableTotals).toEqual([{ currency: "EUR", amount: 40 }]);
    expect(summary.overdueTotals).toEqual([{ currency: "GBP", amount: 5 }]);
    expect(summary.toProcessCount).toBe(4);
  });

  it("excludes paid, draft and cancelled invoices from active schedules while surfacing drafts as actions", () => {
    const summary = buildDashboardSummary([
      invoice("paid", { status: "paid", dueDate: "2026-10-01" }),
      invoice("draft", { status: "draft", dueDate: "2026-10-01" }),
      invoice("cancelled", { status: "cancelled", dueDate: "2026-10-01" }),
      invoice("future", { dueDate: "2026-10-11" }),
    ], "2026-10-10");

    expect(summary.toProcessCount).toBe(1);
    expect(summary.upcomingCount).toBe(1);
    expect(summary.upcoming.map(({ id }) => id)).toEqual(["future"]);
    expect(summary.actions.map(({ invoice: record }) => record.id)).toEqual(["future", "draft"]);
  });

  it("sorts the most overdue items before nearer and verification actions", () => {
    const summary = buildDashboardSummary([
      invoice("verify", { status: "overdue", dueDate: "2026-10-15" }),
      invoice("near", { dueDate: "2026-10-12" }),
      invoice("late-2", { dueDate: "2026-10-08" }),
      invoice("late-5", { status: "receivable", dueDate: "2026-10-05" }),
    ], "2026-10-10");

    expect(summary.actions.map(({ invoice: record }) => record.id)).toEqual(["late-5", "late-2", "near", "verify"]);
    expect(summary.actions[0]?.daysUntilDue).toBe(-5);
    expect(summary.actions.at(-1)?.kind).toBe("verify");
  });

  it("handles missing dates and currency without producing false sums", () => {
    const summary = buildDashboardSummary([
      invoice("missing-date", { dueDate: null, total: null, currency: null }),
      invoice("bad-date", { dueDate: "2026-02-30", total: 10, currency: "EUR" }),
    ], "2026-10-10");

    expect(summary.actions.map(({ kind }) => kind)).toEqual(["verify", "verify"]);
    expect(summary.payableTotals).toEqual([{ currency: "EUR", amount: 10 }]);
    expect(summary.upcoming).toEqual([]);
  });

  it("returns empty, stable summaries when there are no invoices or the reference date is invalid", () => {
    const empty = buildDashboardSummary([], "2026-10-10");
    expect(empty.toProcessCount).toBe(0);
    expect(empty.actions).toEqual([]);
    expect(buildDashboardSummary([invoice("one")], "invalid-date").actions[0]?.kind).toBe("verify");
  });

  it("surfaces drafts for follow-up without treating them as active or overdue invoices", () => {
    const summary = buildDashboardSummary([
      invoice("draft-no-date", { status: "draft", dueDate: null }),
      invoice("late", { status: "pending", dueDate: "2026-10-09" }),
      invoice("cancelled", { status: "cancelled" }),
    ], "2026-10-10");

    expect(summary.actions.map(({ invoice: record }) => record.id)).toEqual(["late", "draft-no-date"]);
    expect(summary.actions[1]?.kind).toBe("draft");
    expect(summary.actions[1]?.daysUntilDue).toBeNull();
    expect(summary.toProcessCount).toBe(1);
    expect(summary.overdueTotals).toEqual([{ currency: "EUR", amount: 100 }]);
  });
});
