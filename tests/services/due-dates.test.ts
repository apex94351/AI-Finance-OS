import { describe, expect, it } from "vitest";
import {
  buildDueDateItems,
  buildDueDateSummary,
  filterDueDateItems,
  type DueDateRecord,
} from "@/services/due-dates";

const records: DueDateRecord[] = [
  {
    id: "payable-future",
    companyId: null,
    supplierId: "supplier-1",
    invoiceNumber: "SUP-001",
    clientName: "Fournisseur futur",
    dueDate: "2026-10-15",
    total: 120,
    currency: "EUR",
    status: "pending",
  },
  {
    id: "receivable-late",
    companyId: null,
    customerId: "customer-1",
    invoiceNumber: "CLI-002",
    clientName: "Client en retard",
    dueDate: "2026-10-08",
    total: 80,
    currency: "EUR",
    status: "overdue",
  },
  {
    id: "receivable",
    companyId: null,
    invoiceType: "customer",
    invoiceNumber: "CLI-003",
    clientName: "Client à encaisser",
    dueDate: "2026-10-10",
    total: 250,
    currency: "EUR",
    status: "receivable",
  },
  {
    id: "paid",
    companyId: null,
    invoiceNumber: "CLI-PAID",
    clientName: "Client réglé",
    dueDate: "2026-10-01",
    total: 100,
    currency: "EUR",
    status: "paid",
  },
  {
    id: "draft",
    companyId: null,
    invoiceNumber: null,
    clientName: "Brouillon",
    dueDate: "2026-10-09",
    total: 50,
    currency: "EUR",
    status: "draft",
  },
  {
    id: "cancelled",
    companyId: null,
    invoiceNumber: "CLI-CANCELLED",
    clientName: "Annulée",
    dueDate: "2026-10-09",
    total: 60,
    currency: "EUR",
    status: "cancelled",
  },
];

describe("due date calculations", () => {
  it("keeps only active obligations and sorts overdue items before upcoming items", () => {
    const items = buildDueDateItems(records, "2026-10-10");

    expect(items.map(({ id }) => id)).toEqual(["receivable-late", "receivable", "payable-future"]);
    expect(items.find(({ id }) => id === "payable-future")?.daysUntilDue).toBe(5);
    expect(items.find(({ id }) => id === "receivable-late")?.daysUntilDue).toBe(-2);
    expect(items.map(({ id }) => id)).not.toContain("paid");
    expect(items.map(({ id }) => id)).not.toContain("draft");
    expect(items.map(({ id }) => id)).not.toContain("cancelled");
  });

  it("uses explicit invoice direction instead of status or a free-text counterparty", () => {
    const invoices: DueDateRecord[] = [
      {
        id: "customer-without-contact",
        sourceType: "invoice",
        invoiceType: "customer",
        companyId: null,
        invoiceNumber: "CLI-004",
        clientName: "Client saisi manuellement",
        dueDate: "2026-10-15",
        total: 100,
        currency: "EUR",
        status: "pending",
      },
      {
        id: "unknown-receivable-status",
        sourceType: "invoice",
        invoiceType: null,
        companyId: null,
        invoiceNumber: "LEG-005",
        clientName: "Tiers non qualifié",
        dueDate: "2026-10-15",
        total: 50,
        currency: "EUR",
        status: "receivable",
      },
    ];

    const items = buildDueDateItems(invoices, "2026-10-10");

    expect(items.find(({ id }) => id === "customer-without-contact")?.direction).toBe("receivable");
    expect(items.find(({ id }) => id === "unknown-receivable-status")?.direction).toBe("unclassified");
    expect(filterDueDateItems(items, "receivable").map(({ id }) => id)).toEqual(["customer-without-contact"]);
    expect(buildDueDateSummary(invoices, "2026-10-10")).toMatchObject({ receivable: 100, payable: 0, unclassifiedCount: 1 });
  });

  it("uses the unpaid remainder of customer and supplier invoices", () => {
    const obligations: DueDateRecord[] = [
      {
        ...records[0]!,
        id: "partially-paid-supplier",
        invoiceType: "supplier",
        supplierId: null,
        total: 75,
        grossTotal: 100,
        paidAmount: 25,
      },
      {
        ...records[2]!,
        id: "partially-paid-customer",
        invoiceType: "customer",
        total: 60,
        grossTotal: 100,
        paidAmount: 40,
      },
    ];

    const items = buildDueDateItems(obligations, "2026-10-10");

    expect(items.find(({ id }) => id === "partially-paid-supplier"))
      .toMatchObject({ direction: "payable", total: 75 });
    expect(items.find(({ id }) => id === "partially-paid-customer"))
      .toMatchObject({ direction: "receivable", total: 60 });
    expect(buildDueDateSummary(obligations, "2026-10-10")).toMatchObject({ payable: 75, receivable: 60, forecastBalance: -15 });
  });

  it("calculates euro totals by direction and the forecast balance", () => {
    const summary = buildDueDateSummary(records, "2026-10-10");

    expect(summary).toEqual({
      receivable: 330,
      payable: 120,
      forecastBalance: 210,
      nonEuroCount: 0,
      incompleteAmountCount: 0,
      unclassifiedCount: 0,
    });
  });

  it("excludes undated obligations from totals because they are not visible in the active due-date list", () => {
    const obligations: DueDateRecord[] = [
      {
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
      },
    ];

    expect(buildDueDateItems(obligations, "2026-10-10")).toEqual([]);
    expect(buildDueDateSummary(obligations, "2026-10-10")).toMatchObject({
      receivable: 0,
      payable: 0,
      forecastBalance: 0,
    });
  });

  it("reduces a partially paid expense and omits fully settled or cancelled expenses", () => {
    const items = buildDueDateItems([
      {
        id: "partial-expense",
        sourceType: "expense",
        companyId: null,
        supplierId: "supplier-1",
        invoiceNumber: null,
        clientName: "Hébergement cloud",
        label: "Hébergement cloud",
        dueDate: "2026-10-09",
        total: 75,
        grossTotal: 100,
        paidAmount: 25,
        currency: "EUR",
        status: "pending",
      },
      {
        id: "fully-paid-expense",
        sourceType: "expense",
        companyId: null,
        supplierId: null,
        invoiceNumber: null,
        clientName: "Matériel",
        dueDate: "2026-10-08",
        total: 60,
        grossTotal: 60,
        paidAmount: 60,
        currency: "EUR",
        status: "pending",
      },
      {
        id: "cancelled-expense",
        sourceType: "expense",
        companyId: null,
        supplierId: null,
        invoiceNumber: null,
        clientName: "Annulée",
        dueDate: "2026-10-08",
        total: 80,
        grossTotal: 80,
        currency: "EUR",
        status: "cancelled",
      },
    ], "2026-10-10");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "partial-expense", total: 75, timing: "overdue", displayedStatus: "overdue" });
    expect(buildDueDateSummary(items, "2026-10-10").payable).toBe(75);
  });

  it("does not mark a paid obligation overdue, while an unpaid expired date is overdue", () => {
    const items = buildDueDateItems([
      { ...records[0]!, id: "past-due", dueDate: "2026-10-09" },
      { ...records[0]!, id: "paid-late", status: "paid", dueDate: "2026-10-01" },
      { ...records[0]!, id: "manual-overdue", status: "overdue", dueDate: "2026-10-12" },
    ], "2026-10-10");

    expect(items.map(({ id, displayedStatus }) => [id, displayedStatus])).toEqual([
      ["past-due", "overdue"],
      ["manual-overdue", "overdue"],
    ]);
  });

  it("filters exactly the payable and receivable active obligations", () => {
    const items = buildDueDateItems(records, "2026-10-10");

    expect(filterDueDateItems(items, "payable").map(({ id }) => id)).toEqual(["payable-future"]);
    expect(filterDueDateItems(items, "receivable").map(({ id }) => id)).toEqual(["receivable-late", "receivable"]);
    expect(filterDueDateItems(items, "all")).toEqual(items);
  });

  it("does not invent dates or include non-euro and malformed amounts in EUR totals", () => {
    const items = buildDueDateItems([
      { ...records[0]!, id: "invalid-date", dueDate: "2026-02-30" },
      { ...records[0]!, id: "missing-date", dueDate: null },
      { ...records[0]!, id: "foreign-currency", currency: "USD" },
      { ...records[0]!, id: "missing-amount", total: null, grossTotal: null },
    ], "2026-10-10");
    const summary = buildDueDateSummary(items, "2026-10-10");

    expect(items.map(({ id }) => id)).toEqual(["foreign-currency", "missing-amount"]);
    expect(summary.payable).toBe(0);
    expect(summary.nonEuroCount).toBe(1);
    expect(summary.incompleteAmountCount).toBe(1);
  });

  it("returns no items when the reference date is invalid", () => {
    expect(buildDueDateItems(records, "2026-02-30")).toEqual([]);
  });
});
