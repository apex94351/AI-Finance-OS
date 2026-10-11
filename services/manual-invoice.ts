import { z } from "zod";
import type { InvoiceStatus } from "@/types/invoice";

const amountPattern = /^\d{1,12}(?:[.,]\d{1,2})?$/;
const ratePattern = /^(?:\d{1,3})(?:[.,]\d{1,2})?$/;

export const manualInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().max(80).transform((value) => value || null),
  clientName: z.string().trim().min(1, "Saisissez le nom du client.").max(200),
  description: z.string().trim().min(1, "Saisissez une description.").max(2000),
  subtotal: z.string().trim().regex(amountPattern, "Saisissez un montant HT valide."),
  vatRate: z.string().trim().regex(ratePattern, "Saisissez un taux de TVA entre 0 et 100."),
  issueDate: z.string().date("Saisissez une date d’émission valide."),
  dueDate: z.string().date("Saisissez une date d’échéance valide."),
  status: z.enum(["pending", "paid", "overdue"]),
}).superRefine((invoice, context) => {
  const rate = Number(invoice.vatRate.replace(",", "."));
  if (rate > 100) {
    context.addIssue({
      code: "custom",
      path: ["vatRate"],
      message: "Le taux de TVA doit être compris entre 0 et 100.",
    });
  }
  if (!invoice.invoiceNumber) {
    context.addIssue({
      code: "custom",
      path: ["invoiceNumber"],
      message: "Un numéro de facture est requis.",
    });
  }
  if (invoice.dueDate < invoice.issueDate) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "La date d’échéance ne peut pas précéder la date d’émission.",
    });
  }
});

export type ManualInvoiceInput = z.infer<typeof manualInvoiceSchema>;

export interface CalculatedInvoiceAmounts {
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export function calculateInvoiceAmounts(subtotal: string, vatRate: string): CalculatedInvoiceAmounts | null {
  if (!amountPattern.test(subtotal) || !ratePattern.test(vatRate)) return null;
  const [wholeAmount, fractionalAmount = ""] = subtotal.replace(",", ".").split(".");
  const subtotalCents = Number(wholeAmount) * 100 + Number(fractionalAmount.padEnd(2, "0"));
  const [wholeRate, fractionalRate = ""] = vatRate.replace(",", ".").split(".");
  const rateBasisPoints = Number(wholeRate) * 100 + Number(fractionalRate.padEnd(2, "0"));
  if (rateBasisPoints > 10000 || subtotalCents > 99999999999999) return null;

  const fullRateCents = Math.floor(subtotalCents / 10000) * rateBasisPoints;
  const remainderRateCents = Math.round(((subtotalCents % 10000) * rateBasisPoints) / 10000);
  const vatCents = fullRateCents + remainderRateCents;
  return {
    subtotal: subtotalCents / 100,
    vatRate: rateBasisPoints / 100,
    vatAmount: vatCents / 100,
    total: (subtotalCents + vatCents) / 100,
  };
}

export function getPersistedInvoiceStatus(
  status: InvoiceStatus,
  dueDate: string | null,
  currentDate = new Date(),
): InvoiceStatus | null {
  const today = currentDate.toISOString().slice(0, 10);
  if (status === "paid") return "paid";
  if (status === "draft" || status === "cancelled") return null;
  if (status === "overdue") return "overdue";
  return dueDate && dueDate < today ? "overdue" : "pending";
}

export function formatInvoiceAmount(value: number | null): string {
  return value === null ? "0.00" : value.toFixed(2);
}

export function getInvoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case "draft": return "Brouillon";
    case "pending": return "À payer";
    case "paid": return "Payée";
    case "overdue": return "En retard";
    case "receivable": return "À recevoir";
    case "cancelled": return "Annulée";
  }
}
