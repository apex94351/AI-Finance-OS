import type {
  DashboardCashflowSeries,
  DashboardExpensePayment,
  DashboardInvoicePayment,
} from "@/services/dashboard";
import type { ExpenseRecord } from "@/services/expenses";
import { getInvoiceDirection } from "@/services/invoice-validation";
import type { InvoiceRecord } from "@/types/invoice";

export interface TreasuryOpeningBalance {
  userId: string | null;
  companyId: string | null;
  currency: string;
  amount: number;
  date: string;
}

export interface TreasuryMovement {
  id: string;
  userId: string | null;
  companyId: string | null;
  date: string;
  direction: "inflow" | "outflow";
  description: string;
  counterparty: string;
  amount: number;
  currency: string;
  href: string;
}

export interface TreasuryScope {
  id: string | null;
  label: string;
  currency: string | null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildTreasuryMovements(
  invoices: readonly InvoiceRecord[],
  expenses: readonly ExpenseRecord[],
  customerPayments: readonly DashboardInvoicePayment[],
  expensePayments: readonly DashboardExpensePayment[],
  counterpartyNames: Readonly<Record<string, string>>,
): TreasuryMovement[] {
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const expensesById = new Map(expenses.map((expense) => [expense.id, expense]));
  const movements: TreasuryMovement[] = [];

  for (const payment of customerPayments) {
    const invoice = invoicesById.get(payment.invoiceId);
    if (!invoice || getInvoiceDirection(invoice) !== "customer"
      || invoice.status === "draft" || invoice.status === "cancelled"
      || !validDate(payment.paymentDate) || !Number.isFinite(payment.amount) || payment.amount <= 0
      || !invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)) continue;
    movements.push({
      id: payment.id ?? `invoice-payment:${payment.invoiceId}:${payment.paymentDate}:${movements.length}`,
      userId: invoice.userId,
      companyId: invoice.companyId,
      date: payment.paymentDate,
      direction: "inflow",
      description: invoice.invoiceNumber || invoice.description || "Facture client",
      counterparty: invoice.customerId
        ? counterpartyNames[invoice.customerId] ?? "Client associé"
        : invoice.clientName || "Client non renseigné",
      amount: payment.amount,
      currency: invoice.currency,
      href: `/invoices#invoice-${invoice.id}`,
    });
  }

  for (const payment of expensePayments) {
    const expense = expensesById.get(payment.expenseId);
    if (!expense || expense.status === "cancelled" || !validDate(payment.paymentDate)
      || !Number.isFinite(payment.amount) || payment.amount <= 0) continue;
    const linkedInvoice = expense.invoiceId ? invoicesById.get(expense.invoiceId) : undefined;
    if (linkedInvoice?.status === "cancelled") continue;
    const currency = linkedInvoice && getInvoiceDirection(linkedInvoice) === "supplier"
      ? linkedInvoice.currency
      : expense.currency;
    if (!currency || !/^[A-Z]{3}$/.test(currency)) continue;
    movements.push({
      id: payment.id ?? `expense-payment:${payment.expenseId}:${payment.paymentDate}:${movements.length}`,
      userId: expense.userId,
      companyId: expense.companyId,
      date: payment.paymentDate,
      direction: "outflow",
      description: linkedInvoice?.invoiceNumber || expense.label,
      counterparty: expense.supplierId
        ? counterpartyNames[expense.supplierId] ?? "Fournisseur associé"
        : linkedInvoice?.clientName || "Tiers non renseigné",
      amount: payment.amount,
      currency,
      href: linkedInvoice
        ? `/invoices#invoice-${linkedInvoice.id}`
        : "/expenses",
    });
  }

  return movements.sort((left, right) => right.date.localeCompare(left.date));
}

export function addTreasuryBalanceToSeries(
  series: DashboardCashflowSeries,
  openingBalance: TreasuryOpeningBalance | null,
  movements: readonly TreasuryMovement[],
  periodEndDate: string,
  paymentHistoryAvailable: boolean,
): DashboardCashflowSeries {
  if (!openingBalance || !paymentHistoryAvailable || !validDate(openingBalance.date)
    || !validDate(periodEndDate) || !Number.isFinite(openingBalance.amount)
    || openingBalance.currency !== series.currency) {
    return { ...series, buckets: series.buckets.map((bucket) => ({ ...bucket, balance: null })) };
  }

  const currencyMovements = movements
    .filter((movement) => movement.currency === series.currency
      && movement.date > openingBalance.date
      && movement.date <= periodEndDate)
    .sort((left, right) => left.date.localeCompare(right.date));
  let movementIndex = 0;
  let balanceCents = Math.round(openingBalance.amount * 100);
  return {
    ...series,
    buckets: series.buckets.map((bucket, index) => {
      const nextDate = series.buckets[index + 1]?.date ?? addDays(periodEndDate, 1);
      if (nextDate <= openingBalance.date) return { ...bucket, balance: null };
      while (movementIndex < currencyMovements.length
        && currencyMovements[movementIndex]!.date < nextDate) {
        const movement = currencyMovements[movementIndex]!;
        const cents = Math.round(movement.amount * 100);
        balanceCents += movement.direction === "inflow" ? cents : -cents;
        movementIndex += 1;
      }
      return { ...bucket, balance: balanceCents / 100 };
    }),
  };
}
