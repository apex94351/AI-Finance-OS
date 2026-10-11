"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveRecurringExpense } from "@/app/expenses/actions";
import type { ExpenseSupplierRow, RecurringExpenseRecord } from "@/services/expenses";
import type { ExpenseCompany } from "./expense-manager";

type ExpenseSupplier = Pick<ExpenseSupplierRow, "id" | "user_id" | "company_id" | "name">;
type ExpenseDocument = { id: string; user_id: string | null; company_id: string | null; file_name: string };

export function RecurringExpenseForm({
  companies,
  suppliers,
  documents,
  recurringExpense,
  initialCompanyId,
  today,
  onCancel,
  onSaved,
}: {
  companies: ExpenseCompany[];
  suppliers: ExpenseSupplier[];
  documents: ExpenseDocument[];
  recurringExpense: RecurringExpenseRecord | null;
  initialCompanyId: string;
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveRecurringExpense, {});
  const [companyId, setCompanyId] = useState(recurringExpense?.companyId ?? initialCompanyId);
  const [currency, setCurrency] = useState(recurringExpense?.currency ?? "EUR");
  const company = companies.find(({ id }) => id === companyId);
  const scopedSuppliers = useMemo(() => suppliers.filter((item) => (
    companyId ? item.company_id === companyId : item.company_id === null && item.user_id !== null
  )), [companyId, suppliers]);
  const scopedDocuments = useMemo(() => documents.filter((item) => (
    companyId ? item.company_id === companyId : item.company_id === null && item.user_id !== null
  )), [companyId, documents]);

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  return (
    <form action={formAction} className="invoice-edit-form">
      <div className="invoice-form-title">
        <div><span className="panel-kicker">Dépense récurrente</span><h2>{recurringExpense ? "Modifier la récurrence" : "Nouvelle récurrence"}</h2></div>
        <button className="text-button" type="button" onClick={onCancel}>Annuler</button>
      </div>
      <input type="hidden" name="recurringId" value={recurringExpense?.id ?? ""} />
      <label className="invoice-field">
        <span>Espace de données</span>
        <select name="companyId" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
          <option value="">Espace personnel</option>{companies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      {company ? <input type="hidden" name="currency" value={company.currency} /> : (
        <label className="invoice-field"><span>Devise</span><select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"].map((item) => <option value={item} key={item}>{item}</option>)}
        </select></label>
      )}
      <div className="invoice-form-grid">
        <label className="invoice-field invoice-field-wide"><span>Nom</span><input name="label" defaultValue={recurringExpense?.label ?? ""} maxLength={200} required /></label>
        <label className="invoice-field"><span>Montant TTC ({company?.currency ?? currency})</span><input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" defaultValue={recurringExpense?.amount ?? ""} required /></label>
        <label className="invoice-field"><span>Montant HT (facultatif)</span><input name="subtotalHt" type="number" min="0" max="999999999999.99" step="0.01" defaultValue={recurringExpense?.subtotalHt ?? ""} /></label>
        <label className="invoice-field"><span>TVA (facultatif)</span><input name="vatAmount" type="number" min="0" max="999999999999.99" step="0.01" defaultValue={recurringExpense?.vatAmount ?? ""} /></label>
        <label className="invoice-field"><span>Taux de TVA (facultatif)</span><input name="vatRate" type="number" min="0" max="100" step="0.01" defaultValue={recurringExpense?.vatRate ?? ""} /></label>
        <label className="invoice-field"><span>Fréquence</span><select name="frequency" defaultValue={recurringExpense?.frequency ?? "monthly"}>
          <option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option><option value="yearly">Annuelle</option>
        </select></label>
        <label className="invoice-field"><span>Date de début</span><input name="startDate" type="date" defaultValue={recurringExpense?.startDate ?? today} required /></label>
        <label className="invoice-field"><span>Date de fin (facultative)</span><input name="endDate" type="date" defaultValue={recurringExpense?.endDate ?? ""} /></label>
        <label className="invoice-field"><span>Catégorie</span><input name="category" defaultValue={recurringExpense?.category ?? ""} maxLength={100} /></label>
        <label className="invoice-field"><span>Fournisseur</span><select name="supplierId" defaultValue={recurringExpense?.supplierId ?? ""}>
          <option value="">Aucun fournisseur</option>{scopedSuppliers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <label className="invoice-field"><span>Justificatif existant</span><select name="documentId" defaultValue={recurringExpense?.documentId ?? ""}>
          <option value="">Aucun justificatif</option>{scopedDocuments.map((item) => <option value={item.id} key={item.id}>{item.file_name}</option>)}
        </select></label>
        <label className="invoice-field invoice-field-wide"><span>Notes</span><textarea name="notes" defaultValue={recurringExpense?.notes ?? ""} maxLength={2000} rows={3} /></label>
      </div>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      <div className="invoice-form-actions">
        <button className="primary-button" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la récurrence"}</button>
        <button className="text-button" type="button" onClick={onCancel} disabled={pending}>Annuler</button>
      </div>
    </form>
  );
}
