"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BellRing, CalendarClock, CircleAlert, Clock3, ExternalLink } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { markInvoiceSettled, type InvoiceActionState } from "@/app/invoices/actions";
import {
  buildDueDateItems,
  filterDueDateCompany,
  filterDueDateDirection,
  filterDueDateItems,
  filterDueDatePeriod,
  type DueDateDirection,
  type DueDateFilter,
  type DueDatePeriod,
  type DueDateRecord,
} from "@/services/due-dates";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";

interface DeadlineManagerProps {
  invoices: DueDateRecord[];
  companies?: { id: string; name: string }[];
  counterpartyNames?: Record<string, string>;
  loadError: string | null;
  partialDataWarning?: string | null;
  asOfDate: string;
}

const filters: { value: DueDateFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "upcoming", label: "À venir" },
  { value: "overdue", label: "En retard" },
  { value: "paid", label: "Payées / encaissées" },
];

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null || !Number.isFinite(amount) || !currency || !/^[A-Z]{3}$/.test(currency)) return "Montant/devise à vérifier";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return "Montant/devise à vérifier";
  }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function dueText(days: number) {
  if (days === 0) return "Échéance aujourd’hui";
  if (days > 0) return `Dans ${days} jour${days === 1 ? "" : "s"}`;
  const lateDays = Math.abs(days);
  return `En retard de ${lateDays} jour${lateDays === 1 ? "" : "s"}`;
}

export function DeadlineManager({
  invoices,
  companies = [],
  counterpartyNames = {},
  loadError,
  partialDataWarning = null,
  asOfDate,
}: DeadlineManagerProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<DueDateFilter>("all");
  const [period, setPeriod] = useState<DueDatePeriod>("all");
  const [direction, setDirection] = useState<DueDateDirection | "all">("all");
  const [companyId, setCompanyId] = useState<string | "personal" | "all">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [isSettling, startSettlement] = useTransition();
  const items = useMemo(() => buildDueDateItems(invoices, asOfDate), [asOfDate, invoices]);
  const visibleItems = filterDueDateCompany(
    filterDueDateDirection(
      filterDueDatePeriod(filterDueDateItems(items, filter), period),
      direction,
    ),
    companyId,
  );
  const upcomingCount = items.filter((item) => item.direction !== "settled" && item.daysUntilDue >= 0).length;
  const overdueCount = items.filter((item) => item.direction !== "settled" && item.daysUntilDue < 0).length;

  function markSettled(invoice: DueDateRecord) {
    setActionError(null);
    setSettlingId(invoice.id);
    startSettlement(async () => {
      const result: InvoiceActionState = await markInvoiceSettled(invoice.companyId, invoice.id);
      setSettlingId(null);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div className="deadline-intro-copy">
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Suivi financier</span></div>
          <h1>Échéances</h1>
          <p>Repérez les factures à régler et les paiements clients à encaisser.</p>
        </div>
        <Link className="text-button" href="/alerts"><BellRing size={16} />Alertes opérationnelles</Link>
      </div>

      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{loadError}</p> : null}
      {actionError ? <p className="auth-message is-error invoice-message" role="alert">{actionError}</p> : null}
      {partialDataWarning && !loadError ? <p className="dashboard-partial-warning" role="status">{partialDataWarning}</p> : null}

      {!loadError ? (
        <>
          <section className="invoice-summary-grid deadline-summary-grid" aria-label="Résumé des échéances">
            <article className="surface-panel invoice-summary-card">
              <span><Clock3 size={15} /> Échéances à venir</span>
              <strong>{upcomingCount}</strong>
            </article>
            <article className="surface-panel invoice-summary-card">
              <span><CircleAlert size={15} /> Échéances en retard</span>
              <strong>{overdueCount}</strong>
            </article>
          </section>

          <section className="surface-panel invoice-list-panel deadline-list-panel" aria-labelledby="deadline-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Agenda des règlements</span><h2 id="deadline-list-heading">Suivi des factures</h2></div>
              <span className="coming-soon-pill">{visibleItems.length} échéance{visibleItems.length === 1 ? "" : "s"}</span>
            </div>
            <div className="invoice-filters deadline-filters" aria-label="Filtres des échéances">
              {filters.map(({ value, label }) => (
                <button
                  className={`deadline-filter-button ${filter === value ? "is-active" : ""}`}
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >{label}</button>
              ))}
            </div>
            <div className="deadline-select-filters" aria-label="Filtres détaillés des échéances">
              <label><span>Période</span><select aria-label="Filtrer par période" value={period} onChange={(event) => setPeriod(event.target.value as DueDatePeriod)}>
                <option value="all">Toutes les dates</option>
                <option value="next7">Aujourd’hui à 7 jours</option>
                <option value="next30">Aujourd’hui à 30 jours</option>
                <option value="later">Au-delà de 30 jours</option>
              </select></label>
              <label><span>Sens</span><select aria-label="Filtrer par sens" value={direction} onChange={(event) => setDirection(event.target.value as DueDateDirection | "all")}>
                <option value="all">À payer et à recevoir</option>
                <option value="payable">À payer</option>
                <option value="receivable">À encaisser</option>
                <option value="unknown">Sens à confirmer</option>
                <option value="settled">Réglées</option>
              </select></label>
              {companies.length ? (
                <label><span>Espace</span><select aria-label="Filtrer par espace" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
                  <option value="all">Tous les espaces</option>
                  <option value="personal">Espace personnel</option>
                  {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
                </select></label>
              ) : null}
            </div>

            {visibleItems.length ? (
              <div className="deadline-items">
                {visibleItems.map((item) => {
                  const isOverdue = item.timing === "overdue";
                  const statusLabel = item.direction === "settled"
                    ? "Réglée"
                    : item.status === "overdue" && item.daysUntilDue >= 0
                      ? "Statut en retard à vérifier"
                    : item.direction === "unknown"
                      ? `${isOverdue ? "En retard" : "Échéance à venir"} · sens à confirmer`
                      : isOverdue
                        ? "En retard"
                        : getInvoiceStatusLabel(item.displayedStatus);
                  const tone = isOverdue
                    ? "danger"
                    : item.displayedStatus === "paid" || item.displayedStatus === "receivable"
                      ? "success"
                      : "warning";
                  const groupLabel = item.direction === "payable"
                    ? "À payer"
                    : item.direction === "receivable"
                      ? "À encaisser"
                      : item.direction === "unknown"
                        ? "Sens à confirmer"
                        : "Payée / encaissée";
                  const counterpartyName = item.customerId
                    ? counterpartyNames[item.customerId] ?? "Client associé"
                    : item.supplierId
                      ? counterpartyNames[item.supplierId] ?? "Fournisseur associé"
                      : item.clientName || "Tiers non renseigné";
                  const counterpartyType = item.customerId ? "Client" : item.supplierId ? "Fournisseur" : "Tiers enregistré";

                  return (
                    <article className={`deadline-item ${isOverdue ? "is-overdue" : ""}`} key={item.id}>
                      <div className="deadline-item-main">
                        <div className="deadline-item-title">
                          <span className="deadline-direction">{groupLabel}</span>
                          <h3>{counterpartyName}</h3>
                          <span className="deadline-direction">{counterpartyType}</span>
                          <p>{item.invoiceNumber ? `Facture ${item.invoiceNumber}` : "Facture sans numéro"}</p>
                        </div>
                        <div className="deadline-item-amount">
                          <strong>{formatMoney(item.total, item.currency)}</strong>
                          {item.currency ? <span>{item.currency}</span> : null}
                        </div>
                      </div>
                      <div className="deadline-item-meta">
                        <span><CalendarClock size={15} /> Échéance : {formatDate(item.dueDate ?? "")}</span>
                        <span className={isOverdue ? "deadline-day-count is-overdue" : "deadline-day-count"}>
                          {item.direction === "settled" && item.daysUntilDue < 0
                            ? `Réglée · échéance passée de ${Math.abs(item.daysUntilDue)} jour${Math.abs(item.daysUntilDue) === 1 ? "" : "s"}`
                            : item.direction === "settled"
                              ? `Réglée · ${dueText(item.daysUntilDue).toLocaleLowerCase("fr")}`
                              : dueText(item.daysUntilDue)}
                        </span>
                        <Badge tone={tone}>{item.status === "overdue" && item.daysUntilDue >= 0
                          ? statusLabel
                          : item.timing === "soon"
                            ? "À venir · proche"
                            : item.timing === "future"
                              ? "À venir · future"
                              : statusLabel}</Badge>
                        <Link className="text-button deadline-invoice-link" href={`/invoices#invoice-${item.id}`}>
                          Voir la facture <ExternalLink size={14} />
                        </Link>
                        {item.direction !== "settled" ? (
                          <button
                            className="text-button deadline-settle-button"
                            type="button"
                            disabled={isSettling}
                            onClick={() => markSettled(item)}
                          >
                            {isSettling && settlingId === item.id
                              ? "Enregistrement…"
                              : item.direction === "receivable"
                                ? "Marquer encaissée"
                                : item.direction === "unknown" ? "Marquer réglée" : "Marquer payée"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarClock size={22} />}
                title={loadError
                  ? "Échéances indisponibles"
                  : !invoices.length
                    ? "Aucune échéance enregistrée"
                    : !items.length
                      ? "Aucune échéance datée active"
                      : "Aucune échéance dans ce filtre"}
                description={loadError ?? (invoices.length
                  ? !items.length
                    ? "Les factures sans date valide, en brouillon ou annulées ne sont pas affichées comme des échéances."
                    : "Essayez un autre filtre pour consulter vos règlements."
                  : "Les factures en brouillon ou annulées ne sont pas présentées comme des échéances actives.")}
              />
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
