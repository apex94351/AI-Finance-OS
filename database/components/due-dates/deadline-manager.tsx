"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, Search } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import {
  buildDueDateItems,
  buildDueDateSummary,
  filterDueDateItems,
  type DueDateFilter,
  type DueDateRecord,
} from "@/services/due-dates";

interface DeadlineManagerProps {
  invoices: DueDateRecord[];
  counterpartyNames?: Record<string, string>;
  loadError: string | null;
  partialDataWarning?: string | null;
  asOfDate: string;
}

const filters: { value: DueDateFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "payable", label: "À payer" },
  { value: "receivable", label: "À encaisser" },
];

function formatMoney(amount: number, currency = "EUR") {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return "Montant/devise à vérifier";
  }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function dueText(days: number, manuallyOverdue = false) {
  if (manuallyOverdue && days >= 0) return "Statut En retard choisi manuellement";
  if (days === 0) return "Échéance aujourd’hui";
  if (days > 0) return `Dans ${days} jour${days === 1 ? "" : "s"}`;
  const lateDays = Math.abs(days);
  return `En retard de ${lateDays} jour${lateDays === 1 ? "" : "s"}`;
}

export function DeadlineManager({
  invoices,
  counterpartyNames = {},
  loadError,
  partialDataWarning = null,
  asOfDate,
}: DeadlineManagerProps) {
  const [filter, setFilter] = useState<DueDateFilter>("all");
  const [search, setSearch] = useState("");
  const items = useMemo(() => buildDueDateItems(invoices, asOfDate), [asOfDate, invoices]);
  const summary = useMemo(() => buildDueDateSummary(invoices, asOfDate), [asOfDate, invoices]);
  const forecastTone = Math.abs(summary.forecastBalance) <= 0.01
    ? ""
    : summary.forecastBalance > 0 ? "is-positive" : "is-negative";
  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("fr");
    return filterDueDateItems(items, filter).filter((item) => {
      if (!normalizedSearch) return true;
      const counterparty = item.customerId
        ? counterpartyNames[item.customerId] ?? item.clientName
        : item.supplierId
          ? counterpartyNames[item.supplierId] ?? item.clientName
          : item.clientName;
      return [counterparty, item.label, item.invoiceNumber]
        .some((value) => value?.toLocaleLowerCase("fr").includes(normalizedSearch));
    });
  }, [counterpartyNames, filter, items, search]);

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div className="deadline-intro-copy">
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Suivi financier</span></div>
          <h1>Échéances</h1>
          <p>Visualisez les encaissements attendus et les paiements à venir.</p>
        </div>
      </div>

      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{loadError}</p> : null}
      {partialDataWarning && !loadError ? <p className="dashboard-partial-warning" role="status">{partialDataWarning}</p> : null}

      {!loadError ? (
        <>
          <section className="invoice-summary-grid deadline-summary-grid" aria-label="Prévisionnel des échéances">
            <article className="surface-panel invoice-summary-card deadline-metric">
              <span><ArrowDownLeft size={15} /> Total à encaisser</span>
              <strong>{formatMoney(summary.receivable)}</strong>
              <small>Montant restant des factures clients actives</small>
            </article>
            <article className="surface-panel invoice-summary-card deadline-metric">
              <span><ArrowUpRight size={15} /> Total à payer</span>
              <strong>{formatMoney(summary.payable)}</strong>
              <small>Factures fournisseurs et dépenses restantes</small>
            </article>
            <article className={`surface-panel invoice-summary-card deadline-metric ${forecastTone}`}>
              <span><ArrowLeftRight size={15} /> Solde prévisionnel</span>
              <strong>{formatMoney(summary.forecastBalance)}</strong>
              <small>Écart attendu, pas le solde bancaire réel</small>
            </article>
          </section>

          {summary.nonEuroCount > 0 || summary.incompleteAmountCount > 0 || summary.unclassifiedCount > 0 ? (
            <p className="invoice-overview-warning" role="status">
              {summary.nonEuroCount > 0
                ? `${summary.nonEuroCount} obligation${summary.nonEuroCount === 1 ? "" : "s"} en devise autre que EUR ne sont pas incluses dans les totaux ; aucune conversion n’est disponible. `
                : ""}
              {summary.incompleteAmountCount > 0
                ? `${summary.incompleteAmountCount} obligation${summary.incompleteAmountCount === 1 ? "" : "s"} avec un montant ou une devise inexploitable ne sont pas incluses dans les totaux.`
                : ""}
              {summary.unclassifiedCount > 0
                ? `${summary.unclassifiedCount} facture${summary.unclassifiedCount === 1 ? "" : "s"} sans sens financier confirmé reste${summary.unclassifiedCount === 1 ? "" : "nt"} visible${summary.unclassifiedCount === 1 ? "" : "s"} dans « Toutes » et n’est pas incluse dans les totaux. Associez-la à un client ou un fournisseur pour la qualifier ; l’enregistrement d’un type sans tiers nécessite la migration 017.`
                : ""}
            </p>
          ) : null}

          <section className="surface-panel invoice-list-panel deadline-list-panel" aria-labelledby="deadline-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">À suivre</span><h2 id="deadline-list-heading">Toutes les échéances actives</h2></div>
              <span className="coming-soon-pill">{visibleItems.length} échéance{visibleItems.length === 1 ? "" : "s"}</span>
            </div>
            <div className="invoice-filters deadline-filters" aria-label="Filtres des échéances">
              <div className="deadline-filter-group" role="group" aria-label="Type d’échéance">
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
              <label className="invoice-search">
                <Search size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher un tiers ou une référence"
                  aria-label="Rechercher une échéance"
                />
              </label>
            </div>

            {visibleItems.length ? (
              <div className="deadline-items">
                {visibleItems.map((item) => {
                  const isOverdue = item.displayedStatus === "overdue";
                  const counterpartyName = item.customerId
                    ? counterpartyNames[item.customerId] ?? item.clientName ?? "Client associé"
                    : item.supplierId
                      ? counterpartyNames[item.supplierId] ?? item.clientName ?? "Fournisseur associé"
                      : item.clientName || "Tiers non renseigné";
                  const counterpartyType = item.direction === "receivable" ? "Client"
                    : item.direction === "payable" ? "Fournisseur" : "Tiers";
                  const operationLabel = item.sourceType === "expense"
                    ? `Dépense · ${item.label ?? "Sans libellé"}`
                    : item.invoiceNumber
                      ? `Facture ${item.invoiceNumber}`
                      : "Facture sans numéro";
                  const href = item.sourceType === "expense" ? "/expenses" : `/invoices#invoice-${item.id}`;

                  return (
                    <Link
                      className={`deadline-item deadline-item-link ${isOverdue ? "is-overdue" : ""}`}
                      key={`${item.sourceType ?? "invoice"}-${item.id}`}
                      href={href}
                      aria-label={`Ouvrir ${operationLabel} de ${counterpartyName}`}
                    >
                      <div className="deadline-item-main">
                        <div className="deadline-item-title">
                          <span className="deadline-direction">{counterpartyType} · {item.direction === "payable" ? "À payer" : item.direction === "receivable" ? "À encaisser" : "Sens à préciser"}</span>
                          <h3>{counterpartyName}</h3>
                          <p>{operationLabel}</p>
                        </div>
                        <div className="deadline-item-amount">
                          <strong>{item.total === null ? "Montant à vérifier" : formatMoney(item.total, item.currency ?? "EUR")}</strong>
                          {item.total !== null && item.currency !== "EUR" ? <span>Hors totaux EUR</span> : null}
                        </div>
                      </div>
                      <div className="deadline-item-meta">
                        <span><CalendarClock size={15} /> Échéance : {formatDate(item.dueDate ?? "")}</span>
                        <span className={isOverdue ? "deadline-day-count is-overdue" : "deadline-day-count"}>{dueText(item.daysUntilDue, isOverdue)}</span>
                        <Badge tone={isOverdue ? "danger" : item.direction === "unclassified" ? "neutral" : "warning"}>
                          {isOverdue ? "En retard" : item.direction === "payable" ? "À payer" : item.direction === "receivable" ? "À encaisser" : "Sens à préciser"}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarClock size={22} />}
                title={loadError
                  ? "Échéances indisponibles"
                  : !items.length
                    ? "Aucune échéance active"
                    : search
                      ? "Aucun résultat"
                      : "Aucune échéance dans ce filtre"}
                description={loadError ?? (!items.length
                  ? "Les éléments réglés, annulés, en brouillon ou sans date d’échéance valide ne sont pas affichés."
                  : search
                    ? "Essayez un autre nom de client, fournisseur ou une autre référence."
                    : "Choisissez un autre type d’échéance pour continuer.")}
              />
            )}
          </section>
          <p className="deadline-forecast-note">
            Le solde prévisionnel correspond à la différence entre les encaissements attendus et les paiements prévus. Il ne représente pas le solde bancaire réel.
          </p>
        </>
      ) : null}
    </>
  );
}
