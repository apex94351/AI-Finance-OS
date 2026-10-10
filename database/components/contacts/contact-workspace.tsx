"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Mail, MapPin, Phone, Plus, Search, Trash2, Users } from "lucide-react";
import { createContact, deleteContact, updateContact } from "@/app/contacts/actions";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";
import { filterContacts, type ContactSort } from "@/services/contacts";
import type { ExpenseRecord } from "@/services/expenses";
import type { ContactKind, ContactRecord } from "@/types/invoice";

export interface ContactCompany {
  id: string;
  name: string;
}

export interface ContactInvoice {
  id: string;
  invoiceNumber: string | null;
  clientName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  total: number | null;
  currency: string | null;
  status: "draft" | "pending" | "paid" | "overdue" | "receivable" | "cancelled";
}

interface ContactWorkspaceProps {
  kind: ContactKind;
  contacts: ContactRecord[];
  companies: ContactCompany[];
  invoicesByContact: Record<string, ContactInvoice[]>;
  expensesBySupplier?: Record<string, ExpenseRecord[]>;
  expensesWarning?: string | null;
  selectedContactId: string | null;
  loadError: string | null;
  routeBase?: string;
}

const labels = {
  customers: { singular: "client", plural: "Clients", companyLabel: "Client" },
  suppliers: { singular: "fournisseur", plural: "Fournisseurs", companyLabel: "Fournisseur" },
} as const;

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
}

function invoiceStatusLabel(status: ContactInvoice["status"]) {
  return getInvoiceStatusLabel(status);
}

function contactInvoicesSummary(kind: ContactKind, invoices: ContactInvoice[]) {
  const totals = new Map<string, number>();
  const includedStatuses = kind === "customers" ? ["receivable"] : ["pending"];
  for (const invoice of invoices) {
    if (!includedStatuses.includes(invoice.status) || invoice.total === null || !invoice.currency) continue;
    const cents = Math.round(invoice.total * 100);
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + cents);
  }
  return [...totals].map(([currency, amount]) => formatMoney(amount / 100, currency)).join(" · ") || "—";
}

export function ContactWorkspace({
  kind,
  contacts,
  companies,
  invoicesByContact,
  expensesBySupplier = {},
  expensesWarning = null,
  selectedContactId,
  loadError,
  routeBase = `/${kind}`,
}: ContactWorkspaceProps) {
  const router = useRouter();
  const labelsForKind = labels[kind];
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState<ContactSort>("name-asc");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContactRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const companyNames = useMemo(() => new Map(companies.map(({ id, name }) => [id, name])), [companies]);
  const visibleContacts = useMemo(
    () => filterContacts(contacts, query, scope, companyNames, sort),
    [companyNames, contacts, query, scope, sort],
  );
  const selected = contacts.find((contact) => contact.id === selectedContactId) ?? null;
  const selectedInvoices = selected ? invoicesByContact[selected.id] ?? [] : [];
  const selectedExpenses = selected ? expensesBySupplier[selected.id] ?? [] : [];

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowForm(true);
  }

  function openEdit(contact: ContactRecord) {
    setEditing(contact);
    setError(null);
    setShowForm(true);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startSaving(async () => {
      const result = editing
        ? await updateContact(kind, editing.companyId, editing.id, formData)
        : await createContact(kind, formData.get("companyId")?.toString() || null, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowForm(false);
      setEditing(null);
      router.refresh();
    });
  }

  function handleDelete(contact: ContactRecord) {
    const confirmed = window.confirm(
      `Supprimer ${contact.name} ? Les factures associées seront conservées sans lien vers ce tiers.`,
    );
    if (!confirmed) return;
    setError(null);
    startSaving(async () => {
      const result = await deleteContact(kind, contact.companyId, contact.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace(routeBase);
      router.refresh();
    });
  }

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Répertoire des tiers</span></div>
          <h1>{labelsForKind.plural}</h1>
          <p>Gérez les fiches et consultez les factures explicitement associées.</p>
        </div>
        <button className="primary-button" type="button" onClick={openCreate} disabled={Boolean(loadError)}>
          <Plus size={16} /> Nouveau {labelsForKind.singular}
        </button>
      </div>

      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{loadError}</p> : null}
      {error ? <p className="auth-message is-error invoice-message" role="alert">{error}</p> : null}

      {showForm ? (
        <section className="surface-panel contact-form-panel" aria-labelledby="contact-form-heading">
          <div className="invoice-form-title">
            <div><span className="panel-kicker">{editing ? "Modification" : "Nouveau tiers"}</span><h2 id="contact-form-heading">{editing ? "Modifier la fiche" : `Créer un ${labelsForKind.singular}`}</h2></div>
            <button className="text-button" type="button" onClick={() => setShowForm(false)}>Annuler</button>
          </div>
          <form action={handleSubmit} className="contact-form">
            {editing ? <input type="hidden" name="companyId" value={editing.companyId ?? ""} /> : null}
            {!editing ? (
              <label className="invoice-field">
                <span>Espace de données</span>
                <select name="companyId" defaultValue="">
                  <option value="">Espace personnel</option>
                  {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="invoice-field"><span>Nom ou raison sociale *</span><input name="name" defaultValue={editing?.name ?? ""} maxLength={200} required /></label>
            <label className="invoice-field"><span>E-mail</span><input name="email" type="email" defaultValue={editing?.email ?? ""} maxLength={320} /></label>
            <label className="invoice-field"><span>Téléphone</span><input name="phone" type="tel" defaultValue={editing?.phone ?? ""} maxLength={60} /></label>
            <label className="invoice-field contact-field-wide"><span>Adresse</span><textarea name="address" defaultValue={editing?.address ?? ""} maxLength={500} rows={2} /></label>
            <label className="invoice-field contact-field-wide"><span>Notes</span><textarea name="notes" defaultValue={editing?.notes ?? ""} maxLength={2000} rows={3} /></label>
            <div className="invoice-form-actions contact-form-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
              <button className="text-button" type="button" onClick={() => setShowForm(false)} disabled={saving}>Annuler</button>
            </div>
          </form>
        </section>
      ) : null}

      {!loadError ? (
        <div className="contact-layout">
          <section className="surface-panel invoice-list-panel contact-list-panel" aria-labelledby="contact-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Répertoire</span><h2 id="contact-list-heading">{labelsForKind.plural}</h2></div>
              <span className="coming-soon-pill">{visibleContacts.length} fiche{visibleContacts.length === 1 ? "" : "s"}</span>
            </div>
            <div className="invoice-filters">
              <label className="invoice-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Rechercher un ${labelsForKind.singular}`} aria-label={`Rechercher un ${labelsForKind.singular}`} /></label>
              <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Filtrer par espace">
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
              <select value={sort} onChange={(event) => setSort(event.target.value as ContactSort)} aria-label={`Trier les ${labelsForKind.plural.toLocaleLowerCase("fr")}`}>
                <option value="name-asc">Nom · A à Z</option>
                <option value="created-desc">Création · plus récente</option>
              </select>
            </div>
            {visibleContacts.length ? (
              <div className="contact-list">
                {visibleContacts.map((contact) => (
                  <Link className={`contact-list-item ${selected?.id === contact.id ? "is-selected" : ""}`} href={`${routeBase}?contact=${contact.id}`} key={contact.id}>
                    <span className="contact-avatar">{contact.name.slice(0, 1).toLocaleUpperCase("fr")}</span>
                    <span className="contact-list-copy"><strong>{contact.name}</strong><small>{contact.email || contact.phone || "Coordonnées non renseignées"}</small>{contact.companyId ? <small className="contact-list-company">{companyNames.get(contact.companyId) ?? "Espace entreprise"}</small> : null}</span>
                    <small>{(invoicesByContact[contact.id] ?? []).length} facture{(invoicesByContact[contact.id] ?? []).length === 1 ? "" : "s"}</small>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Users size={22} />}
                title={contacts.length ? "Aucun résultat" : `Aucun ${labelsForKind.singular} enregistré`}
                description={contacts.length ? "Essayez une autre recherche ou un autre espace." : `Créez une fiche ${labelsForKind.singular} pour la sélectionner lors de la création ou modification d’une facture.`}
                action={!contacts.length ? <button className="primary-button" type="button" onClick={openCreate}><Plus size={15} />Nouveau {labelsForKind.singular}</button> : undefined}
              />
            )}
          </section>

          <section className="surface-panel contact-detail-panel" aria-label={`Détail ${labelsForKind.singular}`}>
            {selected ? (
              <>
                <div className="contact-detail-heading">
                  <span className="contact-avatar large">{selected.name.slice(0, 1).toLocaleUpperCase("fr")}</span>
                  <div><span className="panel-kicker">{selected.companyId ? companies.find((company) => company.id === selected.companyId)?.name ?? "Espace entreprise" : "Espace personnel"}</span><h2>{selected.name}</h2></div>
                  <div className="contact-detail-actions">
                    <button className="text-button" type="button" onClick={() => openEdit(selected)}>Modifier</button>
                    <button className="invoice-delete-button" type="button" aria-label={`Supprimer ${selected.name}`} disabled={saving} onClick={() => handleDelete(selected)}><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="contact-info-grid">
                  <ContactInfo icon={<Mail size={15} />} value={selected.email} fallback="E-mail non renseigné" />
                  <ContactInfo icon={<Phone size={15} />} value={selected.phone} fallback="Téléphone non renseigné" />
                  <ContactInfo icon={<MapPin size={15} />} value={selected.address} fallback="Adresse non renseignée" />
                  {selected.notes ? <div className="contact-notes"><span className="panel-kicker">Notes</span><p>{selected.notes}</p></div> : null}
                </div>
                <div className="contact-invoice-summary">
                  <div><span className="panel-kicker">{kind === "customers" ? "À recevoir" : "À payer"}</span><strong>{contactInvoicesSummary(kind, selectedInvoices)}</strong></div>
                  {kind === "suppliers" && selectedInvoices.some((invoice) => invoice.status === "overdue") ? (
                    <p>Le montant des factures en retard n’est pas attribué à un fournisseur : le statut seul n’indique pas le sens de la dette.</p>
                  ) : null}
                </div>
                <div className="contact-invoices-heading"><h3>Factures associées</h3><span>{selectedInvoices.length}</span></div>
                {selectedInvoices.length ? (
                  <div className="contact-invoices">
                    {selectedInvoices.map((invoice) => (
                      <Link className="contact-invoice-row" href={`/invoices#invoice-${invoice.id}`} key={invoice.id}>
                        <span><strong>{invoice.invoiceNumber || "Brouillon sans numéro"}</strong><small>{invoice.issueDate || "Date inconnue"} · Échéance {invoice.dueDate || "non renseignée"}</small></span>
                        <span>{invoice.total === null || !invoice.currency ? "Montant à vérifier" : formatMoney(invoice.total, invoice.currency)}<Badge tone={invoice.status === "overdue" ? "danger" : invoice.status === "paid" ? "success" : "warning"}>{invoiceStatusLabel(invoice.status)}</Badge></span>
                      </Link>
                    ))}
                  </div>
                ) : <p className="dashboard-empty-message">Aucune facture n’est explicitement associée à cette fiche. Les anciennes factures sans relation restent inchangées.</p>}
                {kind === "suppliers" ? (
                  <section className="supplier-expenses" aria-labelledby="supplier-expenses-heading">
                    <div className="contact-invoices-heading"><h3 id="supplier-expenses-heading">Dépenses associées</h3><span>{selectedExpenses.length}</span></div>
                    {expensesWarning ? (
                      <p className="dashboard-empty-message" role="status">{expensesWarning}</p>
                    ) : selectedExpenses.length ? (
                      <div className="contact-invoices">
                        {selectedExpenses.map((expense) => (
                          <div className="contact-invoice-row supplier-expense-row" key={expense.id}>
                            <span>
                              <strong>{expense.label}</strong>
                              <small>{expense.expenseDate.split("-").reverse().join("/")} · {expense.category ?? "Catégorie non renseignée"}</small>
                            </span>
                            <span>
                              {formatMoney(expense.amount, expense.currency)}
                              <Badge tone={expense.status === "paid" ? "success" : expense.status === "cancelled" ? "neutral" : "warning"}>
                                {expense.status === "paid" ? "Payée" : expense.status === "cancelled" ? "Annulée" : "À payer"}
                              </Badge>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="dashboard-empty-message">Aucune dépense n’est explicitement associée à ce fournisseur.</p>
                    )}
                  </section>
                ) : null}
                <div className="contact-detail-footer">
                  <Link
                    className="text-button"
                    href={`/invoices?${kind === "customers" ? "partyType=customer" : "partyType=supplier"}&partyId=${selected.id}${selected.companyId ? `&companyId=${selected.companyId}` : ""}`}
                  >Créer une facture liée</Link>
                </div>
              </>
            ) : (
              <EmptyState icon={<Building2 size={22} />} title={`Sélectionnez un ${labelsForKind.singular}`} description="Le détail et les factures explicitement associées apparaîtront ici." />
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function ContactInfo({ icon, value, fallback }: { icon: React.ReactNode; value: string | null; fallback: string }) {
  return <div className="contact-info-item">{icon}<span>{value || fallback}</span></div>;
}
