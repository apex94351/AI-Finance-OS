import { describe, expect, it } from "vitest";
import { invoiceAnalysisSchema } from "@/lib/ai/schemas";

describe("invoiceAnalysisSchema", () => {
  it("accepts missing financial information as null", () => {
    const result = invoiceAnalysisSchema.safeParse({
      documentType: "invoice",
      invoiceNumber: null,
      issueDate: null,
      dueDate: null,
      currency: "EUR",
      supplier: { name: "Acme", address: null, email: null, phone: null, siret: null, vatNumber: null },
      client: { name: null, address: null, siret: null, vatNumber: null },
      amounts: { subtotal: null, vat: null, vatRate: null, discount: null, otherFees: null, total: null },
      payment: { iban: null, paymentTerms: null, paymentMethod: null },
      category: null,
      summary: null,
      missingInformation: ["due_date"],
      warnings: [],
      recommendedActions: [],
      confidence: 0.2,
    });

    expect(result.success).toBe(true);
  });
});
