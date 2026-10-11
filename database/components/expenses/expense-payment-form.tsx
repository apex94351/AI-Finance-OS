"use client";

import { useActionState, useEffect } from "react";
import { recordExpensePayment, type ExpenseActionState } from "@/app/expenses/actions";

export function ExpensePaymentForm({
  companyId,
  expenseId,
  balance,
  today,
  onSaved,
}: {
  companyId: string | null;
  expenseId: string;
  balance: number;
  today: string;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(async (_previous: ExpenseActionState, formData: FormData) => (
    recordExpensePayment(
      companyId,
      expenseId,
      String(formData.get("paymentDate") ?? ""),
      String(formData.get("amount") ?? ""),
    )
  ), {});

  useEffect(() => {
    if (state.success) onSaved();
  }, [onSaved, state.success]);

  return (
    <form action={action} className="expense-payment-form">
      <label className="invoice-field">
        <span>Montant versé</span>
        <input name="amount" type="number" min="0.01" max={balance.toFixed(2)} step="0.01" required />
      </label>
      <label className="invoice-field">
        <span>Date du paiement</span>
        <input name="paymentDate" type="date" max={today} defaultValue={today} required />
      </label>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer le paiement"}</button>
    </form>
  );
}
