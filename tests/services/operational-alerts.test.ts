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

describe("operational alerts", () => {
  it("creates one prioritized alert per real invoice issue and ignores settled or cancelled items", () => {
    const summary = buildDashboardSummary([
      invoice("late", { dueDate: "2026-10-09" }),
      invoice("soon", { dueDate: "2026-10-17" }),
      invoice("draft", { status: "draft", dueDate: null }),
      invoice("missing-date", { dueDate: null }),
      invoice("paid", { status: "paid", dueDate: "2026-10-09" }),
      invoice("cancelled", { status: "cancelled", dueDate: "2026-10-09" }),
    ], "2026-10-10");

    expect(summary.alerts.map(({ invoice: record, kind }) => [record.id, kind])).toEqual([
      ["late", "overdue"],
      ["soon", "upcoming"],
      ["missing-date", "verify"],
      ["draft", "draft"],
    ]);
    expect(new Set(summary.alerts.map(({ invoice: record }) => record.id)).size).toBe(summary.alerts.length);
  });

  it("retains all alerts for the alerts page while the dashboard action list stays compact", () => {
    const summary = buildDashboardSummary(
      Array.from({ length: 9 }, (_, index) => invoice(`draft-${index}`, { status: "draft", dueDate: null })),
      "2026-10-10",
    );

    expect(summary.actions).toHaveLength(6);
    expect(summary.alerts).toHaveLength(9);
  });
});
