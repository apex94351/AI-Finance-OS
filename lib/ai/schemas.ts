import { z } from "zod";

const nullableText = z.string().trim().min(1).nullable();

export const invoiceAnalysisSchema = z.object({
  documentType: z.enum(["invoice", "credit_note", "other", "unknown"]),
  invoiceNumber: nullableText,
  issueDate: nullableText,
  dueDate: nullableText,
  currency: nullableText,
  supplier: z.object({
    name: nullableText,
    address: nullableText,
    email: nullableText,
    phone: nullableText,
    siret: nullableText,
    vatNumber: nullableText,
  }),
  client: z.object({
    name: nullableText,
    address: nullableText,
    siret: nullableText,
    vatNumber: nullableText,
  }),
  amounts: z.object({
    subtotal: z.number().nonnegative().nullable(),
    vat: z.number().nonnegative().nullable(),
    vatRate: z.number().nonnegative().max(100).nullable(),
    discount: z.number().nonnegative().nullable(),
    otherFees: z.number().nonnegative().nullable(),
    total: z.number().nonnegative().nullable(),
  }),
  payment: z.object({
    iban: nullableText,
    paymentTerms: nullableText,
    paymentMethod: nullableText,
  }),
  category: nullableText,
  summary: nullableText,
  missingInformation: z.array(z.string()),
  warnings: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type ValidatedInvoiceAnalysis = z.infer<typeof invoiceAnalysisSchema>;
