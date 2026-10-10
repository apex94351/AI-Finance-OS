"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, FileText, Search, Trash2 } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { deleteInvoice, type InvoiceActionState } from "@/app/invoices/actions";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";
import type { ContactRecord, InvoiceCompany, InvoiceRecord, InvoiceStatus } from "@/types/invoice";
import { InvoiceForm } from "./invoice-form";

type StatusFilter = "all" | InvoiceStatus;
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

const filters: StatusFilter[] = ["all", "draft", "pending", "paid", "overdue", "receivable"];

function getCurrency(invoice: InvoiceRecord, companies: InvoiceCompany[]) {
  return invoice.currency ?? companies.find((company) => company.id === invoice.companyId)?.currency ?? "EUR";
}

function formatMoney(amount: number | null, currency: string) {
  if (amount === null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

function formatDate(date: string | null) {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function InvoiceManager({
  companies,
  contacts = [],
  invoices,
  loadError,
  contactWarning = null,
  initialPartyType,
  initialPartyId,
  initialCompanyId,
  sourceDocument = null,
  sourceDocumentError = null,
}: InvoiceManagerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState(initialCompanyId ?? "all");
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(sourceDocument?.linkedInvoice ?? null);
  const [activeSourceDocument, setActiveSourceDocument] = useState<InvoiceSourceDocument | null>(sourceDocument);
  const [showForm, setShowForm] = useState(Boolean(sourceDocument));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const visibleInvoices = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    return invoices.filter((invoice) => {
      const matchesQuery = !normalizedQuery || [
        invoice.invoiceNumber,
        invoice.clientName,
        invoice.description,
      ].some((value) => value?.toLocaleLowerCase("fr").includes(normalizedQuery));
      return matchesQuery
        && (status === "all" || invoice.status === status)
        && (ownerFilter === "all"
          || (ownerFilter === "personal" ? invoice.companyId === null : invoice.companyId === ownerFilter));
    });
  }, [invoices, ownerFilter, query, status]);

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
            {(["draft", "pending", "paid", "overdue"] as const).map((key) => (
              <article className="surface-panel invoice-summary-card" key={key}>
                <span>{getInvoiceStatusLabel(key)}</span>
                <strong>{invoices.filter((invoice) => invoice.status === key).length}</strong>
              </article>
            ))}
          </section>

          <section className="surface-panel invoice-list-panel" aria-labelledby="invoice-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Registre</span><h2 id="invoice-list-heading">Toutes les factures</h2></div>
              <span className="coming-soon-pill">{visibleInvoices.length} résultat{visibleInvoices.length === 1 ? "" : "s"}</span>
            </div>
            <div className="invoice-filters">
              <label className="invoice-search">
                <Search size={16} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher numéro, client, description"
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
  onToggle,
  onEdit,
  onDelete,
}: {
  id: string;
  invoice: InvoiceRecord;
  currency: string;
  companyName: string;
  expanded: boolean;
  deleting: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr id={`invoice-${id}`}>
        <td><button className="invoice-number-button" type="button" onClick={onToggle}>{invoice.invoiceNumber ?? "Brouillon sans numéro"}</button></td>
        <td>{invoice.clientName ?? "—"}</td>
        <td>{formatDate(invoice.issueDate)}</td>
        <td>{formatDate(invoice.dueDate)}</td>
        <td className="invoice-amount-cell">{formatMoney(invoice.total, currency)}</td>
        <td><Badge tone={statusTones[invoice.status]}>{getInvoiceStatusLabel(invoice.status)}</Badge></td>
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
