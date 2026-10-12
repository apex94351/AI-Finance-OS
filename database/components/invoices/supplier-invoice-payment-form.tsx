"use client";

import { useActionState, useEffect, useState } from "react";
import { recordSupplierInvoicePayment, type InvoiceActionState } from "@/app/invoices/actions";

export function SupplierInvoicePaymentForm({
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
  const [requestId, setRequestId] = useState("");
  const [state, action, pending] = useActionState(async (_previous: InvoiceActionState, formData: FormData) => (
    recordSupplierInvoicePayment(
      companyId,
      invoiceId,
      String(formData.get("paymentDate") ?? ""),
      String(formData.get("amount") ?? ""),
      String(formData.get("requestId") ?? ""),
    )
  ), {});

  useEffect(() => {
    setRequestId(crypto.randomUUID());
  }, [invoiceId]);

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  return (
    <form action={action} className="expense-payment-form">
      <input type="hidden" name="requestId" value={requestId} />
      <label className="invoice-field">
        <span>Montant payé</span>
        <input name="amount" type="number" min="0.01" max={balance.toFixed(2)} step="0.01" required />
      </label>
      <label className="invoice-field">
        <span>Date réelle du paiement</span>
        <input name="paymentDate" type="date" max={today} defaultValue={today} required />
      </label>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending || balance <= 0 || !requestId}>
        {pending ? "Enregistrement…" : "Confirmer le paiement"}
      </button>
    </form>
  );
}
