import type { InvoiceRecord } from "@/types/invoice";
import { getEffectiveInvoiceStatus, getInvoiceDirection, getInvoiceRemainingAmount } from "@/services/invoice-validation";

export type InvoiceOverviewPeriod = "month" | "year" | "all";

export interface InvoiceCurrencyTotal {
  currency: string;
  amount: number;
}

export interface InvoicePartyOverview {
  issued: InvoiceCurrencyTotal[];
  paid: InvoiceCurrencyTotal[];
  outstanding: InvoiceCurrencyTotal[];
  overdue: InvoiceCurrencyTotal[];
  outstandingCount: number;
  overdueCount: number;
  incompleteAmountCount: number;
}

export interface InvoiceOverview {
  customers: InvoicePartyOverview;
  suppliers: InvoicePartyOverview;
  overdueCount: number;
  overdue: InvoiceCurrencyTotal[];
  net: InvoiceCurrencyTotal[];
  unclassifiedCount: number;
  unclassifiedIncompleteAmountCount: number;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
}

function addAmount(totals: Map<string, number>, amount: number, currency: string) {
  totals.set(currency, (totals.get(currency) ?? 0) + Math.round((amount + Number.EPSILON) * 100));
}

function mapTotals(totals: Map<string, number>): InvoiceCurrencyTotal[] {
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }));
}

function createPartyTotals(): {
  issued: Map<string, number>;
  paid: Map<string, number>;
  outstanding: Map<string, number>;
  overdue: Map<string, number>;
  outstandingCount: number;
  overdueCount: number;
  incompleteAmountCount: number;
} {
  return {
    issued: new Map(),
    paid: new Map(),
    outstanding: new Map(),
    overdue: new Map(),
    outstandingCount: 0,
    overdueCount: 0,
    incompleteAmountCount: 0,
  };
}

export function buildInvoiceOverview(
  invoices: readonly InvoiceRecord[],
  asOfDate: string,
  companyCurrencies: ReadonlyMap<string, string> = new Map(),
  period: InvoiceOverviewPeriod = "all",
): InvoiceOverview {
  const customers = createPartyTotals();
  const suppliers = createPartyTotals();
  const isAsOfDateValid = validDate(asOfDate);
  let unclassifiedCount = 0;
  let unclassifiedIncompleteAmountCount = 0;

  for (const invoice of invoices) {
    const issueDate = invoice.issueDate;
    if (period !== "all") {
      if (!validDate(issueDate)) continue;
      const periodStart = period === "month" ? asOfDate.slice(0, 7) : asOfDate.slice(0, 4);
      if (!issueDate.startsWith(periodStart)) continue;
    }
    const status = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate, new Date(`${asOfDate}T00:00:00Z`));
    if (status === "draft" || status === "cancelled") continue;

    const currencyCandidate = invoice.currency ?? companyCurrencies.get(invoice.companyId ?? "") ?? null;
    const currency = currencyCandidate && /^[A-Z]{3}$/.test(currencyCandidate) ? currencyCandidate : null;
    const amount = invoice.total !== null && Number.isFinite(invoice.total) && invoice.total >= 0
      ? invoice.total
      : null;
    const direction = getInvoiceDirection(invoice);
    const partyTotals = direction === "supplier" ? suppliers : direction === "customer" ? customers : null;
    if (!partyTotals) {
      unclassifiedCount += 1;
      if (amount === null || currency === null) unclassifiedIncompleteAmountCount += 1;
      continue;
    }

    if (amount === null || currency === null) partyTotals.incompleteAmountCount += 1;
    if (amount !== null && currency !== null) addAmount(partyTotals.issued, amount, currency);

    const remaining = invoice.remainingAmount
      ?? getInvoiceRemainingAmount(invoice.total, invoice.paidAmount, invoice.status);
    if (remaining === null) {
      if (amount !== null && currency !== null) partyTotals.incompleteAmountCount += 1;
      partyTotals.outstandingCount += 1;
      if (isAsOfDateValid && validDate(invoice.dueDate) && invoice.dueDate < asOfDate) {
        partyTotals.overdueCount += 1;
      }
      continue;
    }
    const paidAmount = invoice.paidAmount ?? (status === "paid" ? amount : 0);
    if (paidAmount !== null && paidAmount > 0 && currency !== null) {
      addAmount(partyTotals.paid, paidAmount, currency);
    }
    if (status === "paid") {
      if (amount !== null && currency !== null && paidAmount === 0) addAmount(partyTotals.paid, amount, currency);
      continue;
    }
    const hasOutstandingBalance = remaining === null || remaining > 0;
    if (!hasOutstandingBalance) continue;
    partyTotals.outstandingCount += 1;
    if (remaining !== null && remaining > 0 && currency !== null) {
      addAmount(partyTotals.outstanding, remaining, currency);
    }

    const isOverdue = status === "overdue" && hasOutstandingBalance;
    if (isOverdue) {
      partyTotals.overdueCount += 1;
      if (remaining !== null && remaining > 0 && currency !== null) {
        addAmount(partyTotals.overdue, remaining, currency);
      }
    }
  }

  const customerIssued = new Map(
    mapTotals(customers.issued).map(({ currency, amount }) => [currency, Math.round(amount * 100)]),
  );
  const supplierIssued = new Map(
    mapTotals(suppliers.issued).map(({ currency, amount }) => [currency, Math.round(amount * 100)]),
  );
  const netCents = new Map<string, number>();
  for (const [currency, cents] of customerIssued) netCents.set(currency, cents);
  for (const [currency, cents] of supplierIssued) {
    netCents.set(currency, (netCents.get(currency) ?? 0) - cents);
  }

  const overdueCents = new Map<string, number>();
  for (const { currency, amount } of [...mapTotals(customers.overdue), ...mapTotals(suppliers.overdue)]) {
    overdueCents.set(currency, (overdueCents.get(currency) ?? 0) + Math.round(amount * 100));
  }

  return {
    customers: {
      issued: mapTotals(customers.issued),
      paid: mapTotals(customers.paid),
      outstanding: mapTotals(customers.outstanding),
      overdue: mapTotals(customers.overdue),
      outstandingCount: customers.outstandingCount,
      overdueCount: customers.overdueCount,
      incompleteAmountCount: customers.incompleteAmountCount,
    },
    suppliers: {
      issued: mapTotals(suppliers.issued),
      paid: mapTotals(suppliers.paid),
      outstanding: mapTotals(suppliers.outstanding),
      overdue: mapTotals(suppliers.overdue),
      outstandingCount: suppliers.outstandingCount,
      overdueCount: suppliers.overdueCount,
      incompleteAmountCount: suppliers.incompleteAmountCount,
    },
    overdueCount: customers.overdueCount + suppliers.overdueCount,
    overdue: mapTotals(overdueCents),
    net: mapTotals(netCents),
    unclassifiedCount,
    unclassifiedIncompleteAmountCount,
  };
}
