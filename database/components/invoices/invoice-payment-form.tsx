"use client";

import { useActionState, useEffect } from "react";
import { recordInvoicePayment, type InvoiceActionState } from "@/app/invoices/actions";

export function InvoicePaymentForm({
  companyId,
  invoiceId,
  balance,
  today,
  onSaved,
}: {
  companyId: string | null;
  invoiceId: string;
  balance: number;
  today: string;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(async (_previous: InvoiceActionState, formData: FormData) => (
    recordInvoicePayment(
      companyId,
      invoiceId,
      String(formData.get("paymentDate") ?? ""),
      String(formData.get("amount") ?? ""),
      String(formData.get("reference") ?? ""),
      String(formData.get("note") ?? ""),
    )
  ), {});

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  return (
    <form action={action} className="expense-payment-form">
      <label className="invoice-field">
        <span>Montant reçu</span>
        <input name="amount" type="number" min="0.01" max={balance.toFixed(2)} step="0.01" required />
      </label>
      <label className="invoice-field">
        <span>Date du paiement</span>
        <input name="paymentDate" type="date" max={today} defaultValue={today} required />
      </label>
      <label className="invoice-field">
        <span>Référence (facultative)</span>
        <input name="reference" maxLength={160} />
      </label>
      <label className="invoice-field invoice-field-wide">
        <span>Note (facultative)</span>
        <textarea name="note" maxLength={2000} rows={2} />
      </label>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending || balance <= 0}>
        {pending ? "Enregistrement…" : "Enregistrer le paiement"}
      </button>
    </form>
  );
}
