import { describe, expect, it } from "vitest";
import type { InvoiceAnalysisResult } from "@/lib/ai/types";
import { deriveInvoiceStatus, validateInvoiceAnalysis } from "@/services/invoice-validation";

const baseResult: InvoiceAnalysisResult = {
  documentType: "invoice",
  invoiceNumber: "INV-001",
  issueDate: "2026-01-01",
  dueDate: "2026-01-31",
  currency: "EUR",
  supplier: { name: "Fournisseur", address: null, email: null, phone: null, siret: null, vatNumber: null },
  client: { name: "Entreprise", address: null, siret: null, vatNumber: null },
  amounts: { subtotal: 100, vat: 20, vatRate: 20, discount: null, otherFees: null, total: 120 },
  payment: { iban: null, paymentTerms: null, paymentMethod: null },
  category: null,
  summary: null,
  missingInformation: [],
  warnings: [],
  recommendedActions: [],
  confidence: 0.9,
};

describe("invoice validation", () => {
  it("accepts coherent extracted amounts and dates", () => {
    expect(validateInvoiceAnalysis(baseResult)).toMatchObject({ valid: true, issues: [] });
  });

  it("reports inconsistencies without changing extracted values", () => {
    const result = validateInvoiceAnalysis({ ...baseResult, amounts: { ...baseResult.amounts, total: 130 } });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("amount_mismatch");
  });

  it("derives overdue status from the due date", () => {
    expect(deriveInvoiceStatus("2026-01-01", new Date("2026-01-02T00:00:00Z"))).toBe("overdue");
    expect(deriveInvoiceStatus("2026-01-03", new Date("2026-01-02T00:00:00Z"))).toBe("pending");
  });
});