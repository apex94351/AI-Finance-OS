"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { locales, messages, type Locale } from "@/i18n/messages";
import { buildDashboardSummary, type CurrencyTotal, type DashboardAction } from "@/services/dashboard";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";
import type { InvoiceCompany, InvoiceRecord, InvoiceStatus } from "@/types/invoice";

interface DashboardClientProps {
  invoices: InvoiceRecord[];
  companies?: Pick<InvoiceCompany, "id" | "name">[];
  counterpartyNames?: Record<string, string>;
  loadError: string | null;
  partialDataWarning?: string | null;
  asOfDate: string;
}

function currencyFormat(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
}

function formatTotals(totals: CurrencyTotal[]) {
  return totals.length
    ? totals.map(({ amount, currency }) => currencyFormat(amount, currency)).join(" · ")
    : "—";
}

function dateFormat(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date à vérifier";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return "Date à vérifier";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function daysLabel(days: number | null) {
  if (days === null) return "Date manquante";
  if (days < 0) {
    const lateDays = Math.abs(days);
    return `En retard de ${lateDays} jour${lateDays === 1 ? "" : "s"}`;
  }
  if (days === 0) return "Aujourd’hui";
  return `Dans ${days} jour${days === 1 ? "" : "s"}`;
}

function statusTone(status: InvoiceStatus): "neutral" | "success" | "warning" | "danger" {
  if (status === "paid" || status === "receivable") return "success";
  if (status === "overdue") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function actionTitle(action: DashboardAction) {
  switch (action.kind) {
    case "overdue": return "Échéance dépassée";
    case "upcoming": return "Échéance proche";
    case "verify": return "Vérification requise";
    case "draft": return "Brouillon à finaliser";
  }
}

function actionIcon(action: DashboardAction) {
  switch (action.kind) {
    case "overdue": return AlertTriangle;
    case "upcoming": return Clock3;
    case "verify": return ShieldAlert;
    case "draft": return FileCheck2;
  }
}

function counterpartyLabel(invoice: InvoiceRecord, names: Record<string, string>) {
  if (invoice.customerId) return names[invoice.customerId] ?? "Client associé";
  if (invoice.supplierId) return names[invoice.supplierId] ?? "Fournisseur associé";
  return invoice.clientName || "Tiers non renseigné";
}

function counterpartyKind(invoice: InvoiceRecord) {
  if (invoice.customerId) return "Client";
  if (invoice.supplierId) return "Fournisseur";
  return "Tiers enregistré";
}

function dateHeading(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date indisponible";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function DashboardClient({
  invoices,
  companies = [],
  counterpartyNames = {},
  loadError,
  partialDataWarning = null,
  asOfDate,
}: DashboardClientProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return "fr";
    const stored = localStorage.getItem("ai-finance-locale") as Locale | null;
    return stored && locales.includes(stored) ? stored : "fr";
  });
  const copy = messages[locale];
  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => ownerFilter === "all"
      || (ownerFilter === "personal" ? invoice.companyId === null : invoice.companyId === ownerFilter)),
    [invoices, ownerFilter],
  );
  const summary = useMemo(() => buildDashboardSummary(visibleInvoices, asOfDate), [asOfDate, visibleInvoices]);

  useEffect(() => {
    const syncLocale = (event: StorageEvent) => {
      if (event.key === "ai-finance-locale" && event.newValue && locales.includes(event.newValue as Locale)) {
        setLocale(event.newValue as Locale);
      }
    };
    const syncInWorkspace = (event: Event) => {
      const nextLocale = (event as CustomEvent<Locale>).detail;
      if (locales.includes(nextLocale)) setLocale(nextLocale);
    };
    window.addEventListener("storage", syncLocale);
    window.addEventListener("ai-finance-locale-change", syncInWorkspace);
    return () => {
      window.removeEventListener("storage", syncLocale);
      window.removeEventListener("ai-finance-locale-change", syncInWorkspace);
    };
  }, []);

  return (
    <>
      <div className="page-intro dashboard-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>{visibleInvoices.length ? "Données de votre espace" : "Espace financier"}</span></div>
          <h1>{copy.nav.home}</h1>
          <p>{copy.dashboard.subtitle}</p>
          <time className="dashboard-current-date" dateTime={asOfDate}>{dateHeading(asOfDate)}</time>
        </div>
        <div className="dashboard-header-actions">
          {companies.length ? (
            <label className="dashboard-company-filter">
              <span className="sr-only">Filtrer l’accueil par espace</span>
              <select aria-label="Filtrer l’accueil par espace" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : null}
          <Link className="text-button" href="/alerts"><BellRing size={16} />Voir les alertes</Link>
          <Link className="text-button dashboard-due-link" href="/due-dates"><CalendarClock size={16} />Voir toutes les échéances</Link>
        </div>
      </div>
      {loadError ? (
        <div className="dashboard-load-error">
          <p className="auth-message is-error invoice-message" role="alert">{loadError}</p>
          <button
            className="text-button"
            type="button"
            disabled={isRefreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCw size={15} className={isRefreshing ? "dashboard-refreshing" : ""} />
            {isRefreshing ? "Actualisation…" : "Réessayer"}
          </button>
        </div>
      ) : null}
      {partialDataWarning && !loadError ? <p className="dashboard-partial-warning" role="status">{partialDataWarning}</p> : null}

      {visibleInvoices.length === 0 && !loadError ? (
        <div className="demo-notice"><FileText size={16} /><span>{invoices.length
          ? "Aucune facture enregistrée dans cet espace."
          : "Aucune facture enregistrée. Le tableau de bord affichera vos indicateurs dès que des données seront disponibles."}</span></div>
      ) : null}

      <section className="dashboard-kpis" aria-label="Résumé financier">
        <Metric icon={ArrowDownLeft} label="À recevoir" value={loadError ? "—" : formatTotals(summary.receivableTotals)} hint="Factures explicitement marquées à recevoir" tone="green" />
        <Metric icon={ArrowUpRight} label="À payer" value={loadError ? "—" : formatTotals(summary.payableTotals)} hint="Factures explicitement marquées à payer" tone="blue" />
        <Metric icon={CircleAlert} label="Échéances en retard" value={loadError ? "—" : formatTotals(summary.overdueTotals)} hint="Retard calculé par rapport à la date limite" tone="orange" />
        <Metric icon={CalendarClock} label="À traiter / bientôt" value={loadError ? "—" : `${summary.toProcessCount} / ${summary.upcomingCount}`} hint="Factures actives / échéances dans les 7 jours" tone="purple" />
      </section>

      <section className="dashboard-main-grid">
        <article className="surface-panel dashboard-section-panel" aria-labelledby="dashboard-actions-heading">
          <div className="dashboard-section-heading">
            <div><span className="panel-kicker">Priorités</span><h2 id="dashboard-actions-heading">Que dois-je faire maintenant ?</h2></div>
            <span className="coming-soon-pill">{loadError ? "—" : `${summary.actions.length} action${summary.actions.length === 1 ? "" : "s"}`}</span>
          </div>
          {summary.actions.length ? (
            <div className="dashboard-priority-list">
              {summary.actions.map((action, index) => {
                const Icon = actionIcon(action);
                const tone = action.kind === "overdue" ? "danger" : action.kind === "upcoming" ? "warning" : "neutral";
                return (
                  <article className={`dashboard-priority-item priority-${action.kind}`} key={`${action.invoice.id}-${action.kind}-${index}`}>
                    <span className={`dashboard-priority-icon ${tone}`}><Icon size={17} /></span>
                    <div className="dashboard-priority-copy">
                      <strong>{actionTitle(action)}</strong>
                      <span>{counterpartyKind(action.invoice)} · {counterpartyLabel(action.invoice, counterpartyNames)} · {action.invoice.invoiceNumber || "Facture sans numéro"}</span>
                      <small>{action.kind === "draft"
                        ? action.invoice.dueDate
                          ? `${action.reason} · Échéance enregistrée le ${dateFormat(action.invoice.dueDate)}`
                          : action.reason
                        : `${action.reason} · ${daysLabel(action.daysUntilDue)}`}</small>
                      <small>{formatInvoiceTotal(action.invoice.total, action.invoice.currency)}</small>
                    </div>
                    <Link href={`/invoices#invoice-${action.invoice.id}`} className="text-button">Ouvrir</Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="dashboard-empty-message">{loadError ? "Les priorités sont indisponibles tant que les données ne sont pas chargées." : "Aucune action urgente détectée dans les factures accessibles."}</p>
          )}
        </article>

        <article className="surface-panel dashboard-section-panel" aria-labelledby="dashboard-upcoming-heading">
          <div className="dashboard-section-heading">
            <div><span className="panel-kicker">Calendrier</span><h2 id="dashboard-upcoming-heading">Prochaines échéances</h2></div>
            <Link href="/due-dates" className="text-button">Tout voir</Link>
          </div>
          {summary.upcoming.length ? (
            <div className="dashboard-upcoming-list">
              {summary.upcoming.map((invoice) => {
                const dayDifference = daysBetween(asOfDate, invoice.dueDate);
                return (
                  <Link className="dashboard-upcoming-item" href={`/invoices#invoice-${invoice.id}`} key={invoice.id}>
                    <span className="dashboard-upcoming-date">{dateFormat(invoice.dueDate)}</span>
                    <span className="dashboard-upcoming-copy">
                      <strong>{counterpartyLabel(invoice, counterpartyNames)}</strong>
                      <small>{invoice.invoiceNumber || "Facture sans numéro"} · {dayDifference === null ? "Date à vérifier" : daysLabel(dayDifference)}</small>
                      <small>{counterpartyKind(invoice)} · {getInvoiceStatusLabel(invoice.status)}</small>
                    </span>
                    <span className="dashboard-upcoming-value">
                      <strong>{formatInvoiceTotal(invoice.total, invoice.currency)}</strong>
                      <Badge tone={invoice.status === "overdue" ? "danger" : statusTone(invoice.status)}>
                        {invoice.status === "overdue" ? "À vérifier" : getInvoiceStatusLabel(invoice.status)}
                      </Badge>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="dashboard-empty-message">{loadError ? "Les échéances sont indisponibles tant que les données ne sont pas chargées." : "Aucune échéance future active."}</p>
          )}
          {summary.upcoming.some((invoice) => invoice.status === "overdue") ? (
            <p className="dashboard-note">Le statut « en retard » et une échéance future sont incohérents; vérifiez ces factures.</p>
          ) : null}
        </article>
      </section>

      <section className="surface-panel dashboard-activity-panel" aria-labelledby="dashboard-activity-heading">
        <div className="dashboard-section-heading">
          <div><span className="panel-kicker">Activité récente</span><h2 id="dashboard-activity-heading">Factures créées ou mises à jour</h2></div>
          <Link href="/invoices" className="text-button">Ouvrir les factures</Link>
        </div>
        <p className="dashboard-note">Aperçu fondé sur les horodatages des factures, pas sur un journal complet. La date de paiement n’étant pas enregistrée, les paiements ne sont pas ventilés par période.</p>
        {summary.recent.length ? (
          <div className="dashboard-activity-list">
            {summary.recent.map((invoice) => {
              const created = Date.parse(invoice.createdAt);
              const updated = Date.parse(invoice.updatedAt);
              const modified = Number.isFinite(created) && Number.isFinite(updated) && updated > created + 1000;
              const date = Number.isFinite(updated)
                ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(updated)
                : "Date inconnue";
              return (
                <Link className="dashboard-activity-item" href={`/invoices#invoice-${invoice.id}`} key={invoice.id}>
                  <span className="dashboard-activity-dot" />
                  <span><strong>{counterpartyLabel(invoice, counterpartyNames)}</strong><small>{modified ? "Facture mise à jour" : "Facture enregistrée"} · {date}</small></span>
                  <span className="dashboard-activity-total">{formatInvoiceTotal(invoice.total, invoice.currency)}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="dashboard-empty-message">{loadError ? "L’activité est indisponible tant que les données ne sont pas chargées." : "Aucune facture récente à afficher."}</p>
        )}
      </section>
    </>
  );
}

function daysBetween(startDate: string, endDate: string | null): number | null {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const startValue = new Date(start);
  const endValue = new Date(end);
  if (startValue.toISOString().slice(0, 10) !== startDate || endValue.toISOString().slice(0, 10) !== endDate) return null;
  return (end - start) / 86_400_000;
}

function formatInvoiceTotal(total: number | null, currency: string | null) {
  if (total === null || !Number.isFinite(total) || !currency || !/^[A-Z]{3}$/.test(currency)) return "Montant à vérifier";
  try {
    return currencyFormat(total, currency);
  } catch {
    return "Montant à vérifier";
  }
}

function Metric({ icon: Icon, label, value, hint, tone }: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className="kpi-card dashboard-metric" aria-label={`${label}: ${value}`}>
      <div className="kpi-card-top"><span className={`kpi-icon ${tone}`}><Icon size={18} /></span></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}
