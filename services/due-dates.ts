import type { InvoiceStatus } from "@/types/invoice";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";
import { getEffectiveExpenseStatus, type ExpenseStatus } from "@/services/expenses";

export type DueDateFilter = "all" | "payable" | "receivable";
export type DueDateDirection = "payable" | "receivable" | "unclassified";

export interface DueDateRecord {
  id: string;
  sourceType?: "invoice" | "expense";
  invoiceType?: "customer" | "supplier" | null;
  sourceDocumentCategory?: "customer_invoice" | "supplier_invoice" | null;
  invoiceId?: string | null;
  companyId: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  invoiceNumber: string | null;
  clientName: string | null;
  dueDate: string | null;
  total: number | null;
  currency: string | null;
  status: InvoiceStatus | ExpenseStatus;
  label?: string | null;
  paidAmount?: number | null;
  grossTotal?: number | null;
}

export interface DueDateItem extends DueDateRecord {
  direction: DueDateDirection;
  daysUntilDue: number;
  timing: "overdue" | "today" | "soon" | "future";
  displayedStatus: "pending" | "overdue";
}

export interface DueDateSummary {
  receivable: number;
  payable: number;
  forecastBalance: number;
  nonEuroCount: number;
  incompleteAmountCount: number;
  unclassifiedCount: number;
}

function dateOrdinal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? timestamp / 86_400_000
    : null;
}

function getRemainingAmount(record: DueDateRecord): number | null {
  const grossTotal = record.grossTotal ?? record.total;
  if (grossTotal === null || !Number.isFinite(grossTotal) || grossTotal < 0) return null;
  const paidAmount = record.paidAmount ?? 0;
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return null;
  if (Math.round((paidAmount + Number.EPSILON) * 100) > Math.round((grossTotal + Number.EPSILON) * 100)) return null;
  if (record.status === "paid") return 0;
  if (record.paidAmount === null) return null;
  const remainingCents = Math.round((grossTotal + Number.EPSILON) * 100)
    - Math.round((paidAmount + Number.EPSILON) * 100);
  if (remainingCents < 0) return null;
  return remainingCents / 100;
}

function getDirection(record: DueDateRecord): DueDateDirection {
  if (record.sourceType === "expense") return "payable";
  if (record.invoiceType === "customer" || record.customerId) return "receivable";
  if (record.invoiceType === "supplier" || record.supplierId) return "payable";
  if (record.sourceDocumentCategory === "customer_invoice") return "receivable";
  if (record.sourceDocumentCategory === "supplier_invoice") return "payable";
  return "unclassified";
}

export function buildDueDateItems(records: DueDateRecord[], asOfDate: string): DueDateItem[] {
  const today = dateOrdinal(asOfDate);
  if (today === null) return [];

  return records.flatMap((record) => {
    if (record.status === "draft" || record.status === "cancelled" || record.status === "paid") return [];
    if (!record.dueDate) return [];
    const dueDay = dateOrdinal(record.dueDate);
    if (dueDay === null) return [];

    const remaining = getRemainingAmount(record);
    if (remaining === 0) return [];

    const effectiveStatus = record.sourceType === "expense"
      ? getEffectiveExpenseStatus({
        amount: record.grossTotal ?? record.total ?? 0,
        status: record.status as ExpenseStatus,
        dueDate: record.dueDate,
      }, record.paidAmount ?? 0, asOfDate)
      : getEffectiveInvoiceStatus(record.status as InvoiceStatus, record.dueDate, new Date(`${asOfDate}T00:00:00Z`));
    if (effectiveStatus === "draft" || effectiveStatus === "cancelled" || effectiveStatus === "paid") return [];

    const isOverdue = effectiveStatus === "overdue" || dueDay < today;
    const timing: DueDateItem["timing"] = isOverdue
      ? "overdue"
      : dueDay === today
        ? "today"
        : dueDay - today <= 7
          ? "soon"
          : "future";

    return [{
      ...record,
      total: remaining,
      direction: getDirection(record),
      daysUntilDue: dueDay - today,
      timing,
      displayedStatus: isOverdue ? "overdue" as const : "pending" as const,
    }];
  }).sort((left, right) => {
    if (left.timing === "overdue" && right.timing !== "overdue") return -1;
    if (right.timing === "overdue" && left.timing !== "overdue") return 1;
    return (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
  });
}

export function filterDueDateItems(items: DueDateItem[], filter: DueDateFilter): DueDateItem[] {
  return filter === "all" ? items : items.filter((item) => item.direction === filter);
}

export function deduplicateDueDateRecords(
  invoices: readonly DueDateRecord[],
  expenses: readonly DueDateRecord[],
): DueDateRecord[] {
  const invoiceIds = new Set(invoices.map(({ id }) => id));
  return [
    ...invoices,
    ...expenses.filter((expense) => !expense.invoiceId || !invoiceIds.has(expense.invoiceId)),
  ];
}

export function buildDueDateSummary(records: readonly DueDateRecord[], asOfDate: string): DueDateSummary {
  let receivableCents = 0;
  let payableCents = 0;
  let nonEuroCount = 0;
  let incompleteAmountCount = 0;
  let unclassifiedCount = 0;

  for (const record of buildDueDateItems([...records], asOfDate)) {
    const direction = record.direction;
    if (direction === "unclassified") {
      unclassifiedCount += 1;
      continue;
    }

    const remaining = record.total;
    if (remaining === 0) continue;
    if (remaining === null || !Number.isFinite(remaining) || remaining < 0) {
      incompleteAmountCount += 1;
      continue;
    }
    if (!record.currency || !/^[A-Z]{3}$/.test(record.currency)) {
      incompleteAmountCount += 1;
      continue;
    }
    if (record.currency !== "EUR") {
      nonEuroCount += 1;
      continue;
    }
    const cents = Math.round((remaining + Number.EPSILON) * 100);
    if (direction === "receivable") receivableCents += cents;
    else payableCents += cents;
  }

  return {
    receivable: receivableCents / 100,
    payable: payableCents / 100,
    forecastBalance: (receivableCents - payableCents) / 100,
    nonEuroCount,
    incompleteAmountCount,
    unclassifiedCount,
  };
}
