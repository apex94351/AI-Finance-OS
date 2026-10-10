import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";

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

const activeStatuses: InvoiceStatus[] = ["pending", "receivable", "overdue"];
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
    if (invoice.status === "draft") {
      actions.push({
        invoice,
        kind: "draft",
        daysUntilDue: null,
        reason: "Brouillon à finaliser",
      });
      continue;
    }
    if (!activeStatuses.includes(invoice.status)) continue;
    toProcessCount += 1;

    if (invoice.status === "pending") addCurrencyTotal(payableTotals, invoice);
    if (invoice.status === "receivable") addCurrencyTotal(receivableTotals, invoice);

    const dueDay = dateOrdinal(invoice.dueDate);
    if (dueDay === null || today === null) {
      actions.push({ invoice, kind: "verify", daysUntilDue: null, reason: "Date d’échéance absente ou invalide" });
      continue;
    }

    const daysUntilDue = dueDay - today;
    if (daysUntilDue < 0) {
      addCurrencyTotal(overdueTotals, invoice);
      const reason = invoice.total === null || !Number.isFinite(invoice.total) || !invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)
        ? "Échéance dépassée · montant ou devise à vérifier"
        : "Échéance dépassée";
      actions.push({ invoice, kind: "overdue", daysUntilDue, reason });
      continue;
    }

    upcoming.push(invoice);
    if (daysUntilDue <= 7) upcomingCount += 1;

    const verificationReasons: string[] = [];
    if (invoice.status === "overdue") {
      verificationReasons.push("Statut « en retard » incohérent avec la date d’échéance");
    }
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
