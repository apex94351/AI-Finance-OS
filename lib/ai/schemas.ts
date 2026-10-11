import { z } from "zod";

const nonBlankText = z.string().trim().min(1);
export const extractionBoundingBoxSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  coordinateSystem: z.enum(["normalized", "page_pixels"]),
}).superRefine((box, context) => {
  if (box.coordinateSystem === "normalized" && (box.x + box.width > 1 || box.y + box.height > 1)) {
    context.addIssue({ code: "custom", message: "Les coordonnées normalisées doivent rester dans la page." });
  }
});

export const extractionSourceSchema = z.object({
  page: z.number().int().positive().nullable(),
  excerpt: z.string().trim().max(500).nullable(),
  boundingBox: extractionBoundingBoxSchema.nullable(),
});

export const INVOICE_ANALYSIS_SCHEMA_VERSION = "1.1";

export function extractedFieldSchema<T extends z.ZodType>(valueSchema: T) {
  const common = {
    source: extractionSourceSchema.nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    correction: z.object({
      value: valueSchema.nullable(),
      correctedAt: z.iso.datetime().nullable().optional(),
    }).nullable().optional(),
  };

  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("present"), value: valueSchema, ...common }),
    z.object({ status: z.literal("missing"), value: z.null(), ...common }),
    z.object({ status: z.literal("illegible"), value: z.null(), ...common }),
    z.object({ status: z.literal("uncertain"), value: z.null(), ...common }),
  ]);
}

const moneySchema = z.number().finite();
const rateSchema = z.number().finite().min(0).max(100);
const partySchema = z.object({
  role: extractedFieldSchema(z.enum(["supplier", "customer", "other", "unknown"])),
  name: extractedFieldSchema(nonBlankText),
  address: extractedFieldSchema(nonBlankText),
  country: extractedFieldSchema(nonBlankText),
  email: extractedFieldSchema(z.email()),
  phone: extractedFieldSchema(nonBlankText),
  siren: extractedFieldSchema(nonBlankText),
  siret: extractedFieldSchema(nonBlankText),
  vatNumber: extractedFieldSchema(nonBlankText),
});

const invoiceLineSchema = z.object({
  description: extractedFieldSchema(nonBlankText),
  quantity: extractedFieldSchema(moneySchema),
  unit: extractedFieldSchema(nonBlankText),
  unitPrice: extractedFieldSchema(moneySchema),
  discountAmount: extractedFieldSchema(moneySchema),
  discountRate: extractedFieldSchema(rateSchema),
  vatRate: extractedFieldSchema(rateSchema),
  subtotalHT: extractedFieldSchema(moneySchema),
  totalTTC: extractedFieldSchema(moneySchema),
});

const vatBreakdownSchema = z.object({
  rate: extractedFieldSchema(rateSchema),
  taxableBase: extractedFieldSchema(moneySchema),
  amount: extractedFieldSchema(moneySchema),
});

export const invoiceAnalysisSchema = z.object({
  documentType: extractedFieldSchema(z.enum([
    "invoice",
    "credit_note",
    "supplier_invoice",
    "customer_invoice",
    "quote",
    "receipt",
    "supporting_document",
    "other",
    "unknown",
  ])),
  referenceNumber: extractedFieldSchema(nonBlankText),
  issueDate: extractedFieldSchema(nonBlankText),
  dueDate: extractedFieldSchema(nonBlankText),
  paymentDate: extractedFieldSchema(nonBlankText),
  currency: extractedFieldSchema(z.string().trim().regex(/^[A-Z]{3}$/)),
  purchaseOrderReference: extractedFieldSchema(nonBlankText),
  paymentTerms: extractedFieldSchema(nonBlankText),
  issuer: partySchema,
  recipient: partySchema,
  amounts: z.object({
    subtotalHT: extractedFieldSchema(moneySchema),
    totalVAT: extractedFieldSchema(moneySchema),
    vatTreatment: extractedFieldSchema(z.enum(["taxable", "exempt", "reverse_charge", "not_applicable", "unknown"])),
    vatBreakdowns: extractedFieldSchema(z.array(vatBreakdownSchema)),
    totalTTC: extractedFieldSchema(moneySchema),
    totalDiscounts: extractedFieldSchema(moneySchema),
    otherFees: extractedFieldSchema(moneySchema),
    deposits: extractedFieldSchema(moneySchema),
    amountPaid: extractedFieldSchema(moneySchema),
    balanceDue: extractedFieldSchema(moneySchema),
  }),
  lines: extractedFieldSchema(z.array(invoiceLineSchema)),
  payment: z.object({
    iban: extractedFieldSchema(nonBlankText),
    bic: extractedFieldSchema(nonBlankText),
    method: extractedFieldSchema(nonBlankText),
    reference: extractedFieldSchema(nonBlankText),
  }),
  warnings: z.array(nonBlankText),
});

export type ValidatedInvoiceAnalysis = z.infer<typeof invoiceAnalysisSchema>;
