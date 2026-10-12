import { describe, expect, it } from "vitest";
import {
  calculateInvoiceAmounts,
  getPersistedInvoiceStatus,
  manualInvoiceSchema,
} from "@/services/manual-invoice";

const validInvoice = {
  invoiceNumber: "",
  clientName: "Client",
  invoiceType: "customer" as const,
  description: "Mission de conseil",
  subtotal: "100.00",
  vatRate: "20",
  issueDate: "2026-09-10",
  dueDate: "2026-10-10",
  status: "pending" as const,
};

describe("manual invoice validation and calculations", () => {
  it("calculates VAT and total in cents without trusting submitted totals", () => {
    expect(calculateInvoiceAmounts("125.50", "20")).toEqual({
      subtotal: 125.5,
      vatRate: 20,
      vatAmount: 25.1,
      total: 150.6,
    });
    expect(calculateInvoiceAmounts("0,05", "10")?.vatAmount).toBe(0.01);
  });

  it("accepts persisted payment states and requires an explicit invoice direction", () => {
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, vatRate: "101" }).success).toBe(false);
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "" }).success).toBe(false);
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "FAC-1" }).success).toBe(true);
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "FAC-1", status: "overdue" }).success).toBe(true);
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, status: "receivable" }).success).toBe(false);
    expect(manualInvoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "FAC-1", invoiceType: "supplier" }).success).toBe(true);
    const { invoiceType, ...invoiceWithoutDirection } = validInvoice;
    expect(invoiceType).toBe("customer");
    expect(manualInvoiceSchema.safeParse(invoiceWithoutDirection).success).toBe(false);
  });

  it("rejects due dates preceding the issue date", () => {
    const result = manualInvoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "FAC-1", issueDate: "2026-10-11", dueDate: "2026-10-10" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("ne peut pas précéder");
  });

  it("normalizes past-due unpaid invoices and recalculates the status when reopened", () => {
    const currentDate = new Date("2026-10-10T12:00:00Z");
    expect(getPersistedInvoiceStatus("pending", "2026-10-09", currentDate)).toBe("overdue");
    expect(getPersistedInvoiceStatus("pending", "2026-10-10", currentDate)).toBe("pending");
    expect(getPersistedInvoiceStatus("paid", "2026-10-09", currentDate)).toBe("paid");
    expect(getPersistedInvoiceStatus("overdue", "2026-10-11", currentDate)).toBe("overdue");
    expect(getPersistedInvoiceStatus("overdue", "2026-10-09", currentDate)).toBe("overdue");
    expect(getPersistedInvoiceStatus("receivable", null, currentDate)).toBe("pending");
    expect(getPersistedInvoiceStatus("paid", "2026-10-11", currentDate)).toBe("paid");
  });
});
