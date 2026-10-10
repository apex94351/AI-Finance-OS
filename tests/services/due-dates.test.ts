import { describe, expect, it } from "vitest";
import {
  buildDueDateItems,
  filterDueDateCompany,
  filterDueDateDirection,
  filterDueDateItems,
  filterDueDatePeriod,
  type DueDateRecord,
} from "@/services/due-dates";

const records: DueDateRecord[] = [
  {
    id: "future",
    companyId: null,
    invoiceNumber: "FAC-FUTURE",
    clientName: "Client futur",
    dueDate: "2026-10-15",
    total: 120,
    currency: "EUR",
    status: "pending",
  },
  {
    id: "late",
    companyId: null,
    invoiceNumber: "FAC-LATE",
    clientName: "Tiers en retard",
    dueDate: "2026-10-08",
    total: 80,
    currency: "USD",
    status: "overdue",
  },
  {
    id: "receivable",
    companyId: null,
    invoiceNumber: "FAC-REC",
    clientName: "Client à encaisser",
    dueDate: "2026-10-10",
    total: 250,
    currency: "EUR",
    status: "receivable",
  },
  {
    id: "paid",
    companyId: null,
    invoiceNumber: "FAC-PAID",
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
    invoiceNumber: "FAC-CANCELLED",
    clientName: "Annulée",
    dueDate: "2026-10-09",
    total: 60,
    currency: "EUR",
    status: "cancelled",
  },
];

describe("due date calculations", () => {
  it("calculates future, overdue and due-today dates as calendar days without timezone drift", () => {
    const items = buildDueDateItems(records, "2026-10-10");

    expect(items.find(({ id }) => id === "future")?.daysUntilDue).toBe(5);
    expect(items.find(({ id }) => id === "late")?.daysUntilDue).toBe(-2);
    expect(items.find(({ id }) => id === "receivable")?.daysUntilDue).toBe(0);
  });

  it("excludes drafts and cancelled invoices and keeps settled amounts out of active due filters", () => {
    const items = buildDueDateItems(records, "2026-10-10");

    expect(items.map(({ id }) => id)).not.toContain("draft");
    expect(items.map(({ id }) => id)).not.toContain("cancelled");
    expect(filterDueDateItems(items, "upcoming").map(({ id }) => id)).toEqual(["receivable", "future"]);
    expect(filterDueDateItems(items, "overdue").map(({ id }) => id)).toEqual(["late"]);
    expect(filterDueDateItems(items, "paid").map(({ id }) => id)).toEqual(["paid"]);
  });

  it("preserves payable and receivable directions from their explicit statuses", () => {
    const items = buildDueDateItems(records, "2026-10-10");

    expect(items.find(({ id }) => id === "future")?.direction).toBe("payable");
    expect(items.find(({ id }) => id === "receivable")?.direction).toBe("receivable");
    expect(items.find(({ id }) => id === "paid")?.direction).toBe("settled");
    expect(items.find(({ id }) => id === "late")?.direction).toBe("unknown");
  });

  it("ignores malformed dates rather than producing misleading countdowns", () => {
    expect(buildDueDateItems(records, "2026-02-30")).toEqual([]);
  });

  it("supports period, direction and owner filters without mixing currencies", () => {
    const scopedRecords = [
      ...records,
      { ...records[0]!, id: "later", companyId: "company-1", dueDate: "2026-11-20", status: "pending" as const },
      { ...records[0]!, id: "company-receivable", companyId: "company-1", dueDate: "2026-10-12", status: "receivable" as const },
    ];
    const items = buildDueDateItems(scopedRecords, "2026-10-10");

    expect(filterDueDatePeriod(items, "next7").map(({ id }) => id)).toEqual(["receivable", "company-receivable", "future"]);
    expect(filterDueDatePeriod(items, "next30").map(({ id }) => id)).toEqual(["receivable", "company-receivable", "future"]);
    expect(filterDueDatePeriod(items, "later").map(({ id }) => id)).toEqual(["later"]);
    expect(filterDueDateDirection(items, "receivable").map(({ id }) => id)).toEqual(["receivable", "company-receivable"]);
    expect(filterDueDateCompany(items, "personal").every(({ companyId }) => companyId === null)).toBe(true);
    expect(filterDueDateCompany(items, "company-1").map(({ id }) => id)).toEqual(["company-receivable", "later"]);
  });

  it("does not invent dates and keeps missing amounts and currencies as partial records", () => {
    const incomplete: DueDateRecord = {
      ...records[0]!,
      id: "incomplete",
      dueDate: null,
      total: null,
      currency: null,
    };
    expect(buildDueDateItems([incomplete], "2026-10-10")).toEqual([]);
    expect(buildDueDateItems([{ ...incomplete, dueDate: "2026-10-11" }], "2026-10-10")[0]).toMatchObject({
      total: null,
      currency: null,
      timing: "soon",
    });
  });
});
