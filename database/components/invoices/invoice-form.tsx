"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createContact } from "@/app/contacts/actions";
import { saveInvoice, type InvoiceActionState } from "@/app/invoices/actions";
import { calculateInvoiceAmounts, formatInvoiceAmount } from "@/services/manual-invoice";
import type { ContactKind, ContactRecord, InvoiceCompany, InvoicePaymentStatus, InvoiceRecord, InvoiceStatus } from "@/types/invoice";

const blankState: InvoiceActionState = {};
type InvoiceSourceDocument = {
  id: string;
  companyId: string;
  fileName: string;
  category: "customer_invoice" | "supplier_invoice";
  linkedInvoice?: InvoiceRecord;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function editableStatus(status: InvoiceStatus | undefined): InvoicePaymentStatus {
  return status === "paid" ? "paid" : "pending";
}

export function InvoiceForm({
  companies,
  contacts,
  invoice,
  initialCompanyId,
  initialPartyType,
  initialPartyId,
  sourceDocument,
  contactWarning,
  onCancel,
  onSaved,
}: {
  companies: InvoiceCompany[];
  contacts: ContactRecord[];
  invoice: InvoiceRecord | null;
  initialCompanyId: string;
  initialPartyType?: "customer" | "supplier";
  initialPartyId?: string;
  sourceDocument?: InvoiceSourceDocument | null;
  contactWarning: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveInvoice, blankState);
  const [companyId, setCompanyId] = useState(invoice?.companyId ?? initialCompanyId);
  const [contactChoices, setContactChoices] = useState(contacts);
  const [partyKind, setPartyKind] = useState<"none" | ContactKind>(() => (
    invoice?.invoiceType === "customer" ? "customers" : invoice?.invoiceType === "supplier" ? "suppliers"
      : invoice?.customerId ? "customers" : invoice?.supplierId ? "suppliers"
        : invoice?.sourceDocumentCategory === "customer_invoice" ? "customers"
          : invoice?.sourceDocumentCategory === "supplier_invoice" ? "suppliers"
      : sourceDocument?.category === "customer_invoice" ? "customers"
        : sourceDocument?.category === "supplier_invoice" ? "suppliers"
      : initialPartyType === "customer" ? "customers" : initialPartyType === "supplier" ? "suppliers" : "none"
  ));
  const [partyId, setPartyId] = useState(invoice?.customerId ?? invoice?.supplierId ?? initialPartyId ?? "");
  const [clientName, setClientName] = useState(invoice?.clientName ?? "");
  const [quickName, setQuickName] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickPending, setQuickPending] = useState(false);
  const [personalCurrency, setPersonalCurrency] = useState(invoice?.currency ?? "EUR");
  const [subtotal, setSubtotal] = useState(invoice
    ? invoice.subtotal === null ? "" : formatInvoiceAmount(invoice.subtotal)
    : sourceDocument ? "" : formatInvoiceAmount(0));
  const [vatRate, setVatRate] = useState(invoice?.vatRate?.toFixed(2) ?? (sourceDocument ? "" : "20"));
  const [status, setStatus] = useState(editableStatus(invoice?.status ?? (
    "pending"
  )));
  const calculated = calculateInvoiceAmounts(subtotal, vatRate);
  const selectedCompany = companies.find((company) => company.id === companyId);
  const currency = selectedCompany?.currency ?? personalCurrency;
  const scopedContacts = contactChoices.filter((contact) => (
    companyId ? contact.companyId === companyId : contact.companyId === null && contact.userId !== null
  ));
  const selectedParty = scopedContacts.find((contact) => contact.id === partyId);

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  async function quickCreateContact() {
    if (partyKind === "none") return;
    setQuickPending(true);
    setQuickError(null);
    const data = new FormData();
    data.set("name", quickName);
    data.set("email", "");
    data.set("phone", "");
    data.set("address", "");
    data.set("notes", "");
    const result = await createContact(partyKind, companyId || null, data);
    setQuickPending(false);
    if (result.error) {
      setQuickError(result.error);
      return;
    }
    const createdContact = result.contact;
    if (!createdContact) {
      setQuickError("La création du tiers a échoué.");
      return;
    }

    const createdAt = new Date().toISOString();
    setContactChoices((previous) => [...previous, {
      id: createdContact.id,
      name: createdContact.name,
      kind: createdContact.kind,
      userId: createdContact.userId,
      companyId: createdContact.companyId,
      email: null,
      phone: null,
      address: null,
      notes: null,
      createdAt,
      updatedAt: createdAt,
    }]);
    setPartyId(createdContact.id);
    setClientName(createdContact.name);
    setQuickName("");
  }

  return (
    <form action={formAction} className="invoice-edit-form">
      <div className="invoice-form-title">
        <div><span className="panel-kicker">{invoice ? "Modification" : "Nouvelle facture"}</span><h2 id="invoice-form-heading">{invoice ? "Modifier la facture" : "Créer une facture"}</h2></div>
        <button className="text-button" type="button" onClick={onCancel}>Annuler</button>
      </div>
      {invoice ? <input type="hidden" name="invoiceId" value={invoice.id} /> : null}
      {sourceDocument ? <input type="hidden" name="documentId" value={sourceDocument.id} /> : null}
      {sourceDocument ? (
        <div className="document-information">
          Document source : <strong>{sourceDocument.fileName}</strong>. Les champs ci-dessous sont à saisir manuellement ; rien n’a été extrait automatiquement.
        </div>
      ) : null}
      {!invoice ? (
        <label className="invoice-field">
          <span>Espace de données</span>
          <select name="companyId" value={sourceDocument?.companyId ?? companyId} disabled={Boolean(sourceDocument)} onChange={(event) => {
            setCompanyId(event.target.value);
            setPartyKind("none");
            setPartyId("");
          }}>
            <option value="">Espace personnel</option>
            {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
          </select>
          {sourceDocument ? <input type="hidden" name="companyId" value={sourceDocument.companyId} /> : null}
        </label>
      ) : <input type="hidden" name="companyId" value={companyId} />}
      {selectedCompany ? (
        <input type="hidden" name="currency" value={selectedCompany.currency} />
      ) : (
        <label className="invoice-field">
          <span>Devise</span>
          <select name="currency" value={personalCurrency} onChange={(event) => setPersonalCurrency(event.target.value)}>
            {["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      )}

      <div className="invoice-form-grid">
        {sourceDocument ? (
          <div className="invoice-field">
            <span>Type de tiers</span>
            <strong>{partyKind === "customers" ? "Client" : "Fournisseur"}</strong>
          </div>
        ) : (
          <label className="invoice-field">
            <span>Sens de la facture</span>
            <select
              value={partyKind}
              onChange={(event) => {
                setPartyKind(event.target.value as "none" | ContactKind);
                setPartyId("");
              }}
            >
              <option value="none">À préciser</option>
              <option value="customers">Facture client · à encaisser</option>
              <option value="suppliers">Facture fournisseur · à payer</option>
            </select>
          </label>
        )}
        {partyKind !== "none" ? (
          <label className="invoice-field">
            <span>{partyKind === "customers" ? "Client" : "Fournisseur"} existant</span>
            <select
              value={partyId}
              onChange={(event) => {
                const nextId = event.target.value;
                setPartyId(nextId);
                const contact = scopedContacts.find(({ id }) => id === nextId);
                if (contact) setClientName(contact.name);
              }}
            >
              <option value="">Aucun tiers associé</option>
              {scopedContacts.filter((contact) => contact.kind === partyKind).map((contact) => <option value={contact.id} key={contact.id}>{contact.name}</option>)}
            </select>
          </label>
        ) : null}
        {partyKind !== "none" && !selectedParty ? (
          <div className="invoice-field">
            <span>Créer un {partyKind === "customers" ? "client" : "fournisseur"}</span>
            <div className="contact-quick-create">
              <input aria-label="Nom du nouveau tiers" value={quickName} onChange={(event) => setQuickName(event.target.value)} maxLength={200} />
              <button className="text-button" type="button" onClick={quickCreateContact} disabled={quickPending || !quickName.trim()}>
                {quickPending ? "Création…" : "Créer et associer"}
              </button>
            </div>
            {quickError ? <p className="auth-message is-error" role="alert">{quickError}</p> : null}
          </div>
        ) : null}
        <input type="hidden" name="customerId" value={partyKind === "customers" ? partyId : ""} />
        <input type="hidden" name="supplierId" value={partyKind === "suppliers" ? partyId : ""} />
        <input type="hidden" name="invoiceType" value={partyKind === "customers" ? "customer" : partyKind === "suppliers" ? "supplier" : ""} />
        {invoice?.customerId || invoice?.supplierId ? <input type="hidden" name="counterpartyUpdate" value="true" /> : null}
        <label className="invoice-field">
          <span>{selectedParty ? "Nom du tiers associé" : partyKind === "suppliers" ? "Nom du fournisseur" : "Nom du client"}</span>
          <input name="clientName" value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={200} autoComplete="organization" readOnly={Boolean(selectedParty)} required />
        </label>
        <label className="invoice-field">
          <span>Numéro de facture *</span>
          <input name="invoiceNumber" defaultValue={invoice?.invoiceNumber ?? ""} maxLength={80} placeholder="FAC-2026-001" required />
        </label>
        <label className="invoice-field invoice-field-wide">
          <span>Description</span>
          <textarea name="description" defaultValue={invoice?.description ?? ""} maxLength={2000} rows={3} required />
        </label>
        <label className="invoice-field">
          <span>Montant HT ({currency})</span>
          <input name="subtotal" type="number" min="0" max="999999999999.99" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} required />
        </label>
        <label className="invoice-field">
          <span>Taux de TVA (%)</span>
          <input name="vatRate" type="number" min="0" max="100" step="0.01" value={vatRate} onChange={(event) => setVatRate(event.target.value)} required />
        </label>
        <div className="invoice-calculated-total" aria-live="polite">
          <span>TVA calculée</span><strong>{calculated ? formatMoney(calculated.vatAmount, currency) : "—"}</strong>
          <span>Montant TTC calculé</span><strong>{calculated ? formatMoney(calculated.total, currency) : "—"}</strong>
        </div>
        <label className="invoice-field">
          <span>Date d’émission</span>
          <input name="issueDate" type="date" defaultValue={invoice?.issueDate ?? (sourceDocument ? "" : today())} required />
        </label>
        <label className="invoice-field">
          <span>Date d’échéance</span>
          <input name="dueDate" type="date" defaultValue={invoice?.dueDate ?? (sourceDocument ? "" : today())} required />
        </label>
        <label className="invoice-field">
          <span>Statut</span>
          <select name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} required>
              <option value="pending">{partyKind === "customers" ? "Impayée" : "À payer"}</option>
              {partyKind !== "customers" || invoice?.status === "paid" ? <option value="paid">Payée</option> : null}
          </select>
        </label>
      </div>

      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      {contactWarning ? <p className="auth-message is-error" role="status">{contactWarning}</p> : null}
      <p className="contact-form-hint">Les factures existantes restent sans relation tant qu’un tiers n’est pas explicitement sélectionné. <Link href={partyKind === "suppliers" ? "/suppliers" : "/customers"}>Gérer les tiers</Link></p>
      <div className="invoice-form-actions">
        <button className="primary-button" type="submit" disabled={pending || !calculated}>
          {pending ? "Enregistrement…" : "Enregistrer la facture"}
        </button>
        <button className="text-button" type="button" onClick={onCancel} disabled={pending}>Annuler</button>
      </div>
    </form>
  );
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
}
