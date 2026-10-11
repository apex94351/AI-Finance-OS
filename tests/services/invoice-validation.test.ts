import { describe, expect, it } from "vitest";
import type { ExtractedField, ExtractedInvoiceLine, ExtractedParty, InvoiceAnalysisResult } from "@/lib/ai/types";
import { deriveInvoiceStatus, getEffectiveInvoiceStatus, validateInvoiceAnalysis } from "@/services/invoice-validation";

function field<T>(value: T | null = null, status: ExtractedField<T>["status"] = value === null ? "missing" : "present"): ExtractedField<T> {
  return { status, value };
}

function party(name: string): ExtractedParty {
  return {
    role: field("unknown"),
    name: field(name),
    address: field(),
    country: field(),
    email: field(),
    phone: field(),
    siren: field(),
    siret: field(),
    vatNumber: field(),
  };
}

function line(overrides: Partial<ExtractedInvoiceLine> = {}): ExtractedInvoiceLine {
  return {
    description: field("Prestation"),
    quantity: field(1),
    unit: field("unité"),
    unitPrice: field(100),
    discountAmount: field(0),
    discountRate: field(),
    vatRate: field(20),
    subtotalHT: field(100),
    totalTTC: field(120),
    ...overrides,
  };
}

function extraction(): InvoiceAnalysisResult {
  return {
    documentType: field("supplier_invoice"),
    referenceNumber: field("FA-2026-001"),
    issueDate: field("2026-01-01"),
    dueDate: field("2026-01-31"),
    paymentDate: field(),
    currency: field("EUR"),
    purchaseOrderReference: field(),
    paymentTerms: field(),
    issuer: {
      ...party("Fournisseur Exemple"),
      role: field("supplier"),
      vatNumber: field("FR12345678901"),
      siren: field("123456789"),
    },
    recipient: { ...party("Société Cliente"), role: field("customer") },
    amounts: {
      subtotalHT: field(100),
      totalVAT: field(20),
      vatTreatment: field("taxable"),
      vatBreakdowns: field([{ rate: field(20), taxableBase: field(100), amount: field(20) }]),
      totalTTC: field(120),
      totalDiscounts: field(),
      otherFees: field(),
      deposits: field(),
      amountPaid: field(),
      balanceDue: field(),
    },
    lines: field([line()]),
    payment: { iban: field(), bic: field(), method: field(), reference: field() },
    warnings: [],
  };
}

describe("invoice extraction financial validation", () => {
  it("validates a simple synthetic French invoice without declaring accounting approval", () => {
    const validation = validateInvoiceAnalysis(extraction());
    expect(validation).toMatchObject({ consistent: true, reviewRequired: true, issues: [] });
  });

  it("reconciles multiple VAT rates independently and in aggregate", () => {
    const result = extraction();
    result.amounts.subtotalHT = field(150);
    result.amounts.totalVAT = field(25);
    result.amounts.totalTTC = field(175);
    result.amounts.vatBreakdowns = field([
      { rate: field(20), taxableBase: field(100), amount: field(20) },
      { rate: field(10), taxableBase: field(50), amount: field(5) },
    ]);
    result.lines = field([
      line(),
      line({
        description: field("Livre"),
        unitPrice: field(50),
        vatRate: field(10),
        subtotalHT: field(50),
        totalTTC: field(55),
      }),
    ]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });
  });

  it("keeps a quote with no final VAT amounts reviewable and consistent", () => {
    const result = extraction();
    result.documentType = field("quote");
    result.dueDate = field();
    result.amounts.totalVAT = field();
    result.amounts.vatTreatment = field("not_applicable");
    result.amounts.vatBreakdowns = field();
    result.amounts.totalTTC = field();
    result.lines = field();

    const validation = validateInvoiceAnalysis(result);
    expect(validation.consistent).toBe(true);
    expect(validation.reviewRequired).toBe(true);
    expect(validation.warnings.join(" ")).toContain("total TTC absent");
  });

  it("accounts for a document-level discount and additional fees", () => {
    const result = extraction();
    result.amounts.totalDiscounts = field(10);
    result.amounts.otherFees = field(5);
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(95), amount: field(19) }]);
    result.amounts.totalVAT = field(19);
    result.amounts.vatTreatment = field("taxable");
    result.amounts.totalTTC = field(114);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });
  });

  it("checks a line discount expressed as a rate without fabricating its extracted amount", () => {
    const result = extraction();
    result.amounts.subtotalHT = field(90);
    result.amounts.totalVAT = field(18);
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(90), amount: field(18) }]);
    result.amounts.totalTTC = field(108);
    result.lines = field([line({
      quantity: field(2),
      unitPrice: field(50),
      discountAmount: field(),
      discountRate: field(10),
      subtotalHT: field(90),
      totalTTC: field(108),
    })]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });
  });

  it("checks the line arithmetic when the document explicitly has no discount", () => {
    const result = extraction();
    result.lines = field([line({ discountAmount: field(), discountRate: field() })]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });

    result.lines = field([line({ subtotalHT: field(99), discountAmount: field(), discountRate: field() })]);
    expect(validateInvoiceAnalysis(result).issues.map((issue) => issue.code)).toContain("line_subtotal_mismatch");
  });

  it("preserves missing, illegible and uncertain states as warnings rather than invented values", () => {
    const result = extraction();
    result.referenceNumber = field<string>(null, "missing");
    result.issuer.vatNumber = field<string>(null, "illegible");
    result.issuer.siren = field<string>(null, "uncertain");
    result.issuer.siret = field();
    result.amounts.totalTTC = field();

    const validation = validateInvoiceAnalysis(result);
    expect(validation.consistent).toBe(true);
    expect(validation.warnings.join(" ")).toContain("numéro de facture ou de devis absent");
    expect(validation.warnings.join(" ")).toContain("numéro de TVA de l'émetteur présent mais illisible");
    expect(validation.warnings.join(" ")).toContain("SIREN/SIRET de l'émetteur détecté avec incertitude");
  });

  it("accepts a one-cent VAT rounding difference", () => {
    const result = extraction();
    result.amounts.subtotalHT = field(10.05);
    result.amounts.totalVAT = field(2.02);
    result.amounts.vatTreatment = field("taxable");
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(10.05), amount: field(2.02) }]);
    result.amounts.totalTTC = field(12.07);
    result.lines = field([line({
      quantity: field(1),
      unitPrice: field(10.05),
      subtotalHT: field(10.05),
      totalTTC: field(12.07),
    })]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });
  });

  it("reports an actual discrepancy between invoice lines and document totals", () => {
    const result = extraction();
    result.lines = field([line({ totalTTC: field(130) })]);
    const validation = validateInvoiceAnalysis(result);
    expect(validation.consistent).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("line_total_mismatch");
  });

  it("reports a mismatch in the sum of line subtotals", () => {
    const result = extraction();
    result.amounts.subtotalHT = field(110);
    result.amounts.totalVAT = field(22);
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(110), amount: field(22) }]);
    result.amounts.totalTTC = field(132);

    const validation = validateInvoiceAnalysis(result);
    expect(validation.issues.map((issue) => issue.code)).toContain("lines_subtotal_mismatch");
  });

  it("checks the declared rate on each VAT breakdown", () => {
    const result = extraction();
    result.amounts.totalVAT = field(19);
    result.amounts.totalTTC = field(119);
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(100), amount: field(19) }]);

    const validation = validateInvoiceAnalysis(result);
    expect(validation.issues.map((issue) => issue.code)).toContain("vat_rate_mismatch");
  });

  it("flags tax amounts that contradict an explicit exempt or not-applicable treatment", () => {
    const result = extraction();
    result.amounts.vatTreatment = field("exempt");

    const validation = validateInvoiceAnalysis(result);
    expect(validation.issues.map((issue) => issue.code)).toContain("vat_treatment_mismatch");
  });

  it("validates negative credit-note amounts and zero-rated VAT without requiring positive tax", () => {
    const result = extraction();
    result.documentType = field("credit_note");
    result.amounts.subtotalHT = field(-100);
    result.amounts.totalVAT = field(-20);
    result.amounts.vatTreatment = field("taxable");
    result.amounts.vatBreakdowns = field([{ rate: field(20), taxableBase: field(-100), amount: field(-20) }]);
    result.amounts.totalTTC = field(-120);
    result.lines = field([line({
      quantity: field(-1),
      subtotalHT: field(-100),
      totalTTC: field(-120),
    })]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });

    result.amounts.totalVAT = field(0);
    result.amounts.vatTreatment = field("exempt");
    result.amounts.vatBreakdowns = field([{ rate: field(0), taxableBase: field(-100), amount: field(0) }]);
    result.amounts.totalTTC = field(-100);
    result.lines = field([]);
    expect(validateInvoiceAnalysis(result)).toMatchObject({ consistent: true, issues: [] });
  });

  it("derives overdue status from the due date", () => {
    expect(deriveInvoiceStatus("2026-01-01", new Date("2026-01-02T00:00:00Z"))).toBe("overdue");
    expect(deriveInvoiceStatus("2026-01-02", new Date("2026-01-02T00:00:00Z"))).toBe("pending");
    expect(deriveInvoiceStatus("2026-01-03", new Date("2026-01-02T00:00:00Z"))).toBe("pending");
    expect(deriveInvoiceStatus(null, new Date("2026-01-02T00:00:00Z"))).toBe("pending");
    expect(deriveInvoiceStatus("2026-02-30", new Date("2026-03-02T00:00:00Z"))).toBe("pending");
  });

  it("keeps paid and manually overdue invoices while recalculating legacy unpaid statuses", () => {
    const today = new Date("2026-01-02T12:00:00Z");
    expect(getEffectiveInvoiceStatus("paid", "2025-01-01", today)).toBe("paid");
    expect(getEffectiveInvoiceStatus("receivable", "2026-01-01", today)).toBe("overdue");
    expect(getEffectiveInvoiceStatus("overdue", "2026-01-03", today)).toBe("overdue");
    expect(getEffectiveInvoiceStatus("pending", null, today)).toBe("pending");
  });
});
