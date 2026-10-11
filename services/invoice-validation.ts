import type { ExtractedField, InvoiceAnalysisResult } from "@/lib/ai/types";

export interface InvoiceValidationIssue {
  code: string;
  message: string;
}

export interface InvoiceValidationResult {
  consistent: boolean;
  reviewRequired: true;
  issues: InvoiceValidationIssue[];
  warnings: string[];
}

const MONEY_TOLERANCE_CENTS = 1;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function presentValue<T>(field: ExtractedField<T>): T | null {
  return field.status === "present" ? field.value : null;
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function addIssue(issues: InvoiceValidationIssue[], code: string, message: string) {
  issues.push({ code, message });
}

function addFieldQualityWarning(
  warnings: string[],
  label: string,
  field: ExtractedField<unknown>,
) {
  if (field.status === "missing") warnings.push(`${label} absent du document.`);
  if (field.status === "illegible") warnings.push(`${label} présent mais illisible.`);
  if (field.status === "uncertain") warnings.push(`${label} détecté avec incertitude; vérification nécessaire.`);
}

export function validateInvoiceAnalysis(result: InvoiceAnalysisResult): InvoiceValidationResult {
  const issues: InvoiceValidationIssue[] = [];
  const warnings = [...result.warnings];
  const issueDate = presentValue(result.issueDate);
  const dueDate = presentValue(result.dueDate);

  if (issueDate && !isValidDate(issueDate)) {
    addIssue(issues, "invalid_issue_date", "La date d'émission extraite n'est pas une date valide.");
  }
  if (dueDate && !isValidDate(dueDate)) {
    addIssue(issues, "invalid_due_date", "La date d'échéance extraite n'est pas une date valide.");
  }
  if (issueDate && dueDate && isValidDate(issueDate) && isValidDate(dueDate) && dueDate < issueDate) {
    addIssue(issues, "incoherent_dates", "L'échéance est antérieure à la date d'émission.");
  }

  const lineItems = presentValue(result.lines);
  const lineSubtotalValues: number[] = [];
  lineItems?.forEach((line, index) => {
    const quantity = presentValue(line.quantity);
    const unitPrice = presentValue(line.unitPrice);
    const discount = presentValue(line.discountAmount);
    const discountRate = presentValue(line.discountRate);
    const subtotal = presentValue(line.subtotalHT);
    const lineLabel = `La ligne ${index + 1}`;
    const canResolveDiscount = !["illegible", "uncertain"].includes(line.discountAmount.status)
      && !["illegible", "uncertain"].includes(line.discountRate.status);

    if (quantity !== null && unitPrice !== null && subtotal !== null
      && canResolveDiscount) {
      const grossCents = toCents(quantity * unitPrice);
      const rateDiscountCents = discountRate === null ? null : Math.round(grossCents * discountRate / 100);
      const appliedDiscountCents = discount !== null ? toCents(discount) : rateDiscountCents ?? 0;
      const expectedSubtotal = grossCents - appliedDiscountCents;
      if (Math.abs(expectedSubtotal - toCents(subtotal)) > MONEY_TOLERANCE_CENTS) {
        addIssue(issues, "line_subtotal_mismatch", `${lineLabel}, le montant HT ne correspond pas à la quantité, au prix unitaire et à la remise.`);
      }
      if (discount !== null && rateDiscountCents !== null && Math.abs(toCents(discount) - rateDiscountCents) > MONEY_TOLERANCE_CENTS) {
        addIssue(issues, "line_discount_mismatch", `${lineLabel}, le montant et le taux de remise ne concordent pas.`);
      }
    }

    if (subtotal !== null) lineSubtotalValues.push(subtotal);

    const vatRate = presentValue(line.vatRate);
    const lineTotal = presentValue(line.totalTTC);
    if (subtotal !== null && vatRate !== null && lineTotal !== null) {
      const expectedTotal = toCents(subtotal) + Math.round(toCents(subtotal) * vatRate / 100);
      if (Math.abs(expectedTotal - toCents(lineTotal)) > MONEY_TOLERANCE_CENTS) {
        addIssue(issues, "line_total_mismatch", `${lineLabel}, le total TTC ne correspond pas au montant HT et à la TVA.`);
      }
    }
  });

  const subtotalHT = presentValue(result.amounts.subtotalHT);
  if (lineItems?.length && lineSubtotalValues.length === lineItems.length && subtotalHT !== null) {
    const linesSubtotal = lineSubtotalValues.reduce((sum, value) => sum + toCents(value), 0);
    if (Math.abs(linesSubtotal - toCents(subtotalHT)) > lineItems.length * MONEY_TOLERANCE_CENTS) {
      addIssue(issues, "lines_subtotal_mismatch", "La somme des lignes HT ne correspond pas au total HT extrait.");
    }
  }

  const vatBreakdowns = presentValue(result.amounts.vatBreakdowns);
  const vatAmounts: number[] = [];
  vatBreakdowns?.forEach((breakdown, index) => {
    const rate = presentValue(breakdown.rate);
    const base = presentValue(breakdown.taxableBase);
    const vat = presentValue(breakdown.amount);
    if (vat !== null) vatAmounts.push(vat);
    if (rate !== null && base !== null && vat !== null) {
      const expectedVat = Math.round(toCents(base) * rate / 100);
      if (Math.abs(expectedVat - toCents(vat)) > MONEY_TOLERANCE_CENTS) {
        addIssue(issues, "vat_rate_mismatch", `La TVA ventilée au taux ${rate}% (ligne ${index + 1}) ne correspond pas à sa base imposable.`);
      }
    }
  });

  const totalVAT = presentValue(result.amounts.totalVAT);
  const vatTreatment = presentValue(result.amounts.vatTreatment);
  if ((vatTreatment === "exempt" || vatTreatment === "not_applicable")
    && totalVAT !== null && Math.abs(toCents(totalVAT)) > MONEY_TOLERANCE_CENTS) {
    addIssue(issues, "vat_treatment_mismatch", "Le traitement de TVA indique une exonération ou une non-applicabilité, mais un montant de TVA non nul est extrait.");
  }
  if (vatBreakdowns && vatAmounts.length === vatBreakdowns.length && totalVAT !== null) {
    const breakdownTotal = vatAmounts.reduce((sum, value) => sum + toCents(value), 0);
    if (Math.abs(breakdownTotal - toCents(totalVAT)) > vatBreakdowns.length * MONEY_TOLERANCE_CENTS) {
      addIssue(issues, "vat_total_mismatch", "La somme des ventilations de TVA ne correspond pas au total de TVA extrait.");
    }
  }

  const discounts = presentValue(result.amounts.totalDiscounts);
  const otherFees = presentValue(result.amounts.otherFees);
  const totalTTC = presentValue(result.amounts.totalTTC);
  if (subtotalHT !== null && totalVAT !== null && totalTTC !== null
    && !["illegible", "uncertain"].includes(result.amounts.totalDiscounts.status)
    && !["illegible", "uncertain"].includes(result.amounts.otherFees.status)) {
    // A `missing` adjustment contributes no arithmetic amount; the extracted field remains missing.
    const expectedTotal = toCents(subtotalHT)
      - (discounts === null ? 0 : toCents(discounts))
      + toCents(totalVAT)
      + (otherFees === null ? 0 : toCents(otherFees));
    if (Math.abs(expectedTotal - toCents(totalTTC)) > 2) {
      addIssue(issues, "amount_mismatch", "Le total TTC ne correspond pas au HT, aux remises, aux frais et à la TVA extraits.");
    }
  } else if (totalTTC === null) {
    addFieldQualityWarning(warnings, "Le total TTC", result.amounts.totalTTC);
  } else if (["uncertain", "illegible"].includes(result.amounts.totalDiscounts.status)
    || ["uncertain", "illegible"].includes(result.amounts.otherFees.status)) {
    warnings.push("Le total TTC ne peut pas être rapproché tant que les remises ou frais sont illisibles ou incertains.");
  }

  addFieldQualityWarning(warnings, "Le numéro de facture ou de devis", result.referenceNumber);
  addFieldQualityWarning(warnings, "La date d'émission", result.issueDate);
  addFieldQualityWarning(warnings, "La date d'échéance", result.dueDate);
  addFieldQualityWarning(warnings, "La devise", result.currency);
  addFieldQualityWarning(warnings, "Le total HT", result.amounts.subtotalHT);
  addFieldQualityWarning(warnings, "Le total de TVA", result.amounts.totalVAT);
  addFieldQualityWarning(warnings, "Le nom de l'émetteur", result.issuer.name);
  addFieldQualityWarning(warnings, "Le nom du destinataire", result.recipient.name);
  addFieldQualityWarning(warnings, "Le numéro de TVA de l'émetteur", result.issuer.vatNumber);
  const businessIdentifier = result.issuer.siren.status === "present"
    ? result.issuer.siren
    : result.issuer.siret.status === "present"
      ? result.issuer.siret
      : result.issuer.siren.status === "uncertain" || result.issuer.siret.status === "uncertain"
        ? { status: "uncertain" as const, value: null }
        : result.issuer.siren.status === "illegible" || result.issuer.siret.status === "illegible"
          ? { status: "illegible" as const, value: null }
          : result.issuer.siren;
  addFieldQualityWarning(warnings, "Le SIREN/SIRET de l'émetteur", businessIdentifier);

  if (!vatBreakdowns?.length && result.amounts.vatBreakdowns.status !== "present") {
    addFieldQualityWarning(warnings, "La ventilation de TVA", result.amounts.vatBreakdowns);
  }
  if (result.documentType.status !== "present") {
    addFieldQualityWarning(warnings, "Le type de document", result.documentType);
  }
  if (result.warnings.length) warnings.push("L'extraction signale des ambiguïtés qui nécessitent une revue.");

  return {
    consistent: issues.length === 0,
    reviewRequired: true,
    issues,
    warnings: [...new Set(warnings)],
  };
}

export function deriveInvoiceStatus(
  dueDate: string | null,
  currentDate = new Date(),
): "pending" | "overdue" {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "pending";
  if (Number.isNaN(currentDate.getTime())) return "pending";
  const parsedDate = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dueDate) return "pending";
  return dueDate < currentDate.toISOString().slice(0, 10) ? "overdue" : "pending";
}

export function getEffectiveInvoiceStatus(
  status: import("@/types/invoice").InvoiceStatus,
  dueDate: string | null,
  currentDate = new Date(),
): import("@/types/invoice").InvoiceStatus {
  if (status === "paid" || status === "overdue" || status === "draft" || status === "cancelled") return status;
  return deriveInvoiceStatus(dueDate, currentDate);
}
