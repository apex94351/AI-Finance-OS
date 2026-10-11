"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  FileText,
  ReceiptText,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import {
  buildDashboardCockpit,
  resolveDashboardDateRange,
  type DashboardChartInterval,
  type DashboardPeriod,
} from "@/services/dashboard";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceCompany, InvoiceRecord, InvoiceStatus } from "@/types/invoice";

interface DashboardClientProps {
  invoices: InvoiceRecord[];
  expenses?: ExpenseRecord[];
  companies?: Pick<InvoiceCompany, "id" | "name" | "currency">[];
  counterpartyNames?: Record<string, string>;
  partyLinksAvailable?: boolean;
  loadError: string | null;
  expensesLoadError?: string | null;
  partialDataWarning?: string | null;
  asOfDate: string;
}

const periods: Array<{ key: Exclude<DashboardPeriod, "custom">; label: string }> = [
  { key: "7d", label: "7 jours" },
  { key: "1m", label: "1 mois" },
  { key: "3m", label: "3 mois" },
  { key: "6m", label: "6 mois" },
  { key: "1y", label: "1 an" },
];

function currencyFormat(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function chartAxisFormat(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function chartDateFormat(value: string, interval: DashboardChartInterval) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return new Intl.DateTimeFormat("fr-FR", interval === "month"
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}

function formatTotals(totals: Array<{ currency: string; amount: number }>) {
  return totals.length
    ? totals.map(({ amount, currency }) => currencyFormat(amount, currency)).join(" · ")
    : "—";
}

function dateFormat(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date à vérifier";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.toISOString().slice(0, 10) !== value) return "Date à vérifier";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateHeading(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date indisponible";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.toISOString().slice(0, 10) !== value) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dueDescription(dueDate: string | null, asOfDate: string) {
  if (!dueDate) return "Échéance absente";
  const difference = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(difference)) return "Date à vérifier";
  if (difference < 0) return `En retard de ${Math.abs(difference)} jour${difference === -1 ? "" : "s"}`;
  if (difference === 0) return "Aujourd’hui";
  return `Dans ${difference} jour${difference === 1 ? "" : "s"}`;
}

function counterpartyLabel(invoice: InvoiceRecord, names: Record<string, string>) {
  if (invoice.customerId) return names[invoice.customerId] ?? "Client associé";
  if (invoice.supplierId) return names[invoice.supplierId] ?? "Fournisseur associé";
  return invoice.clientName || "Tiers non renseigné";
}

function statusLabel(status: InvoiceStatus) {
  switch (status) {
    case "draft": return "Brouillon";
    case "pending": return "À payer";
    case "paid": return "Payée";
    case "overdue": return "En retard";
    case "receivable": return "À encaisser";
    case "cancelled": return "Annulée";
  }
}

function statusTone(status: InvoiceStatus): "neutral" | "success" | "warning" | "danger" {
  if (status === "paid" || status === "receivable") return "success";
  if (status === "overdue") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function invoiceTotals(invoices: InvoiceRecord[]) {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (!invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)
      || invoice.total === null || !Number.isFinite(invoice.total) || invoice.total <= 0) continue;
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + Math.round(invoice.total * 100));
  }
  return formatTotals([...totals].map(([currency, cents]) => ({ currency, amount: cents / 100 })));
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: string;
}) {
  return (
    <Link href={href} className="kpi-card dashboard-metric" aria-label={`${label}: ${value}. ${hint}`}>
      <div className="kpi-card-top"><span className={`kpi-icon ${tone}`}><Icon size={18} /></span></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </Link>
  );
}

export function DashboardClient({
  invoices,
  expenses = [],
  companies = [],
  counterpartyNames = {},
  partyLinksAvailable = true,
  loadError,
  expensesLoadError = null,
  partialDataWarning = null,
  asOfDate,
}: DashboardClientProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [period, setPeriod] = useState<DashboardPeriod>("1m");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(asOfDate);
  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => ownerFilter === "all"
      || (ownerFilter === "personal" ? invoice.companyId === null : invoice.companyId === ownerFilter)),
    [invoices, ownerFilter],
  );
  const visibleExpenses = useMemo(
    () => expenses.filter((expense) => ownerFilter === "all"
      || (ownerFilter === "personal" ? expense.companyId === null : expense.companyId === ownerFilter)),
    [expenses, ownerFilter],
  );
  const range = useMemo(
    () => resolveDashboardDateRange(period, asOfDate, customStart, customEnd),
    [asOfDate, customEnd, customStart, period],
  );
  const cockpit = useMemo(
    () => buildDashboardCockpit(visibleInvoices, visibleExpenses, range, asOfDate),
    [asOfDate, range, visibleExpenses, visibleInvoices],
  );
  const overdueAmount = useMemo(() => invoiceTotals(cockpit.overdueCustomerInvoices), [cockpit.overdueCustomerInvoices]);
  const allOverdueAmount = useMemo(() => invoiceTotals(cockpit.overdueInvoices), [cockpit.overdueInvoices]);
  const supplierUpcomingAmount = useMemo(() => invoiceTotals(cockpit.upcomingSupplierInvoices), [cockpit.upcomingSupplierInvoices]);
  const selectedPeriodLabel = period === "custom"
    ? range.valid ? `${dateFormat(range.startDate)} – ${dateFormat(range.endDate)}` : "Période à vérifier"
    : periods.find(({ key }) => key === period)?.label ?? "1 mois";

  return (
    <>
      <div className="page-intro dashboard-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Vue de pilotage</span></div>
          <h1>Dashboard</h1>
          <p>Situation financière de vos espaces accessibles.</p>
          <time className="dashboard-current-date" dateTime={asOfDate}>{dateHeading(asOfDate)}</time>
        </div>
        <div className="dashboard-header-actions">
          {companies.length ? (
            <label className="dashboard-company-filter">
              <span className="sr-only">Filtrer le Dashboard par espace</span>
              <select aria-label="Filtrer le Dashboard par espace" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : null}
          <Link className="text-button" href="/due-dates"><CalendarClock size={16} />Voir les échéances</Link>
        </div>
      </div>
      {loadError ? (
        <div className="dashboard-load-error">
          <p className="auth-message is-error invoice-message" role="alert">{loadError}</p>
          <button className="text-button" type="button" disabled={isRefreshing} onClick={() => startRefresh(() => router.refresh())}>
            <RefreshCw size={15} className={isRefreshing ? "dashboard-refreshing" : ""} />
            {isRefreshing ? "Actualisation…" : "Réessayer"}
          </button>
        </div>
      ) : null}
      {partialDataWarning && !loadError ? <p className="dashboard-partial-warning" role="status">{partialDataWarning}</p> : null}

      <section className="dashboard-kpis" aria-label="Indicateurs financiers">
        <Metric icon={ArrowDownLeft} label="À encaisser" value={loadError || !partyLinksAvailable ? "—" : formatTotals(cockpit.receivableTotals)} hint={partyLinksAvailable ? "Solde à date selon le statut des factures clients" : "Liens clients indisponibles dans le schéma chargé"} href={partyLinksAvailable ? "/invoices?dashboardFilter=customer-open" : "/invoices"} tone="green" />
        <Metric icon={ArrowUpRight} label="À payer" value={loadError || !partyLinksAvailable ? "—" : formatTotals(cockpit.payableTotals)} hint={partyLinksAvailable ? "Solde à date selon le statut des factures fournisseurs" : "Liens fournisseurs indisponibles dans le schéma chargé"} href={partyLinksAvailable ? "/invoices?dashboardFilter=supplier-open" : "/invoices"} tone="blue" />
        <Metric icon={ReceiptText} label="Facturé sur la période" value={loadError || !range.valid || !partyLinksAvailable ? "—" : formatTotals(cockpit.invoicedTotals)} hint={`Factures clients émises · ${selectedPeriodLabel}`} href={partyLinksAvailable ? "/invoices?dashboardFilter=customer-invoices" : "/invoices"} tone="purple" />
        <Metric icon={WalletCards} label="Dépenses enregistrées" value={expensesLoadError || !range.valid ? "—" : formatTotals(cockpit.expenseTotals)} hint={`Dépenses non annulées · ${selectedPeriodLabel} (pas un relevé bancaire)`} href="/expenses" tone="orange" />
      </section>
      <p className="dashboard-note dashboard-data-limit">
        Les règlements partiels ne sont pas enregistrés sur les factures : les soldes reprennent le total des factures actives et excluent celles marquées payées ou annulées.
      </p>

      <section className="surface-panel dashboard-section-panel dashboard-period-panel" aria-labelledby="dashboard-period-heading">
        <div className="dashboard-section-heading">
          <div><span className="panel-kicker">Analyse temporelle</span><h2 id="dashboard-period-heading">Évolution financière</h2></div>
          <span className="coming-soon-pill">{selectedPeriodLabel}</span>
        </div>
        <div className="dashboard-period-controls" aria-label="Période du Dashboard">
          {periods.map(({ key, label }) => (
            <button key={key} className={`deadline-filter-button ${period === key ? "is-active" : ""}`} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>
          ))}
          <button className={`deadline-filter-button ${period === "custom" ? "is-active" : ""}`} type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")}>Personnalisée</button>
        </div>
        {period === "custom" ? (
          <div className="dashboard-custom-period">
            <label><span>Du</span><input aria-label="Date de début personnalisée" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label><span>Au</span><input aria-label="Date de fin personnalisée" type="date" value={customEnd} min={customStart || undefined} max={asOfDate} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </div>
        ) : null}
        {!range.valid ? <p className="dashboard-empty-message" role="alert">Sélectionnez une période de dates valide.</p> : null}
        {expensesLoadError ? <p className="dashboard-empty-message" role="alert">{expensesLoadError}</p> : null}
        {!expensesLoadError && range.valid && cockpit.paidExpenseSeries.length ? (
          <div className="dashboard-chart-wrap">
            {cockpit.paidExpenseSeries.map(({ currency, interval, buckets }) => (
              <div className="dashboard-chart-series" key={currency}>
                <h3>{currency}</h3>
                <ExpenseChart buckets={buckets} currency={currency} interval={interval} />
              </div>
            ))}
            <p className="dashboard-chart-legend"><span />Dépenses enregistrées comme payées, regroupées par date de dépense et devise.</p>
          </div>
        ) : null}
        {!expensesLoadError && range.valid && cockpit.paidExpenseSeries.length === 0 ? (
          <p className="dashboard-empty-message">Aucune dépense marquée comme payée sur cette période pour afficher une série de mouvements.</p>
        ) : null}
        <p className="dashboard-note">
          Aucun journal de règlements clients/fournisseurs ni solde initial bancaire n’est disponible. Les encaissements et le solde bancaire ne sont donc pas tracés. Les factures fournisseurs ne sont pas additionnées aux dépenses pour éviter un double comptage.
        </p>
      </section>

      <section className="dashboard-priorities-grid" aria-label="À traiter en priorité">
        <Link className="surface-panel dashboard-priority-card" href={partyLinksAvailable ? "/invoices?dashboardFilter=customer-overdue" : "/invoices"}>
          <span className="dashboard-priority-card-icon danger"><CircleAlert size={18} /></span>
          <span className="dashboard-priority-card-title">Factures clients en retard</span>
          <strong>{loadError || !partyLinksAvailable ? "—" : cockpit.overdueCustomerInvoices.length}</strong>
          <small>{loadError ? "Données indisponibles" : !partyLinksAvailable ? "Liens client indisponibles pour identifier les factures concernées." : `${overdueAmount} restant selon les statuts · échéance dépassée`}</small>
          <span className="text-button">Voir toutes les factures en retard</span>
        </Link>
        <Link className="surface-panel dashboard-priority-card" href={partyLinksAvailable ? "/invoices?dashboardFilter=supplier-upcoming" : "/invoices"}>
          <span className="dashboard-priority-card-icon warning"><Clock3 size={18} /></span>
          <span className="dashboard-priority-card-title">Paiements fournisseurs à venir</span>
          <strong>{loadError || !partyLinksAvailable ? "—" : cockpit.upcomingSupplierInvoices.length}</strong>
          <small>{loadError ? "Données indisponibles" : !partyLinksAvailable ? "Liens fournisseur indisponibles pour identifier les factures concernées." : `${supplierUpcomingAmount} · échéances dans les 30 jours`}</small>
          <span className="text-button">Voir les paiements à venir</span>
        </Link>
        <Link className="surface-panel dashboard-priority-card" href="/documents">
          <span className="dashboard-priority-card-icon neutral"><FileText size={18} /></span>
          <span className="dashboard-priority-card-title">Documents à vérifier</span>
          <strong>Non disponible</strong>
          <small>L’extraction est temporaire et son état de vérification n’est pas enregistré.</small>
          <span className="text-button">Ouvrir les documents</span>
        </Link>
      </section>

      <section className="surface-panel dashboard-section-panel dashboard-schedule-panel" aria-labelledby="dashboard-schedule-heading">
        <div className="dashboard-section-heading">
          <div><span className="panel-kicker">Agenda</span><h2 id="dashboard-schedule-heading">Échéances</h2></div>
          <Link href="/due-dates" className="text-button">Liste complète</Link>
        </div>
        <div className="dashboard-schedule-grid">
          <article aria-labelledby="dashboard-overdue-heading">
            <div className="dashboard-schedule-heading">
              <h3 id="dashboard-overdue-heading"><Link href="/invoices?dashboardFilter=all-overdue">Factures en retard</Link></h3>
              <span>{loadError ? "—" : `${cockpit.overdueInvoices.length} · ${allOverdueAmount}`}</span>
            </div>
            {loadError ? <p className="dashboard-empty-message">Les échéances sont indisponibles.</p> : cockpit.overdueInvoices.length ? (
              <div className="dashboard-upcoming-list">
                {cockpit.overdueInvoices.slice(0, 5).map((invoice) => (
                  <InvoiceDueLink
                    key={invoice.id}
                    invoice={invoice}
                    names={counterpartyNames}
                    asOfDate={asOfDate}
                    direction={invoice.supplierId ? "Paiement à effectuer" : invoice.customerId || partyLinksAvailable ? "Encaissement attendu" : "Direction à confirmer"}
                  />
                ))}
              </div>
            ) : <p className="dashboard-empty-message">Aucune facture en retard.</p>}
          </article>
          <article aria-labelledby="dashboard-upcoming-heading">
            <div className="dashboard-schedule-heading">
              <h3 id="dashboard-upcoming-heading"><Link href="/due-dates">Échéances proches</Link></h3>
            </div>
            {loadError ? <p className="dashboard-empty-message">Les échéances sont indisponibles.</p> : cockpit.upcomingInvoices.length ? (
              <div className="dashboard-upcoming-list">
                {cockpit.upcomingInvoices.slice(0, 8).map((invoice) => (
                  <InvoiceDueLink
                    key={invoice.id}
                    invoice={invoice}
                    names={counterpartyNames}
                    asOfDate={asOfDate}
                    direction={invoice.supplierId ? "Paiement à effectuer" : invoice.customerId || partyLinksAvailable ? "Encaissement attendu" : "Direction à confirmer"}
                  />
                ))}
              </div>
            ) : <p className="dashboard-empty-message">Aucune échéance active dans les 30 prochains jours.</p>}
          </article>
        </div>
      </section>
    </>
  );
}

function InvoiceDueLink({
  invoice,
  names,
  asOfDate,
  direction,
}: {
  invoice: InvoiceRecord;
  names: Record<string, string>;
  asOfDate: string;
  direction: string;
}) {
  return (
    <Link className="dashboard-upcoming-item" href={`/invoices#invoice-${invoice.id}`}>
      <span className="dashboard-upcoming-date">{dateFormat(invoice.dueDate)}</span>
      <span className="dashboard-upcoming-copy">
        <strong>{counterpartyLabel(invoice, names)}</strong>
        <small>{invoice.invoiceNumber || "Facture sans numéro"} · {direction}</small>
        <small>{dueDescription(invoice.dueDate, asOfDate)}</small>
      </span>
      <span className="dashboard-upcoming-value">
        <strong>{invoice.total === null || !invoice.currency ? "Montant à vérifier" : currencyFormat(invoice.total, invoice.currency)}</strong>
        <Badge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Badge>
      </span>
    </Link>
  );
}

function ExpenseChart({
  buckets,
  currency,
  interval,
}: {
  buckets: Array<{ date: string; amount: number }>;
  currency: string;
  interval: DashboardChartInterval;
}) {
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 40, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxAmount = Math.max(...buckets.map(({ amount }) => amount), 0);
  const safeMax = maxAmount || 1;
  const slotWidth = chartWidth / buckets.length;
  const barWidth = Math.min(32, slotWidth * 0.62);

  return (
    <div className="dashboard-chart-scroll">
      <svg className="dashboard-expense-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dépenses enregistrées comme payées par date">
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + chartHeight * fraction;
          return <g key={fraction}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="dashboard-chart-gridline" /><text x={padding.left - 7} y={y + 4} textAnchor="end" className="dashboard-chart-axis">{chartAxisFormat(maxAmount * (1 - fraction), currency)}</text></g>;
        })}
        {buckets.map(({ date, amount }, index) => {
          const barHeight = chartHeight * amount / safeMax;
          const x = padding.left + slotWidth * index + (slotWidth - barWidth) / 2;
          const y = padding.top + chartHeight - barHeight;
          return (
            <g key={date}>
              {amount > 0 ? (
                <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx="4" className="dashboard-chart-bar">
                  <title>{`${dateFormat(date)} · ${currencyFormat(amount, currency)}`}</title>
                </rect>
              ) : null}
              {(buckets.length < 9 || index % Math.ceil(buckets.length / 8) === 0 || index === buckets.length - 1) ? (
                <text x={padding.left + slotWidth * index + slotWidth / 2} y={height - 13} textAnchor="middle" className="dashboard-chart-axis">{chartDateFormat(date, interval)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
