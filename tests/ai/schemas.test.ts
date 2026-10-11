import { describe, expect, it } from "vitest";
import { invoiceAnalysisSchema } from "@/lib/ai/schemas";
import type { ExtractedField, ExtractedParty, InvoiceAnalysisResult } from "@/lib/ai/types";

function field<T>(value: T | null = null, status: ExtractedField<T>["status"] = value === null ? "missing" : "present"): ExtractedField<T> {
  return { status, value };
}

function party(): ExtractedParty {
  return {
    role: field("unknown"),
    name: field("Émetteur"),
    address: field(),
    country: field(),
    email: field(),
    phone: field(),
    siren: field(),
    siret: field(),
    vatNumber: field(),
  };
}

function extraction(): InvoiceAnalysisResult {
  return {
    documentType: field("supplier_invoice"),
    referenceNumber: field("FA-2026-01"),
    issueDate: field("2026-01-10"),
    dueDate: field(),
    paymentDate: field(),
    currency: field("EUR"),
    purchaseOrderReference: field(),
    paymentTerms: field(),
    issuer: party(),
    recipient: { ...party(), name: field("Destinataire") },
    amounts: {
      subtotalHT: field(100),
      totalVAT: field(20),
      vatTreatment: field("taxable"),
      vatBreakdowns: field([{
        rate: field(20),
        taxableBase: field(100),
        amount: field(20),
      }]),
      totalTTC: field(120),
      totalDiscounts: field(),
      otherFees: field(),
      deposits: field(),
      amountPaid: field(),
      balanceDue: field(),
    },
    lines: field([{
      description: field("Prestation"),
      quantity: field(1),
      unit: field("unité"),
      unitPrice: field(100),
      discountAmount: field(0),
      discountRate: field(),
      vatRate: field(20),
      subtotalHT: field(100),
      totalTTC: field(120),
    }]),
    payment: {
      iban: field(),
      bic: field(),
      method: field(),
      reference: field(),
    },
    warnings: [],
  };
}

describe("invoiceAnalysisSchema", () => {
  it("accepts structured fields, optional source evidence and a separate manual correction", () => {
    const input = extraction();
    input.issuer.name = {
      status: "present",
      value: "Émetteur",
      source: {
        page: 1,
        excerpt: "Émetteur SARL",
        boundingBox: { x: 0.1, y: 0.1, width: 0.4, height: 0.05, coordinateSystem: "normalized" },
      },
      confidence: 0.72,
      correction: { value: "Émetteur corrigé", correctedAt: "2026-01-10T10:00:00Z" },
    };
    expect(invoiceAnalysisSchema.safeParse(input).success).toBe(true);
  });

  it.each(["present", "missing", "illegible", "uncertain"] as const)("supports the %s field status", (status) => {
    const input = extraction();
    input.referenceNumber = status === "present"
      ? field<string>("FA-2026-01", status)
      : field<string>(null, status);
    expect(invoiceAnalysisSchema.safeParse(input).success).toBe(true);
  });

  it("rejects values attached to non-present fields and invalid provenance", () => {
    const badValue = { ...extraction(), referenceNumber: { status: "missing", value: "guessed-number" } };
    expect(invoiceAnalysisSchema.safeParse(badValue).success).toBe(false);

    const badSource = extraction();
    badSource.issuer.name = {
      status: "present",
      value: "Émetteur",
      source: {
        page: 1,
        excerpt: "x".repeat(501),
        boundingBox: { x: 0.9, y: 0.1, width: 0.2, height: 0.1, coordinateSystem: "normalized" },
      },
    };
    expect(invoiceAnalysisSchema.safeParse(badSource).success).toBe(false);
  });

  it("allows a zero VAT rate and negative amounts for credit notes", () => {
    const input = extraction();
    input.documentType = field("credit_note");
    input.amounts.subtotalHT = field(-100);
    input.amounts.totalVAT = field(-20);
    input.amounts.vatTreatment = field("taxable");
    input.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(-100), amount: field(-20) }]);
    input.amounts.totalTTC = field(-120);
    input.lines = field([{
      description: field("Avoir prestation"),
      quantity: field(-1),
      unit: field("unité"),
      unitPrice: field(100),
      discountAmount: field(0),
      discountRate: field(),
      vatRate: field(20),
      subtotalHT: field(-100),
      totalTTC: field(-120),
    }]);
    expect(invoiceAnalysisSchema.safeParse(input).success).toBe(true);

    input.amounts.vatBreakdowns = field([{ rate: field(0), taxableBase: field(-100), amount: field(0) }]);
    input.amounts.totalVAT = field(0);
    input.amounts.vatTreatment = field("exempt");
    input.amounts.totalTTC = field(-100);
    input.lines = field([]);
    expect(invoiceAnalysisSchema.safeParse(input).success).toBe(true);
  });
});
