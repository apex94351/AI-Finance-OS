import type { InvoiceRecord } from "@/types/invoice";
import type { ExpenseRecord } from "@/services/expenses";
import { getEffectiveInvoiceStatus, getInvoiceDirection, getInvoiceRemainingAmount } from "@/services/invoice-validation";

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export type DashboardActionKind = "overdue" | "upcoming" | "verify" | "draft";

export interface DashboardAction {
  invoice: InvoiceRecord;
  kind: DashboardActionKind;
  daysUntilDue: number | null;
  reason: string;
}

export interface DashboardSummary {
  receivableTotals: CurrencyTotal[];
  payableTotals: CurrencyTotal[];
  overdueTotals: CurrencyTotal[];
  toProcessCount: number;
  upcomingCount: number;
  actions: DashboardAction[];
  alerts: DashboardAction[];
  upcoming: InvoiceRecord[];
  recent: InvoiceRecord[];
}

export type DashboardPeriod = "7d" | "1m" | "3m" | "6m" | "1y" | "custom";

export interface DashboardDateRange {
  startDate: string;
  endDate: string;
  valid: boolean;
}

export interface DashboardChartBucket {
  date: string;
  amount: number;
}

export type DashboardChartInterval = "day" | "week" | "month";

export interface DashboardPaidExpenseSeries {
  currency: string;
  interval: DashboardChartInterval;
  buckets: DashboardChartBucket[];
}

export interface DashboardCockpit {
  receivableTotals: CurrencyTotal[];
  payableTotals: CurrencyTotal[];
  invoicedTotals: CurrencyTotal[];
  expenseTotals: CurrencyTotal[];
  overdueInvoices: InvoiceRecord[];
  overdueCustomerInvoices: InvoiceRecord[];
  upcomingSupplierInvoices: InvoiceRecord[];
  upcomingInvoices: InvoiceRecord[];
  paidExpenseSeries: DashboardPaidExpenseSeries[];
}

const dayMilliseconds = 86_400_000;

function dateOrdinal(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? timestamp / dayMilliseconds
    : null;
}

function addCurrencyTotal(totals: Map<string, number>, invoice: InvoiceRecord) {
  if (!invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency) || invoice.total === null || !Number.isFinite(invoice.total)) return;
  const cents = Math.round(invoice.total * 100);
  totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + cents);
}

function mapTotals(totals: Map<string, number>): CurrencyTotal[] {
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountInCents]) => ({ currency, amount: amountInCents / 100 }));
}

function validDate(value: string): boolean {
  return dateOrdinal(value) !== null;
}

function dateFromOrdinal(value: number): string {
  return new Date(value * dayMilliseconds).toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const firstOfTargetMonth = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const lastDay = new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(day!, lastDay));
  return firstOfTargetMonth.toISOString().slice(0, 10);
}

export function resolveDashboardDateRange(
  period: DashboardPeriod,
  asOfDate: string,
  customStartDate?: string,
  customEndDate?: string,
): DashboardDateRange {
  if (!validDate(asOfDate)) return { startDate: "", endDate: "", valid: false };
  if (period === "custom") {
    const valid = Boolean(customStartDate && customEndDate
      && validDate(customStartDate)
      && validDate(customEndDate)
      && customStartDate <= customEndDate);
    return {
      startDate: customStartDate ?? "",
      endDate: customEndDate ?? "",
      valid,
    };
  }
  const startDate = period === "7d"
    ? dateFromOrdinal(dateOrdinal(asOfDate)! - 6)
    : addMonths(asOfDate, period === "1m" ? -1 : period === "3m" ? -3 : period === "6m" ? -6 : -12);
  return { startDate, endDate: asOfDate, valid: true };
}

function isCustomerInvoice(invoice: InvoiceRecord): boolean {
  return getInvoiceDirection(invoice) === "customer";
}

function isOpenInvoice(invoice: InvoiceRecord, asOfDate: string): boolean {
  const status = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate, new Date(`${asOfDate}T00:00:00Z`));
  return status === "pending" || status === "overdue";
}

function invoiceBalance(invoice: InvoiceRecord, asOfDate: string): number | null {
  if (!isOpenInvoice(invoice, asOfDate)) return null;
  const remaining = invoice.remainingAmount ?? getInvoiceRemainingAmount(invoice.total, invoice.paidAmount, invoice.status);
  return remaining !== null && remaining > 0 ? remaining : null;
}

function addMoney(totals: Map<string, number>, amount: number | null, currency: string | null) {
  if (amount === null || !Number.isFinite(amount) || !currency || !/^[A-Z]{3}$/.test(currency)) return;
  totals.set(currency, (totals.get(currency) ?? 0) + Math.round(amount * 100));
}

function isWithinRange(date: string | null, range: DashboardDateRange): date is string {
  return Boolean(range.valid && date && validDate(date) && date >= range.startDate && date <= range.endDate);
}

function bucketDate(date: string, range: DashboardDateRange): string {
  const interval = getBucketInterval(range);
  if (interval === "day") return date;
  if (interval === "week") {
    const dateOrdinalValue = dateOrdinal(date)!;
    const startOrdinal = dateOrdinal(range.startDate)!;
    return dateFromOrdinal(startOrdinal + Math.floor((dateOrdinalValue - startOrdinal) / 7) * 7);
  }
  return `${date.slice(0, 7)}-01`;
}

function getBucketInterval(range: DashboardDateRange): DashboardChartInterval {
  const days = dateOrdinal(range.endDate)! - dateOrdinal(range.startDate)! + 1;
  return days <= 31 ? "day" : days <= 100 ? "week" : "month";
}

function getBucketDates(range: DashboardDateRange): string[] {
  const start = dateOrdinal(range.startDate);
  const end = dateOrdinal(range.endDate);
  if (!range.valid || start === null || end === null || start > end) return [];

  if (getBucketInterval(range) !== "month") {
    const step = getBucketInterval(range) === "day" ? 1 : 7;
    const dates: string[] = [];
    for (let ordinal = start; ordinal <= end; ordinal += step) {
      dates.push(dateFromOrdinal(ordinal));
    }
    return dates;
  }

  const dates: string[] = [];
  const [startYear, startMonth] = range.startDate.split("-").map(Number);
  const [endYear, endMonth] = range.endDate.split("-").map(Number);
  for (let year = startYear!; year <= endYear!; year += 1) {
    const firstMonth = year === startYear ? startMonth! : 1;
    const lastMonth = year === endYear ? endMonth! : 12;
    for (let month = firstMonth; month <= lastMonth; month += 1) {
      dates.push(`${year}-${String(month).padStart(2, "0")}-01`);
    }
  }
  return dates;
}

export function buildDashboardCockpit(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
  range: DashboardDateRange,
  asOfDate: string,
): DashboardCockpit {
  const receivableTotals = new Map<string, number>();
  const payableTotals = new Map<string, number>();
  const invoicedTotals = new Map<string, number>();
  const expenseTotals = new Map<string, number>();
  const paidExpenseBuckets = new Map<string, Map<string, number>>();
  const todayOrdinal = dateOrdinal(asOfDate);
  const overdueInvoices: InvoiceRecord[] = [];
  const overdueCustomerInvoices: InvoiceRecord[] = [];
  const upcomingSupplierInvoices: InvoiceRecord[] = [];
  const upcomingInvoices: InvoiceRecord[] = [];

  for (const invoice of invoices) {
    const balance = invoiceBalance(invoice, asOfDate);
    if (balance !== null) {
      if (getInvoiceDirection(invoice) === "supplier") addMoney(payableTotals, balance, invoice.currency);
      else if (isCustomerInvoice(invoice)) addMoney(receivableTotals, balance, invoice.currency);

      const dueOrdinal = dateOrdinal(invoice.dueDate);
      if (dueOrdinal !== null && todayOrdinal !== null) {
        if (dueOrdinal < todayOrdinal) {
          overdueInvoices.push(invoice);
          if (isCustomerInvoice(invoice)) overdueCustomerInvoices.push(invoice);
        }
        if (getInvoiceDirection(invoice) === "supplier" && dueOrdinal >= todayOrdinal && dueOrdinal - todayOrdinal <= 30) {
          upcomingSupplierInvoices.push(invoice);
        }
        if ((getInvoiceDirection(invoice) !== null)
          && dueOrdinal >= todayOrdinal && dueOrdinal - todayOrdinal <= 30) upcomingInvoices.push(invoice);
      }
    }
    if (invoice.status !== "draft" && invoice.status !== "cancelled"
      && isCustomerInvoice(invoice) && isWithinRange(invoice.issueDate, range)) {
      addMoney(invoicedTotals, invoice.total, invoice.currency);
    }
  }

  for (const expense of expenses) {
    if (expense.status === "cancelled" || !isWithinRange(expense.expenseDate, range)) continue;
    addMoney(expenseTotals, expense.amount, expense.currency);
    if (expense.status === "paid"
      && Number.isFinite(expense.amount)
      && expense.amount > 0
      && /^[A-Z]{3}$/.test(expense.currency)) {
      const key = bucketDate(expense.expenseDate, range);
      const byCurrency = paidExpenseBuckets.get(expense.currency) ?? new Map<string, number>();
      byCurrency.set(key, (byCurrency.get(key) ?? 0) + Math.round(expense.amount * 100));
      paidExpenseBuckets.set(expense.currency, byCurrency);
    }
  }

  const sortByDueDate = (left: InvoiceRecord, right: InvoiceRecord) =>
    (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
  const bucketDates = getBucketDates(range);
  const bucketInterval = getBucketInterval(range);
  const paidExpenseSeries = [...paidExpenseBuckets]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, buckets]) => ({
      currency,
      interval: bucketInterval,
      buckets: bucketDates.map((date) => ({
        date,
        amount: (buckets.get(date) ?? 0) / 100,
      })),
    }));

  return {
    receivableTotals: mapTotals(receivableTotals),
    payableTotals: mapTotals(payableTotals),
    invoicedTotals: mapTotals(invoicedTotals),
    expenseTotals: mapTotals(expenseTotals),
    overdueInvoices: overdueInvoices.sort(sortByDueDate),
    overdueCustomerInvoices: overdueCustomerInvoices.sort(sortByDueDate),
    upcomingSupplierInvoices: upcomingSupplierInvoices.sort(sortByDueDate),
    upcomingInvoices: upcomingInvoices.sort(sortByDueDate),
    paidExpenseSeries,
  };
}

function invoiceTimestamp(invoice: InvoiceRecord): number {
  const updated = Date.parse(invoice.updatedAt);
  const created = Date.parse(invoice.createdAt);
  return Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : 0;
}

export function buildDashboardSummary(invoices: InvoiceRecord[], asOfDate: string): DashboardSummary {
  const today = dateOrdinal(asOfDate);
  const receivableTotals = new Map<string, number>();
  const payableTotals = new Map<string, number>();
  const overdueTotals = new Map<string, number>();
  const actions: DashboardAction[] = [];
  const upcoming: InvoiceRecord[] = [];
  let upcomingCount = 0;
  let toProcessCount = 0;

  for (const invoice of invoices) {
    const status = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate, new Date(`${asOfDate}T00:00:00Z`));
    if (status === "draft") {
      actions.push({
        invoice,
        kind: "draft",
        daysUntilDue: null,
        reason: "Brouillon à finaliser",
      });
      continue;
    }
    if (status !== "pending" && status !== "overdue") continue;
    const remaining = invoiceBalance(invoice, asOfDate);
    if (remaining === null) {
      const reason = dateOrdinal(invoice.dueDate) === null
        ? "Échéance absente ou invalide · montant restant à vérifier"
        : "Montant restant à vérifier";
      actions.push({ invoice, kind: "verify", daysUntilDue: null, reason });
      continue;
    }
    if (remaining <= 0) continue;
    const direction = getInvoiceDirection(invoice);
    if (direction === null) {
      actions.push({ invoice, kind: "verify", daysUntilDue: null, reason: "Sens financier de la facture à préciser" });
      continue;
    }
    toProcessCount += 1;

    const balanceInvoice = { ...invoice, total: remaining };
    if (direction === "supplier") addCurrencyTotal(payableTotals, balanceInvoice);
    else addCurrencyTotal(receivableTotals, balanceInvoice);

    const dueDay = dateOrdinal(invoice.dueDate);
    if (dueDay === null || today === null) {
      actions.push({ invoice, kind: "verify", daysUntilDue: null, reason: "Date d’échéance absente ou invalide" });
      continue;
    }

    const daysUntilDue = dueDay - today;
    if (daysUntilDue < 0) {
      addCurrencyTotal(overdueTotals, balanceInvoice);
      const reason = !invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)
        ? "Échéance dépassée · montant ou devise à vérifier"
        : "Échéance dépassée";
      actions.push({ invoice, kind: "overdue", daysUntilDue, reason });
      continue;
    }

    upcoming.push(invoice);
    if (daysUntilDue <= 7) upcomingCount += 1;

    const verificationReasons: string[] = [];
    if (invoice.total === null || !Number.isFinite(invoice.total) || !invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)) {
      verificationReasons.push("Montant ou devise à vérifier");
    }

    if (verificationReasons.length) {
      actions.push({ invoice, kind: "verify", daysUntilDue, reason: verificationReasons.join(" · ") });
    } else if (daysUntilDue <= 7) {
      actions.push({ invoice, kind: "upcoming", daysUntilDue, reason: "Échéance proche" });
    }
  }

  const actionPriority: Record<DashboardActionKind, number> = { overdue: 0, upcoming: 1, verify: 2, draft: 3 };
  actions.sort((left, right) => {
    const priorityDifference = actionPriority[left.kind] - actionPriority[right.kind];
    if (priorityDifference) return priorityDifference;
    if (left.kind === "overdue" && right.kind === "overdue") {
      return (left.daysUntilDue ?? 0) - (right.daysUntilDue ?? 0);
    }
    if ((left.kind === "upcoming" || left.kind === "draft") && left.kind === right.kind) {
      return (left.daysUntilDue ?? 0) - (right.daysUntilDue ?? 0);
    }
    return invoiceTimestamp(left.invoice) - invoiceTimestamp(right.invoice);
  });

  upcoming.sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""));

  const recent = [...invoices]
    .sort((left, right) => invoiceTimestamp(right) - invoiceTimestamp(left))
    .slice(0, 5);

  return {
    receivableTotals: mapTotals(receivableTotals),
    payableTotals: mapTotals(payableTotals),
    overdueTotals: mapTotals(overdueTotals),
    toProcessCount,
    upcomingCount,
    actions: actions.slice(0, 6),
    alerts: actions,
    upcoming: upcoming.slice(0, 5),
    recent,
  };
}
