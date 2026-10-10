import { describe, expect, it } from "vitest";
import { expenseInputSchema, filterExpenses, sumExpensesByCurrency, type ExpenseRecord } from "@/services/expenses";

const validInput = {
  label: "Abonnement logiciel",
  amount: "35.50",
  currency: "eur",
  expenseDate: "2026-10-05",
  category: "Logiciel",
  supplierId: "",
  status: "pending",
  notes: "",
};

const records: ExpenseRecord[] = [
  {
    id: "a", userId: "u1", companyId: null, label: "Abonnement cloud", amount: 40, currency: "EUR",
    expenseDate: "2026-10-03", category: "Logiciel", supplierId: "s1", supplierName: "Cloud Co",
    status: "pending", notes: null, createdAt: "", updatedAt: "",
  },
  {
    id: "b", userId: null, companyId: "c1", label: "Train", amount: 120, currency: "EUR",
    expenseDate: "2026-09-28", category: "Déplacement", supplierId: null, supplierName: null,
    status: "paid", notes: null, createdAt: "", updatedAt: "",
  },
  {
    id: "c", userId: "u1", companyId: null, label: "Annulée", amount: 15, currency: "USD",
    expenseDate: "2026-10-07", category: "Logiciel", supplierId: null, supplierName: null,
    status: "cancelled", notes: null, createdAt: "", updatedAt: "",
  },
];

describe("expense validation and registry operations", () => {
  it("requires a positive finite amount and normalizes currency", () => {
    expect(expenseInputSchema.parse(validInput)).toMatchObject({ amount: 35.5, currency: "EUR" });
    for (const amount of ["0", "-1", "abc", "Infinity"]) {
      expect(expenseInputSchema.safeParse({ ...validInput, amount }).success).toBe(false);
    }
  });

  it("searches by label and supplier and applies category, status, date and owner filters", () => {
    expect(filterExpenses(records, {
      query: "cloud", category: "Logiciel", status: "pending", period: "month",
      ownerId: "personal", sort: "date-desc", today: "2026-10-10",
    }).map(({ id }) => id)).toEqual(["a"]);
    expect(filterExpenses(records, {
      query: "introuvable", category: "all", status: "all", period: "all",
      ownerId: "all", sort: "date-desc", today: "2026-10-10",
    })).toEqual([]);
  });

  it("sorts by date or amount and totals separately by currency excluding cancelled records", () => {
    expect(filterExpenses(records, {
      query: "", category: "all", status: "all", period: "all",
      ownerId: "all", sort: "amount-desc", today: "2026-10-10",
    }).map(({ id }) => id)).toEqual(["b", "a", "c"]);
    expect([...sumExpensesByCurrency(records)]).toEqual([["EUR", 160]]);
    expect([...sumExpensesByCurrency([
      { ...records[0], amount: 0.1 },
      { ...records[0], id: "fraction", amount: 0.2 },
    ])]).toEqual([["EUR", 0.3]]);
  });
});
