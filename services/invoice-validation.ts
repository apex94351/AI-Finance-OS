import type { InvoiceAnalysisResult } from "@/lib/ai/types";

export interface InvoiceValidationIssue {
  code: string;
  message: string;
}

export interface InvoiceValidationResult {
  valid: boolean;
  issues: InvoiceValidationIssue[];
  warnings: string[];
}

function isValidDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addIssue(issues: InvoiceValidationIssue[], code: string, message: string) {
  issues.push({ code, message });
}

export function validateInvoiceAnalysis(result: InvoiceAnalysisResult): InvoiceValidationResult {
  const issues: InvoiceValidationIssue[] = [];
  const warnings = [...result.warnings];

  if (result.issueDate && !isValidDate(result.issueDate)) {
    addIssue(issues, "invalid_issue_date", "La date d'émission n'est pas valide.");
  }
  if (result.dueDate && !isValidDate(result.dueDate)) {
    addIssue(issues, "invalid_due_date", "La date d'échéance n'est pas valide.");
  }
  if (result.issueDate && result.dueDate && isValidDate(result.issueDate) && isValidDate(result.dueDate) && result.dueDate < result.issueDate) {
    addIssue(issues, "incoherent_dates", "L'échéance est antérieure à la date d'émission.");
  }
  if (result.currency && !/^[A-Z]{3}$/.test(result.currency)) {
    addIssue(issues, "invalid_currency", "La devise doit être un code ISO 4217 en trois lettres.");
  }
  if (result.amounts.total !== null && result.amounts.total <= 0) {
    addIssue(issues, "invalid_total", "Le montant TTC doit être strictement positif.");
  }

  const { subtotal, vat, discount, otherFees, total } = result.amounts;
  if (subtotal !== null && vat !== null && total !== null) {
    const expectedTotal = subtotal - (discount ?? 0) + vat + (otherFees ?? 0);
    if (Math.abs(expectedTotal - total) > 0.01) {
      addIssue(issues, "amount_mismatch", "Le total TTC ne correspond pas aux montants extraits.");
    }
  } else if (total === null) {
    warnings.push("Le montant TTC n'a pas été détecté.");
  }

  if (!result.invoiceNumber) warnings.push("Le numéro de facture n'a pas été détecté.");
  if (!result.supplier.name) warnings.push("Le fournisseur n'a pas été détecté.");

  return { valid: issues.length === 0, issues, warnings: [...new Set(warnings)] };
}

export function deriveInvoiceStatus(
  dueDate: string | null,
  currentDate = new Date(),
): "pending" | "overdue" {
  if (!dueDate) return "pending";
  return dueDate < currentDate.toISOString().slice(0, 10) ? "overdue" : "pending";
}