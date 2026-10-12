// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseRecord, RecurringExpenseRecord } from "@/services/expenses";

const refresh = vi.hoisted(() => vi.fn());
const recordSupplierInvoicePayment = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/invoices/actions", () => ({ recordSupplierInvoicePayment }));
vi.mock("@/app/expenses/actions", () => ({
  deleteExpense: vi.fn(),
  saveExpense: vi.fn(),
  setRecurringExpenseStatus: vi.fn(),
}));

import { ExpenseManager } from "@/database/components/expenses/expense-manager";

const expenses: ExpenseRecord[] = [{
  id: "e1",
  userId: "u1",
  companyId: null,
  label: "Abonnement cloud",
  amount: 40,
  currency: "EUR",
  expenseDate: "2026-10-03",
  category: "Logiciel",
  supplierId: "s1",
  supplierName: "Cloud Co",
  status: "pending",
  notes: null,
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
}];

function recurringExpense(overrides: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord {
  return {
    id: "rec-1",
    userId: "u1",
    companyId: null,
    label: "Abonnement hebdomadaire",
    amount: 10,
    currency: "EUR",
    subtotalHt: null,
    vatRate: null,
    vatAmount: null,
    supplierId: null,
    supplierName: null,
    documentId: null,
    documentName: null,
    category: "Logiciel",
    frequency: "weekly",
    startDate: "2026-10-07",
    nextDueDate: "2026-10-14",
    endDate: "2026-10-21",
    status: "active",
    pausedOn: null,
    notes: null,
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    ...overrides,
  };
}

const renderManager = (props: { expenses?: ExpenseRecord[]; recurringExpenses?: RecurringExpenseRecord[]; loadError?: string | null } = {}) => (
  <ExpenseManager
    companies={[]}
    suppliers={[]}
    documents={[]}
    expenses={props.expenses ?? expenses}
    payments={[]}
    recurringExpenses={props.recurringExpenses ?? []}
    loadError={props.loadError ?? null}
    supplierWarning={null}
    today="2026-10-10"
  />
);

describe("expense manager", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("shows real records and filters them by search", () => {
    render(renderManager());
    expect(screen.getByText("Abonnement cloud")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tout voir/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une dépense" }), { target: { value: "inconnu" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
    expect(screen.getByText("À payer · solde non échu")).toBeTruthy();
    expect(screen.getByText("En retard · solde restant")).toBeTruthy();
  });

  it("shows an unknown balance without offering a payment based on a false zero", () => {
    render(renderManager({ expenses: [{ ...expenses[0]!, paidAmount: null }] }));

    expect(screen.getByText("Solde à vérifier")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Payer" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("doit être vérifié");
  });

  it("provides useful empty and retryable error states", () => {
    const { rerender } = render(renderManager({ expenses: [] }));
    expect(screen.getByText("Aucune dépense enregistrée")).toBeTruthy();
    rerender(renderManager({ expenses: [], loadError: "Chargement impossible" }));
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows a real zero month while leaving future periods unvalued", () => {
    render(renderManager());
    const chart = screen.getByRole("region", { name: "Évolution des dépenses" });
    expect(within(chart).getByRole("button", { name: "Par mois" })).toBeTruthy();
    expect(within(chart).getByRole("img", { name: "Évolution des dépenses en EUR" })).toBeTruthy();
  });

  it("shows an exact keyboard-accessible tooltip and deduplicates recorded recurring occurrences", () => {
    render(renderManager({
      recurringExpenses: [recurringExpense()],
      expenses: [{
        ...expenses[0]!,
        amount: 40,
        expenseDate: "2026-10-07",
        recurrenceId: "rec-1",
        recurrenceDate: "2026-10-07",
      }],
    }));

    const chart = screen.getByRole("img", { name: "Évolution des dépenses en EUR" });
    const monthBucket = chart.querySelector('g[data-period="2026-10"]');
    expect(monthBucket).toBeTruthy();
    expect(monthBucket?.querySelector(".dashboard-chart-bar")).toBeTruthy();
    expect(monthBucket?.querySelector(".expense-chart-recurring-bar")).toBeTruthy();

    fireEvent.pointerEnter(monthBucket!);
    expect(screen.getByRole("tooltip").textContent).toContain("60,00 €");
    fireEvent.pointerLeave(monthBucket!);
    fireEvent.focus(monthBucket!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("oct. 2026");
    expect(tooltip.textContent).toContain("60,00 €");
    expect(tooltip.textContent).toContain("40,00 € enregistrés");
    expect(tooltip.textContent).toContain("20,00 € d’échéances récurrentes prévues");
  });

  it("offers dated payment for an unlinked supplier invoice represented in Expenses", () => {
    render(renderManager({ expenses: [{
      ...expenses[0]!,
      id: "supplier-invoice-1",
      label: "Facture FOU-2026-10",
      invoiceId: "supplier-invoice-1",
      invoiceNumber: "FOU-2026-10",
      sourceType: "supplier_invoice",
      paidAmount: 0,
    }] }));

    fireEvent.click(screen.getByRole("button", { name: "Payer" }));

    expect(screen.getByRole("heading", { name: /Enregistrer un paiement.*Facture FOU-2026-10/ })).toBeTruthy();
    expect(screen.getByLabelText("Date réelle du paiement")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmer le paiement" })).toBeTruthy();
  });

  it("uses the existing dated expense payment form for a persisted expense", () => {
    render(renderManager());

    fireEvent.click(screen.getByRole("button", { name: "Payer" }));

    expect(screen.getByRole("heading", { name: /Enregistrer un paiement.*Abonnement cloud/ })).toBeTruthy();
    expect(screen.getByLabelText("Montant versé")).toBeTruthy();
    expect(screen.getByLabelText("Date du paiement")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enregistrer le paiement" })).toBeTruthy();
  });
});
