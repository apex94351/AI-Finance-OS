import { buildDashboardSummary, type DashboardAction } from "@/services/dashboard";
import { getInvoiceRemainingAmount } from "@/services/invoice-validation";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceCompany, InvoiceRecord } from "@/types/invoice";

export interface CFOCurrencySummary {
  currency: string;
  amount: number;
}

export interface CFOExpenseSummary {
  currency: string;
  total: number;
  pending: number;
  paid: number;
}

export interface CFORecommendation {
  id: string;
  priority: "urgent" | "soon" | "review" | "routine";
  title: string;
  explanation: string;
  evidence: string;
  href: string;
}

export interface CFOAnalysis {
  overdue: DashboardAction[];
  upcoming: DashboardAction[];
  unpaidCount: number;
  paidCount: number;
  paidTotals: CFOCurrencySummary[];
  pendingTotals: CFOCurrencySummary[];
  receivableTotals: CFOCurrencySummary[];
  overdueTotals: CFOCurrencySummary[];
  expenseSummaries: CFOExpenseSummary[];
  recommendations: CFORecommendation[];
  risks: DashboardAction[];
}

function totalsByCurrency(
  entries: readonly { amount: number | null; currency: string | null }[],
): CFOCurrencySummary[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.amount === null || !Number.isFinite(entry.amount)
      || !entry.currency || !/^[A-Z]{3}$/.test(entry.currency)) continue;
    const cents = Math.round(entry.amount * 100);
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + cents);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }));
}

function invoiceEvidence(action: DashboardAction): string {
  const identifier = action.invoice.invoiceNumber || `Facture ${action.invoice.id.slice(0, 8)}`;
  const date = action.invoice.dueDate ? ` · échéance ${action.invoice.dueDate}` : "";
  return `${identifier}${date} · ${action.reason}`;
}

function buildRecommendations(actions: readonly DashboardAction[]): CFORecommendation[] {
  return actions.map((action) => {
    const invoice = action.invoice;
    const overdue = action.kind === "overdue";
    const upcoming = action.kind === "upcoming";
    const priority: CFORecommendation["priority"] = overdue
      ? "urgent"
      : upcoming ? "soon" : action.kind === "verify" ? "review" : "routine";
    const title = overdue
      ? "Vérifier une échéance dépassée"
      : upcoming ? "Préparer une échéance proche"
        : action.kind === "draft" ? "Finaliser un brouillon"
          : "Vérifier les données de la facture";
    const explanation = overdue
      ? "La date d’échéance enregistrée est passée et la facture n’est ni réglée, ni annulée, ni en brouillon. Vérifiez son statut et décidez de la suite."
      : upcoming ? "La facture active arrive à échéance dans les sept prochains jours."
        : action.kind === "draft" ? "Cette facture est explicitement enregistrée comme brouillon et n’est pas comptée parmi les échéances actives."
          : "Les données enregistrées signalent un point à vérifier ; aucun montant ou sens de paiement n’est supposé.";
    return {
      id: invoice.id,
      priority,
      title,
      explanation,
      evidence: invoiceEvidence(action),
      href: `/invoices#invoice-${invoice.id}`,
    };
  });
}

export function buildCFOAnalysis(
  invoices: readonly InvoiceRecord[],
  expenses: readonly ExpenseRecord[],
  asOfDate: string,
): CFOAnalysis {
  const summary = buildDashboardSummary([...invoices], asOfDate);
  const overdue = summary.alerts.filter((action) => action.kind === "overdue");
  const upcoming = summary.alerts.filter((action) => action.kind === "upcoming");
  const activeInvoices = invoices.filter((invoice) => (
    ["pending", "receivable", "overdue"].includes(invoice.status)
      && (getInvoiceRemainingAmount(invoice.total, invoice.paidAmount, invoice.status) ?? 0) > 0
  ));
  const paidInvoices = invoices.filter((invoice) => invoice.status === "paid"
    || getInvoiceRemainingAmount(invoice.total, invoice.paidAmount, invoice.status) === 0);

  const expenseCurrencies = new Map<string, { total: number; pending: number; paid: number }>();
  for (const expense of expenses) {
    if (expense.status === "cancelled" || !/^[A-Z]{3}$/.test(expense.currency)
      || !Number.isFinite(expense.amount)) continue;
    const bucket = expenseCurrencies.get(expense.currency) ?? { total: 0, pending: 0, paid: 0 };
    const cents = Math.round(expense.amount * 100);
    bucket.total += cents;
    if (expense.status === "pending") bucket.pending += cents;
    if (expense.status === "paid") bucket.paid += cents;
    expenseCurrencies.set(expense.currency, bucket);
  }

  return {
    overdue,
    upcoming,
    unpaidCount: activeInvoices.length,
    paidCount: paidInvoices.length,
    paidTotals: totalsByCurrency(paidInvoices.map((invoice) => ({
      amount: invoice.paidAmount ?? (invoice.status === "paid" ? invoice.total : 0),
      currency: invoice.currency,
    }))),
    pendingTotals: summary.payableTotals,
    receivableTotals: summary.receivableTotals,
    overdueTotals: summary.overdueTotals,
    expenseSummaries: [...expenseCurrencies]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => ({
        currency,
        total: totals.total / 100,
        pending: totals.pending / 100,
        paid: totals.paid / 100,
      })),
    recommendations: buildRecommendations(summary.alerts),
    risks: summary.alerts.filter((action) => action.kind === "verify" || action.kind === "overdue"),
  };
}

export function filterCFOData<T extends { companyId: string | null }>(
  records: readonly T[],
  owner: "all" | "personal" | string,
): T[] {
  if (owner === "all") return [...records];
  return records.filter((record) => owner === "personal"
    ? record.companyId === null
    : record.companyId === owner);
}

export function getCFOCompanyOptions(companies: readonly InvoiceCompany[]) {
  return companies.map(({ id, name }) => ({ id, name }));
}
