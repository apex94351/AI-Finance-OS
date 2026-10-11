import { describe, expect, it } from "vitest";
import { buildInvoiceOverview } from "@/services/invoice-overview";
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
    clientName: "Client",
    description: "Prestation",
    issueDate: "2026-10-01",
    dueDate: "2026-10-10",
    subtotal: 100,
    vatRate: 20,
    vatAmount: 20,
    total: 120,
    currency: "EUR",
    status: "receivable",
    category: null,
    analysis: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("invoice overview", () => {
  it("returns empty totals and counts without invoices", () => {
    expect(buildInvoiceOverview([], "2026-10-11")).toEqual({
      customers: {
        issued: [],
        paid: [],
        outstanding: [],
        overdue: [],
        outstandingCount: 0,
        overdueCount: 0,
        incompleteAmountCount: 0,
      },
      suppliers: {
        issued: [],
        paid: [],
        outstanding: [],
        overdue: [],
        outstandingCount: 0,
        overdueCount: 0,
        incompleteAmountCount: 0,
      },
      overdueCount: 0,
      overdue: [],
      net: [],
      unclassifiedCount: 0,
    });
  });

  it("calculates customer and supplier summaries, overdue counts, and net totals without cross-currency addition", () => {
    const result = buildInvoiceOverview([
      invoice("customer-open", { total: 100 }),
      invoice("customer-open-not-late", { total: 80, dueDate: "2026-10-11" }),
      invoice("customer-paid", { status: "paid", total: 50 }),
      invoice("customer-paid-late", { status: "paid", total: 30 }),
      invoice("customer-cancelled", { status: "cancelled", total: 25 }),
      invoice("customer-draft", { status: "draft", total: 70 }),
      invoice("supplier-open", {
        customerId: null,
        supplierId: "supplier",
        clientName: "Fournisseur",
        status: "pending",
        total: 40,
      }),
      invoice("supplier-usd", {
        customerId: null,
        supplierId: "supplier",
        clientName: "Fournisseur",
        status: "pending",
        total: 20,
        currency: "USD",
      }),
      invoice("settled-supplier", {
        customerId: null,
        supplierId: "supplier",
        clientName: "Fournisseur",
        status: "paid",
        total: 90,
      }),
    ], "2026-10-11");

    expect(result.customers).toEqual({
      issued: [{ currency: "EUR", amount: 260 }],
      paid: [{ currency: "EUR", amount: 80 }],
      outstanding: [{ currency: "EUR", amount: 180 }],
      overdue: [{ currency: "EUR", amount: 100 }],
      outstandingCount: 2,
      overdueCount: 1,
      incompleteAmountCount: 0,
    });
    expect(result.suppliers).toEqual({
      issued: [
        { currency: "EUR", amount: 130 },
        { currency: "USD", amount: 20 },
      ],
      paid: [{ currency: "EUR", amount: 90 }],
      outstanding: [
        { currency: "EUR", amount: 40 },
        { currency: "USD", amount: 20 },
      ],
      overdue: [
        { currency: "EUR", amount: 40 },
        { currency: "USD", amount: 20 },
      ],
      outstandingCount: 2,
      overdueCount: 2,
      incompleteAmountCount: 0,
    });
    expect(result.overdueCount).toBe(3);
    expect(result.overdue).toEqual([
      { currency: "EUR", amount: 140 },
      { currency: "USD", amount: 20 },
    ]);
    expect(result.net).toEqual([
      { currency: "EUR", amount: 130 },
      { currency: "USD", amount: -20 },
    ]);
    expect(result.unclassifiedCount).toBe(0);
  });

  it("uses company currency when an invoice row has no currency and flags values it cannot total", () => {
    const result = buildInvoiceOverview([
      invoice("company-currency", {
        companyId: "company",
        currency: null,
        total: 12,
      }),
      invoice("missing-money", { total: null, currency: null }),
      invoice("invalid-currency", { currency: "EURO" }),
      invoice("missing-party", { customerId: null, clientName: null, supplierId: null }),
    ], "2026-10-11", new Map([["company", "CHF"]]));

    expect(result.customers.outstanding).toEqual([
      { currency: "CHF", amount: 12 },
    ]);
    expect(result.customers.outstandingCount).toBe(3);
    expect(result.customers.incompleteAmountCount).toBe(2);
    expect(result.customers.overdueCount).toBe(3);
    expect(result.customers.overdue).toEqual([
      { currency: "CHF", amount: 12 },
    ]);
    expect(result.unclassifiedCount).toBe(1);
  });

  it("does not count invalid dates as overdue", () => {
    const result = buildInvoiceOverview([
      invoice("invalid-due-date", { dueDate: "2026-02-30" }),
    ], "2026-10-11");

    expect(result.customers.outstanding).toEqual([{ currency: "EUR", amount: 120 }]);
    expect(result.customers.overdueCount).toBe(0);
    expect(result.customers.overdue).toEqual([]);
  });

  it("includes paid invoices in net totals while excluding them from outstanding totals", () => {
    const result = buildInvoiceOverview([
      invoice("paid-customer", { status: "paid", total: 120 }),
      invoice("paid-supplier", {
        customerId: null,
        supplierId: "supplier",
        clientName: "Fournisseur",
        status: "paid",
        total: 45,
      }),
      invoice("open-customer", { status: "pending", total: 80 }),
    ], "2026-10-11");

    expect(result.net).toEqual([{ currency: "EUR", amount: 155 }]);
    expect(result.customers.outstanding).toEqual([{ currency: "EUR", amount: 80 }]);
    expect(result.suppliers.outstanding).toEqual([]);
  });

  it("filters summaries by issue month and year but keeps invoices without issue dates in history", () => {
    const source = [
      invoice("this-month", { issueDate: "2026-10-02", status: "paid" }),
      invoice("other-month", { issueDate: "2026-09-30" }),
      invoice("other-year", { issueDate: "2025-12-31" }),
      invoice("unknown-date", { issueDate: null }),
    ];

    expect(buildInvoiceOverview(source, "2026-10-11", new Map(), "month").customers.issued)
      .toEqual([{ currency: "EUR", amount: 120 }]);
    expect(buildInvoiceOverview(source, "2026-10-11", new Map(), "year").customers.issued)
      .toEqual([{ currency: "EUR", amount: 240 }]);
    expect(buildInvoiceOverview(source, "2026-10-11", new Map(), "all").customers.issued)
      .toEqual([{ currency: "EUR", amount: 480 }]);
  });

  it("normalizes historical open statuses and excludes drafts and cancelled invoices", () => {
    const result = buildInvoiceOverview([
      invoice("historical-receivable", { status: "receivable", dueDate: "2026-10-10" }),
      invoice("historical-overdue-future", { status: "overdue", dueDate: "2026-10-12" }),
      invoice("historical-draft", { status: "draft" }),
      invoice("cancelled", { status: "cancelled" }),
    ], "2026-10-11");

    expect(result.customers.outstanding).toEqual([{ currency: "EUR", amount: 240 }]);
    expect(result.customers.overdue).toEqual([{ currency: "EUR", amount: 120 }]);
    expect(result.net).toEqual([{ currency: "EUR", amount: 240 }]);
  });
});
