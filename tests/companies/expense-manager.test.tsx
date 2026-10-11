// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseRecord } from "@/services/expenses";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
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
const renderManager = (props: { expenses?: ExpenseRecord[]; loadError?: string | null } = {}) => (
  <ExpenseManager
    companies={[]}
    suppliers={[]}
    documents={[]}
    expenses={props.expenses ?? expenses}
    payments={[]}
    recurringExpenses={[]}
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
});
