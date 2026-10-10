import type { InvoiceStatus } from "@/types/invoice";

export type DueDateFilter = "all" | "upcoming" | "overdue" | "paid";
export type DueDatePeriod = "all" | "next7" | "next30" | "later";
export type DueDateDirection = "payable" | "receivable" | "settled" | "unknown";

export interface DueDateRecord {
  id: string;
  companyId: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  invoiceNumber: string | null;
  clientName: string | null;
  dueDate: string | null;
  total: number | null;
  currency: string | null;
  status: InvoiceStatus;
}

export interface DueDateItem extends DueDateRecord {
  direction: DueDateDirection;
  daysUntilDue: number;
  timing: "overdue" | "today" | "soon" | "future" | "paid";
  displayedStatus: "pending" | "receivable" | "overdue" | "paid";
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

export function buildDueDateItems(invoices: DueDateRecord[], asOfDate: string): DueDateItem[] {
  const today = dateOrdinal(asOfDate);
  if (today === null) return [];

  return invoices.flatMap((invoice) => {
    if (invoice.status === "draft" || invoice.status === "cancelled") return [];
    if (!invoice.dueDate) return [];
    const dueDay = dateOrdinal(invoice.dueDate);
    if (dueDay === null) return [];

    const direction: DueDateDirection = invoice.status === "paid"
      ? "settled"
      : invoice.status === "receivable"
        ? "receivable"
        : invoice.status === "pending"
          ? "payable"
          : "unknown";
    const displayedStatus: DueDateItem["displayedStatus"] = invoice.status === "paid"
      ? "paid"
      : dueDay < today
        ? "overdue"
        : direction === "receivable"
          ? "receivable"
          : "pending";
    const timing: DueDateItem["timing"] = invoice.status === "paid"
      ? "paid"
      : dueDay < today
        ? "overdue"
        : dueDay === today
          ? "today"
          : dueDay - today <= 7
            ? "soon"
            : "future";

    return [{
      ...invoice,
      direction,
      daysUntilDue: dueDay - today,
      timing,
      displayedStatus,
    }];
  }).sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));
}

export function filterDueDateItems(items: DueDateItem[], filter: DueDateFilter): DueDateItem[] {
  switch (filter) {
    case "upcoming":
      return items.filter((item) => item.direction !== "settled" && item.daysUntilDue >= 0);
    case "overdue":
      return items.filter((item) => item.direction !== "settled" && item.daysUntilDue < 0);
    case "paid":
      return items.filter((item) => item.direction === "settled");
    case "all":
      return items;
  }
}

export function filterDueDatePeriod(items: DueDateItem[], period: DueDatePeriod): DueDateItem[] {
  switch (period) {
    case "next7":
      return items.filter((item) => item.direction !== "settled" && item.daysUntilDue >= 0 && item.daysUntilDue <= 7);
    case "next30":
      return items.filter((item) => item.direction !== "settled" && item.daysUntilDue >= 0 && item.daysUntilDue <= 30);
    case "later":
      return items.filter((item) => item.direction !== "settled" && item.daysUntilDue > 30);
    case "all":
      return items;
  }
}

export function filterDueDateDirection(items: DueDateItem[], direction: DueDateDirection | "all"): DueDateItem[] {
  return direction === "all" ? items : items.filter((item) => item.direction === direction);
}

export function filterDueDateCompany(
  items: DueDateItem[],
  companyId: string | "personal" | "all",
): DueDateItem[] {
  if (companyId === "all") return items;
  return items.filter((item) => companyId === "personal"
    ? item.companyId === null
    : item.companyId === companyId);
}
