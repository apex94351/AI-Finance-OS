import type { InvoiceStatus } from "@/types/invoice";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";
import { getEffectiveExpenseStatus, type ExpenseStatus } from "@/services/expenses";

export type DueDateFilter = "all" | "payable" | "receivable";
export type DueDateDirection = "payable" | "receivable";

export interface DueDateRecord {
  id: string;
  sourceType?: "invoice" | "expense";
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
  paidAmount?: number;
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
  if (record.status === "paid") return 0;
  const paidAmount = record.paidAmount ?? 0;
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return null;
  return Math.max(0, Math.round((grossTotal - paidAmount + Number.EPSILON) * 100) / 100);
}

function getDirection(record: DueDateRecord): DueDateDirection {
  if (record.sourceType === "expense" || record.supplierId) return "payable";
  if (record.customerId || record.status === "receivable") return "receivable";
  return "payable";
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

export function buildDueDateSummary(items: readonly DueDateItem[]): DueDateSummary {
  let receivableCents = 0;
  let payableCents = 0;
  let nonEuroCount = 0;
  let incompleteAmountCount = 0;

  for (const item of items) {
    if (item.total === null || !Number.isFinite(item.total) || item.total <= 0) {
      incompleteAmountCount += 1;
      continue;
    }
    if (!item.currency || !/^[A-Z]{3}$/.test(item.currency)) {
      incompleteAmountCount += 1;
      continue;
    }
    if (item.currency !== "EUR") {
      nonEuroCount += 1;
      continue;
    }
    const cents = Math.round((item.total + Number.EPSILON) * 100);
    if (item.direction === "receivable") receivableCents += cents;
    else payableCents += cents;
  }

  return {
    receivable: receivableCents / 100,
    payable: payableCents / 100,
    forecastBalance: (receivableCents - payableCents) / 100,
    nonEuroCount,
    incompleteAmountCount,
  };
}
