"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveExpense, type ExpenseActionState } from "@/app/expenses/actions";
import type { ExpenseRecord, ExpenseSupplierRow } from "@/services/expenses";
import type { ExpenseCompany } from "./expense-manager";

type ExpenseSupplier = Pick<ExpenseSupplierRow, "id" | "user_id" | "company_id" | "name">;

const initialState: ExpenseActionState = {};

export function ExpenseForm({
  companies,
  suppliers,
  documents,
  invoices,
  expense,
  initialCompanyId,
  today,
  onCancel,
  onSaved,
}: {
  companies: ExpenseCompany[];
  suppliers: ExpenseSupplier[];
  documents: { id: string; user_id: string | null; company_id: string | null; file_name: string }[];
  invoices: ExpenseRecord[];
  expense: ExpenseRecord | null;
  initialCompanyId: string;
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveExpense, initialState);
  const [companyId, setCompanyId] = useState(expense?.companyId ?? initialCompanyId);
  const [currency, setCurrency] = useState(expense?.currency ?? "EUR");
  const selectedCompany = companies.find(({ id }) => id === companyId);
  const scopedSuppliers = useMemo(() => suppliers.filter((supplier) => (
    companyId ? supplier.company_id === companyId : supplier.company_id === null && supplier.user_id !== null
  )), [companyId, suppliers]);
  const scopedDocuments = useMemo(() => documents.filter((document) => (
    companyId ? document.company_id === companyId : document.company_id === null && document.user_id !== null
  )), [companyId, documents]);
  const scopedInvoices = useMemo(() => invoices.filter((invoice) => (
    companyId ? invoice.companyId === companyId : invoice.companyId === null && invoice.userId !== null
  )), [companyId, invoices]);

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  return (
    <form action={formAction} className="invoice-edit-form">
      <div className="invoice-form-title">
        <div><span className="panel-kicker">{expense ? "Modification" : "Nouvelle dépense"}</span><h2 id="expense-form-heading">{expense ? "Modifier la dépense" : "Ajouter une dépense"}</h2></div>
        <button className="text-button" type="button" onClick={onCancel}>Annuler</button>
      </div>
      {expense ? <input type="hidden" name="expenseId" value={expense.id} /> : null}
      {expense ? <input type="hidden" name="companyId" value={companyId} /> : (
        <label className="invoice-field">
          <span>Espace de données</span>
          <select name="companyId" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">Espace personnel</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
          </select>
        </label>
      )}
      {selectedCompany ? <input type="hidden" name="currency" value={selectedCompany.currency} /> : (
        <label className="invoice-field">
          <span>Devise</span>
          <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      )}
      <div className="invoice-form-grid">
        <label className="invoice-field invoice-field-wide"><span>Libellé</span><input name="label" defaultValue={expense?.label ?? ""} maxLength={200} required /></label>
        <label className="invoice-field"><span>Montant TTC ({selectedCompany?.currency ?? currency})</span><input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" defaultValue={expense?.amount ?? ""} required /></label>
        <label className="invoice-field"><span>Montant HT (facultatif)</span><input name="subtotalHt" type="number" min="0" max="999999999999.99" step="0.01" defaultValue={expense?.subtotalHt ?? ""} /></label>
        <label className="invoice-field"><span>Taux de TVA (facultatif)</span><input name="vatRate" type="number" min="0" max="100" step="0.01" defaultValue={expense?.vatRate ?? ""} /></label>
        <label className="invoice-field"><span>TVA (facultatif)</span><input name="vatAmount" type="number" min="0" max="999999999999.99" step="0.01" defaultValue={expense?.vatAmount ?? ""} /></label>
        <label className="invoice-field"><span>Date de dépense ou facture</span><input name="expenseDate" type="date" defaultValue={expense?.expenseDate ?? today} required /></label>
        <label className="invoice-field"><span>Échéance (facultative)</span><input name="dueDate" type="date" defaultValue={expense?.dueDate ?? ""} /></label>
        <label className="invoice-field"><span>Catégorie</span><input name="category" defaultValue={expense?.category ?? ""} maxLength={100} placeholder="Saisir une catégorie" /></label>
        <label className="invoice-field">
          <span>Fournisseur (facultatif)</span>
          <select name="supplierId" defaultValue={expense?.supplierId ?? ""}>
            <option value="">Aucun fournisseur</option>{scopedSuppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label className="invoice-field">
          <span>Statut de paiement</span>
          <select name="status" defaultValue={expense?.status ?? "pending"}>
            <option value="pending">À payer</option><option value="paid">Payée</option><option value="overdue">En retard</option><option value="cancelled">Annulée</option>
          </select>
        </label>
        <label className="invoice-field">
          <span>Facture fournisseur liée (facultatif)</span>
          <select name="invoiceId" defaultValue={expense?.invoiceId ?? ""}>
            <option value="">Aucune facture liée</option>
            {scopedInvoices.map((invoice) => <option value={invoice.invoiceId ?? invoice.id} key={invoice.id}>{invoice.label} · {invoice.supplierName ?? "Fournisseur"} · {invoice.amount.toFixed(2)} {invoice.currency}</option>)}
          </select>
        </label>
        <label className="invoice-field">
          <span>Justificatif existant (facultatif)</span>
          <select name="documentId" defaultValue={expense?.documentId ?? ""}>
            <option value="">Aucun justificatif</option>
            {scopedDocuments.map((document) => <option value={document.id} key={document.id}>{document.file_name}</option>)}
          </select>
        </label>
        <label className="invoice-field invoice-field-wide"><span>Description ou notes</span><textarea name="notes" defaultValue={expense?.notes ?? ""} maxLength={2000} rows={3} /></label>
      </div>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      <div className="invoice-form-actions">
        <button className="primary-button" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la dépense"}</button>
        <button className="text-button" type="button" onClick={onCancel} disabled={pending}>Annuler</button>
      </div>
    </form>
  );
}
