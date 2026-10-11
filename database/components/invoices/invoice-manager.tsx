"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FilePlus2, FileText, Search, Trash2 } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { deleteInvoice, updateInvoicePaymentStatus, type InvoiceActionState } from "@/app/invoices/actions";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";
import { buildInvoiceOverview, type InvoiceCurrencyTotal, type InvoiceOverviewPeriod } from "@/services/invoice-overview";
import { getEffectiveInvoiceStatus } from "@/services/invoice-validation";
import type { ContactRecord, InvoiceCompany, InvoicePaymentStatus, InvoiceRecord, InvoiceStatus } from "@/types/invoice";
import { InvoiceForm } from "./invoice-form";

type StatusFilter = "all" | InvoiceStatus;
export type InvoiceDashboardFilter =
  | "customer-open"
  | "supplier-open"
  | "customer-invoices"
  | "customer-overdue"
  | "supplier-upcoming"
  | "all-overdue";
type InvoiceSourceDocument = {
  id: string;
  companyId: string;
  fileName: string;
  category: "customer_invoice" | "supplier_invoice";
  linkedInvoice?: InvoiceRecord;
};

interface InvoiceManagerProps {
  companies: InvoiceCompany[];
  contacts?: ContactRecord[];
  invoices: InvoiceRecord[];
  loadError: string | null;
  contactWarning?: string | null;
  initialPartyType?: "customer" | "supplier";
  initialPartyId?: string;
  initialDashboardFilter?: InvoiceDashboardFilter;
  initialOverviewPeriod?: InvoiceOverviewPeriod;
  initialCompanyId?: string;
  sourceDocument?: InvoiceSourceDocument | null;
  sourceDocumentError?: string | null;
}

const statusTones: Record<InvoiceStatus, "neutral" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  pending: "warning",
  paid: "success",
  overdue: "danger",
  receivable: "success",
  cancelled: "neutral",
};

const filters: StatusFilter[] = ["all", "pending", "overdue", "paid"];

function getCurrency(invoice: InvoiceRecord, companies: InvoiceCompany[]) {
  return invoice.currency ?? companies.find((company) => company.id === invoice.companyId)?.currency ?? "EUR";
}

function formatMoney(amount: number | null, currency: string) {
  if (amount === null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

function formatCurrencyTotals(totals: InvoiceCurrencyTotal[], signed = false) {
  return totals.length
    ? totals.map(({ amount, currency }) => (
      `${new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        signDisplay: signed ? "always" : "auto",
      }).format(amount)}`
    )).join(" · ")
    : "—";
}

function formatDate(date: string | null) {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function matchesDashboardFilter(invoice: InvoiceRecord, filter: InvoiceDashboardFilter | undefined, asOfDate: string) {
  if (!filter) return true;
  const customer = Boolean(invoice.customerId) || (!invoice.supplierId && Boolean(invoice.clientName));
  const effectiveStatus = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate, new Date(`${asOfDate}T00:00:00Z`));
  const active = effectiveStatus === "pending" || effectiveStatus === "overdue";
  const hasBalance = invoice.total !== null && Number.isFinite(invoice.total) && invoice.total > 0;
  const validDueDate = Boolean(invoice.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(invoice.dueDate)
    && !Number.isNaN(Date.parse(`${invoice.dueDate}T00:00:00Z`))
    && new Date(`${invoice.dueDate}T00:00:00Z`).toISOString().slice(0, 10) === invoice.dueDate);
  const overdue = active && hasBalance && validDueDate && Boolean(invoice.dueDate && invoice.dueDate < asOfDate);
  switch (filter) {
    case "customer-open": return customer && active && hasBalance;
    case "supplier-open": return Boolean(invoice.supplierId) && active && hasBalance;
    case "customer-invoices": return customer && effectiveStatus !== "draft" && effectiveStatus !== "cancelled";
    case "customer-overdue": return customer && overdue;
    case "supplier-upcoming": return Boolean(invoice.supplierId) && active && hasBalance
      && validDueDate && Boolean(invoice.dueDate && invoice.dueDate >= asOfDate
        && invoice.dueDate <= new Date(Date.parse(`${asOfDate}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
    case "all-overdue": return overdue;
  }
}

function matchesOverviewPeriod(invoice: InvoiceRecord, period: InvoiceOverviewPeriod, asOfDate: string) {
  if (period === "all") return true;
  if (!invoice.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate)) return false;
  const periodPrefix = period === "month" ? asOfDate.slice(0, 7) : asOfDate.slice(0, 4);
  return invoice.issueDate.startsWith(periodPrefix);
}

const dashboardFilterLabels: Record<InvoiceDashboardFilter, string> = {
  "customer-open": "Factures clients à encaisser",
  "supplier-open": "Factures fournisseurs à payer",
  "customer-invoices": "Factures clients",
  "customer-overdue": "Factures clients en retard",
  "supplier-upcoming": "Paiements fournisseurs à venir",
  "all-overdue": "Toutes les factures en retard",
};

export function InvoiceManager({
  companies,
  contacts = [],
  invoices,
  loadError,
  contactWarning = null,
  initialPartyType,
  initialPartyId,
  initialDashboardFilter,
  initialOverviewPeriod,
  initialCompanyId,
  sourceDocument = null,
  sourceDocumentError = null,
}: InvoiceManagerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<InvoiceOverviewPeriod>(initialOverviewPeriod ?? "all");
  const [ownerFilter, setOwnerFilter] = useState(initialCompanyId ?? "all");
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(sourceDocument?.linkedInvoice ?? null);
  const [activeSourceDocument, setActiveSourceDocument] = useState<InvoiceSourceDocument | null>(sourceDocument);
  const [showForm, setShowForm] = useState(Boolean(sourceDocument));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updatingIdRef = useRef<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [, startStatusUpdate] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const workspaceInvoices = useMemo(() => invoices.filter((invoice) => (
    ownerFilter === "all"
      || (ownerFilter === "personal" ? invoice.companyId === null : invoice.companyId === ownerFilter)
  )), [invoices, ownerFilter]);
  const companyCurrencies = useMemo(
    () => new Map(companies.map(({ id, currency }) => [id, currency])),
    [companies],
  );
  const overview = useMemo(
    () => buildInvoiceOverview(workspaceInvoices, today, companyCurrencies, period),
    [companyCurrencies, period, today, workspaceInvoices],
  );
  const contactNames = useMemo(() => new Map(contacts.map(({ id, name }) => [id, name])), [contacts]);

  const visibleInvoices = useMemo(() => {
    const normalizeSearchText = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
    const normalizedQuery = normalizeSearchText(query);
    return workspaceInvoices.filter((invoice) => {
      const effectiveStatus = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate, new Date(`${today}T00:00:00Z`));
      const amountText = invoice.total === null ? "" : [
        String(invoice.total),
        invoice.total.toFixed(2),
        invoice.total.toFixed(2).replace(".", ","),
      ].join(" ");
      const matchesQuery = !normalizedQuery || [
        invoice.invoiceNumber,
        invoice.clientName,
        invoice.customerId ? contactNames.get(invoice.customerId) : null,
        invoice.supplierId ? contactNames.get(invoice.supplierId) : null,
        invoice.description,
        amountText,
      ].some((value) => value !== null && value !== undefined && normalizeSearchText(value).includes(normalizedQuery));
      return matchesQuery
        && (status === "all" || effectiveStatus === status)
        && (!initialDashboardFilter || initialOverviewPeriod === undefined || matchesOverviewPeriod(invoice, period, today))
        && matchesDashboardFilter(invoice, initialDashboardFilter, today);
    });
  }, [contactNames, initialDashboardFilter, initialOverviewPeriod, period, query, status, today, workspaceInvoices]);

  function openCreateForm() {
    setEditingInvoice(null);
    setActiveSourceDocument(null);
    setShowForm(true);
    setDeleteError(null);
  }

  function openEditForm(invoice: InvoiceRecord) {
    setEditingInvoice(invoice);
    setShowForm(true);
    setDeleteError(null);
  }

  function handleDelete(invoice: InvoiceRecord) {
    if (!window.confirm(`Supprimer la facture ${invoice.invoiceNumber ?? "sans numéro"} ?`)) return;
    setDeleteError(null);
    setDeletingId(invoice.id);
    startDelete(async () => {
      const result: InvoiceActionState = await deleteInvoice(invoice.companyId, invoice.id);
      setDeletingId(null);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      setExpandedId(null);
      router.refresh();
    });
  }

  function handleStatusChange(invoice: InvoiceRecord, targetStatus: InvoicePaymentStatus) {
    if (updatingIdRef.current) return;
    updatingIdRef.current = invoice.id;
    setUpdatingId(invoice.id);
    setStatusError(null);
    setStatusMessage(null);
    startStatusUpdate(async () => {
      try {
        const result = await updateInvoicePaymentStatus(invoice.companyId, invoice.id, targetStatus);
        if (result.error) {
          setStatusError(result.error);
          return;
        }
        setStatusMessage(result.success ?? "Le statut de la facture a été mis à jour.");
        router.refresh();
      } catch (error) {
        console.error("Invoice status action failed", error);
        setStatusError("La mise à jour du statut a échoué. Réessayez.");
      } finally {
        updatingIdRef.current = null;
        setUpdatingId(null);
      }
    });
  }

  const canUseInvoices = !loadError;
  const handleFormSaved = useCallback(() => {
    setShowForm(false);
    setEditingInvoice(null);
    setActiveSourceDocument(null);
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Gestion financière</span></div>
          <h1>Factures</h1>
          <p>Retrouvez et gérez vos factures personnelles ou partagées avec une entreprise.</p>
        </div>
        <button className="primary-button" type="button" onClick={openCreateForm} disabled={!canUseInvoices}>
          <FilePlus2 size={17} /> Nouvelle facture
        </button>
      </div>

      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{loadError}</p> : null}
      {deleteError ? <p className="auth-message is-error invoice-message" role="alert">{deleteError}</p> : null}
      {sourceDocumentError ? <p className="auth-message is-error invoice-message" role="alert">{sourceDocumentError}</p> : null}
      {activeSourceDocument ? (
        <p className="document-information" role="status">
          {activeSourceDocument.linkedInvoice
            ? `Ce document est déjà lié à la facture ${activeSourceDocument.linkedInvoice.invoiceNumber ?? "(sans numéro)"}. Vous modifiez cette facture pour éviter un doublon.`
            : `Saisie manuelle depuis « ${activeSourceDocument.fileName} ». Aucune extraction automatique n’a été effectuée ; vérifiez les informations sur le document avant l’enregistrement.`}
        </p>
      ) : null}

      {canUseInvoices && showForm ? (
        <section className="surface-panel invoice-form-panel" aria-labelledby="invoice-form-heading">
          <InvoiceForm
            companies={companies}
            contacts={contacts}
            invoice={editingInvoice}
            initialCompanyId={ownerFilter !== "all" && ownerFilter !== "personal" ? ownerFilter : ""}
            initialPartyType={initialPartyType}
            initialPartyId={initialPartyId}
            sourceDocument={activeSourceDocument}
            contactWarning={contactWarning}
            onCancel={() => setShowForm(false)}
            onSaved={handleFormSaved}
          />
        </section>
      ) : null}

      {canUseInvoices ? (
        <>
          <section className="invoice-summary-grid" aria-label="Résumé des factures">
            <label className="invoice-period-filter">
              Période des indicateurs
              <select value={period} onChange={(event) => setPeriod(event.target.value as InvoiceOverviewPeriod)} aria-label="Période des indicateurs">
                <option value="month">Ce mois-ci</option>
                <option value="year">Cette année</option>
                <option value="all">Tout l’historique</option>
              </select>
            </label>
            <Link className="surface-panel invoice-summary-card invoice-overview-card" href={`/invoices?dashboardFilter=customer-open&overviewPeriod=${period}`}>
              <span>Factures clients impayées</span>
              <strong>{formatCurrencyTotals(overview.customers.outstanding)}</strong>
              <small>{overview.customers.outstandingCount} facture{overview.customers.outstandingCount === 1 ? "" : "s"} · à encaisser sur la période</small>
            </Link>
            <Link className="surface-panel invoice-summary-card invoice-overview-card" href={`/invoices?dashboardFilter=supplier-open&overviewPeriod=${period}`}>
              <span>Factures fournisseurs à payer</span>
              <strong>{formatCurrencyTotals(overview.suppliers.outstanding)}</strong>
              <small>{overview.suppliers.outstandingCount} facture{overview.suppliers.outstandingCount === 1 ? "" : "s"} · à payer sur la période</small>
            </Link>
            <Link className="surface-panel invoice-summary-card invoice-overview-card" href={`/invoices?dashboardFilter=all-overdue&overviewPeriod=${period}`}>
              <span>Factures en retard</span>
              <strong>{formatCurrencyTotals(overview.overdue)}</strong>
              <small>{overview.overdueCount} facture{overview.overdueCount === 1 ? "" : "s"} · échéance dépassée sur la période</small>
            </Link>
            <article className="surface-panel invoice-summary-card invoice-overview-card">
              <span>Solde net des factures</span>
              <strong>{formatCurrencyTotals(overview.net, true)}</strong>
              <small>Factures clients − factures fournisseurs · total TTC, période sélectionnée</small>
            </article>
          </section>
          <p className="invoice-overview-note">
            Les indicateurs et récapitulatifs utilisent la période d’émission sélectionnée. Le solde net inclut les factures payées et impayées ; à encaisser, à payer et en retard correspondent aux factures encore impayées de cette période. Aucune conversion de devise n’est effectuée et une facture ouverte est comptée à son montant TTC intégral.
          </p>
          {overview.customers.incompleteAmountCount + overview.suppliers.incompleteAmountCount + overview.unclassifiedCount > 0 ? (
            <p className="invoice-overview-warning" role="status">
              {overview.customers.incompleteAmountCount + overview.suppliers.incompleteAmountCount + overview.unclassifiedCount} facture{overview.customers.incompleteAmountCount + overview.suppliers.incompleteAmountCount + overview.unclassifiedCount === 1 ? "" : "s"} ne sont pas entièrement totalisée{overview.customers.incompleteAmountCount + overview.suppliers.incompleteAmountCount + overview.unclassifiedCount === 1 ? "" : "s"} : montant/devise inexploitable ou type de tiers manquant.
            </p>
          ) : null}

          <div className="invoice-party-overviews">
            <section className="surface-panel invoice-party-overview" aria-labelledby="invoice-customer-overview-heading">
              <div className="invoice-list-heading">
                <div><span className="panel-kicker">{period === "month" ? "Ce mois-ci" : period === "year" ? "Cette année" : "Tout l’historique"}</span><h2 id="invoice-customer-overview-heading">Récapitulatif clients</h2></div>
              </div>
              <dl>
                <div><dt>Factures émises</dt><dd>{formatCurrencyTotals(overview.customers.issued)}</dd></div>
                <div><dt>Montant payé</dt><dd>{formatCurrencyTotals(overview.customers.paid)}</dd></div>
                <div><dt>À encaisser · factures impayées</dt><dd>{formatCurrencyTotals(overview.customers.outstanding)}</dd></div>
                <div><dt>En retard · factures impayées</dt><dd>{formatCurrencyTotals(overview.customers.overdue)}</dd></div>
              </dl>
            </section>
            <section className="surface-panel invoice-party-overview" aria-labelledby="invoice-supplier-overview-heading">
              <div className="invoice-list-heading">
                <div><span className="panel-kicker">{period === "month" ? "Ce mois-ci" : period === "year" ? "Cette année" : "Tout l’historique"}</span><h2 id="invoice-supplier-overview-heading">Récapitulatif fournisseurs</h2></div>
              </div>
              <dl>
                <div><dt>Factures enregistrées</dt><dd>{formatCurrencyTotals(overview.suppliers.issued)}</dd></div>
                <div><dt>Montant payé</dt><dd>{formatCurrencyTotals(overview.suppliers.paid)}</dd></div>
                <div><dt>À payer · factures impayées</dt><dd>{formatCurrencyTotals(overview.suppliers.outstanding)}</dd></div>
                <div><dt>En retard · factures impayées</dt><dd>{formatCurrencyTotals(overview.suppliers.overdue)}</dd></div>
              </dl>
            </section>
          </div>

          <section className="surface-panel invoice-list-panel" aria-labelledby="invoice-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Registre</span><h2 id="invoice-list-heading">{initialDashboardFilter ? dashboardFilterLabels[initialDashboardFilter] : "Toutes les factures"}</h2></div>
              {initialDashboardFilter ? <Link className="text-button" href="/invoices">Toutes les factures</Link> : null}
              <span className="coming-soon-pill">{visibleInvoices.length} résultat{visibleInvoices.length === 1 ? "" : "s"}</span>
            </div>
            {statusError ? <p className="auth-message is-error invoice-message" role="alert">{statusError}</p> : null}
            {statusMessage ? <p className="auth-message invoice-message" role="status">{statusMessage}</p> : null}
            <div className="invoice-filters">
              <label className="invoice-search">
                <Search size={16} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher numéro, tiers, description, montant"
                  aria-label="Rechercher une facture"
                />
              </label>
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filtrer par statut">
                <option value="all">Tous les statuts</option>
                {filters.filter((value): value is InvoiceStatus => value !== "all").map((value) => (
                  <option value={value} key={value}>{getInvoiceStatusLabel(value)}</option>
                ))}
              </select>
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Filtrer par espace">
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </div>

            {visibleInvoices.length > 0 ? (
              <div className="invoice-table-scroll">
                <table className="invoice-table">
                  <thead>
                    <tr><th>Numéro</th><th>Client</th><th>Émise le</th><th>Échéance</th><th>Montant TTC</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((invoice) => {
                      const currency = getCurrency(invoice, companies);
                      const expanded = expandedId === invoice.id;
                      return (
                        <InvoiceRows
                          key={invoice.id}
                          id={invoice.id}
                          invoice={invoice}
                          currency={currency}
                          companyName={companies.find((company) => company.id === invoice.companyId)?.name ?? "Espace personnel"}
                          expanded={expanded}
                          deleting={isDeleting && deletingId === invoice.id}
                          updating={updatingId === invoice.id}
                          onStatusChange={(targetStatus) => handleStatusChange(invoice, targetStatus)}
                          onToggle={() => setExpandedId(expanded ? null : invoice.id)}
                          onEdit={() => openEditForm(invoice)}
                          onDelete={() => handleDelete(invoice)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<FileText size={22} />}
                title={invoices.length === 0 ? "Aucune facture pour le moment" : "Aucun résultat"}
                description={invoices.length === 0
                  ? "Créez une facture pour commencer. Aucune donnée de démonstration n’est utilisée ici."
                  : "Modifiez la recherche ou les filtres pour afficher des factures."}
                action={invoices.length === 0
                  ? <button className="primary-button" type="button" onClick={openCreateForm}><FilePlus2 size={16} />Nouvelle facture</button>
                  : undefined}
              />
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function InvoiceRows({
  id,
  invoice,
  currency,
  companyName,
  expanded,
  deleting,
  updating,
  onToggle,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  id: string;
  invoice: InvoiceRecord;
  currency: string;
  companyName: string;
  expanded: boolean;
  deleting: boolean;
  updating: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: InvoicePaymentStatus) => void;
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuPosition, setStatusMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const effectiveStatus = getEffectiveInvoiceStatus(invoice.status, invoice.dueDate);
  const canChangePaymentStatus = effectiveStatus === "pending" || effectiveStatus === "overdue" || effectiveStatus === "paid";

  useEffect(() => {
    if (!statusMenuOpen) return;

    const positionMenu = () => {
      const button = statusButtonRef.current;
      const menu = statusMenuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 5;
      const viewportPadding = 8;
      const hasRoomBelow = window.innerHeight - buttonRect.bottom >= menuRect.height + gap;
      const proposedTop = hasRoomBelow
        ? buttonRect.bottom + gap
        : buttonRect.top - menuRect.height - gap;
      setStatusMenuPosition({
        top: Math.max(viewportPadding, Math.min(proposedTop, window.innerHeight - menuRect.height - viewportPadding)),
        left: Math.max(viewportPadding, Math.min(buttonRect.left, window.innerWidth - menuRect.width - viewportPadding)),
      });
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [statusMenuOpen]);

  function selectStatus(targetStatus: InvoicePaymentStatus) {
    setStatusMenuOpen(false);
    setStatusMenuPosition(null);
    onStatusChange(targetStatus);
  }

  return (
    <>
      <tr id={`invoice-${id}`}>
        <td><button className="invoice-number-button" type="button" onClick={onToggle}>{invoice.invoiceNumber ?? "Brouillon sans numéro"}</button></td>
        <td>{invoice.clientName ?? "—"}</td>
        <td>{formatDate(invoice.issueDate)}</td>
        <td>{formatDate(invoice.dueDate)}</td>
        <td className="invoice-amount-cell">{formatMoney(invoice.total, currency)}</td>
        <td>
          {canChangePaymentStatus ? (
            <div className="invoice-status-control">
              <button ref={statusButtonRef} className="invoice-status-button" type="button" disabled={updating} aria-expanded={statusMenuOpen} aria-label={`Statut ${getInvoiceStatusLabel(effectiveStatus)} pour ${invoice.invoiceNumber ?? "la facture"}`} onClick={() => {
                setStatusMenuOpen((open) => !open);
                setStatusMenuPosition(null);
              }}>
                <Badge tone={statusTones[effectiveStatus]}>{getInvoiceStatusLabel(effectiveStatus)}</Badge>
              </button>
              {statusMenuOpen && typeof document !== "undefined" ? createPortal(
                <div
                  ref={statusMenuRef}
                  className="invoice-status-menu"
                  style={{
                    top: statusMenuPosition?.top ?? 0,
                    left: statusMenuPosition?.left ?? 0,
                    visibility: statusMenuPosition ? "visible" : "hidden",
                  }}
                >
                  <button type="button" disabled={updating} onClick={() => selectStatus("pending")}>À payer</button>
                  <button type="button" disabled={updating} onClick={() => selectStatus("paid")}>Payée</button>
                  <button type="button" disabled={updating} onClick={() => selectStatus("overdue")}>En retard</button>
                </div>,
                document.body,
              ) : null}
            </div>
          ) : <Badge tone={statusTones[effectiveStatus]}>{getInvoiceStatusLabel(effectiveStatus)}</Badge>}
        </td>
        <td className="invoice-row-actions">
          <button className="text-button" type="button" onClick={onEdit}>Modifier</button>
          <button className="invoice-delete-button" type="button" onClick={onDelete} disabled={deleting} aria-label={`Supprimer ${invoice.invoiceNumber ?? "la facture"}`}>
            <Trash2 size={15} />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="invoice-expanded-row">
          <td colSpan={7}>
            <div className="invoice-details">
              <div><span>Description</span><p>{invoice.description || "Aucune description renseignée."}</p></div>
              <div><span>Montant HT</span><p>{formatMoney(invoice.subtotal, currency)}</p></div>
              <div><span>TVA {invoice.vatRate === null ? "" : `(${invoice.vatRate} %)`}</span><p>{formatMoney(invoice.vatAmount, currency)}</p></div>
              <div><span>Entreprise</span><p>{companyName}</p></div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
