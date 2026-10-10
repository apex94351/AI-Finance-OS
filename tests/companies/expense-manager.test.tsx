// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseRecord } from "@/services/expenses";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/expenses/actions", () => ({ saveExpense: vi.fn() }));

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

describe("expense manager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows real records and filters them by search", () => {
    render(<ExpenseManager companies={[]} suppliers={[]} expenses={expenses} loadError={null} supplierWarning={null} today="2026-10-10" />);
    expect(screen.getByText("Abonnement cloud")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher une dépense" }), { target: { value: "inconnu" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });

  it("provides useful empty and retryable error states", () => {
    const { rerender } = render(<ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError={null} supplierWarning={null} today="2026-10-10" />);
    expect(screen.getByText("Aucune dépense enregistrée")).toBeTruthy();
    rerender(<ExpenseManager companies={[]} suppliers={[]} expenses={[]} loadError="Chargement impossible" supplierWarning={null} today="2026-10-10" />);
    expect(screen.getByRole("alert").textContent).toContain("Chargement impossible");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
