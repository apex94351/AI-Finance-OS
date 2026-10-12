import { describe, expect, it } from "vitest";
import {
  buildAnnualExpenseSeries,
  buildCurrentMonthRecurringExpenseTotals,
  buildExpenseFinancialSummary,
  buildMonthlyExpenseSeries,
  expenseInputSchema,
  filterExpenses,
  getEffectiveExpenseStatus,
  normalizeRecurringMonthlyCost,
  sumExpensesByCurrency,
  type ExpensePaymentRecord,
  type ExpenseRecord,
  type RecurringExpenseRecord,
} from "@/services/expenses";

const validInput = {
  label: "Abonnement logiciel",
  amount: "35.50",
  currency: "eur",
  expenseDate: "2026-10-05",
  dueDate: "",
  subtotalHt: "",
  vatRate: "",
  vatAmount: "",
  category: "Logiciel",
  supplierId: "",
  documentId: "",
  invoiceId: "",
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

function recurring(id: string, overrides: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord {
  return {
    id,
    userId: "u1",
    companyId: null,
    label: `Récurrence ${id}`,
    amount: 30,
    currency: "EUR",
    subtotalHt: null,
    vatRate: null,
    vatAmount: null,
    supplierId: null,
    supplierName: null,
    documentId: null,
    documentName: null,
    category: "Logiciel",
    frequency: "monthly",
    startDate: "2026-01-15",
    nextDueDate: "2026-10-15",
    endDate: null,
    status: "active",
    pausedOn: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("expense validation and registry operations", () => {
  it("requires a positive finite amount and normalizes currency", () => {
    expect(expenseInputSchema.parse(validInput)).toMatchObject({ amount: 35.5, currency: "EUR" });
    expect(expenseInputSchema.parse({ ...validInput, status: "overdue" })).toMatchObject({ status: "overdue" });
    expect(expenseInputSchema.parse({ ...validInput, status: "paid" })).toMatchObject({ status: "paid" });
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

  it("retains a manually selected overdue status and derives overdue only for unpaid past-due expenses", () => {
    expect(getEffectiveExpenseStatus({ amount: 40, status: "overdue", dueDate: "2026-11-01" }, 0, "2026-10-10")).toBe("overdue");
    expect(getEffectiveExpenseStatus({ amount: 40, status: "pending", dueDate: "2026-10-09" }, 0, "2026-10-10")).toBe("overdue");
    expect(getEffectiveExpenseStatus({ amount: 40, status: "paid", dueDate: "2026-10-09" }, 10, "2026-10-10")).toBe("paid");
    expect(getEffectiveExpenseStatus({ amount: 40, status: "overdue", dueDate: "2026-10-09" }, 40, "2026-10-10")).toBe("paid");
    expect(getEffectiveExpenseStatus({ amount: 40, status: "pending", dueDate: "2026-10-11" }, 0, "2026-10-10")).toBe("pending");
  });

  it("calculates four month indicators from expense balances and dated payment entries", () => {
    const monthlyExpenses: ExpenseRecord[] = [
      { ...records[0], id: "late", amount: 100, paidAmount: 25, status: "overdue", dueDate: "2026-10-01" },
      { ...records[0], id: "unpaid", amount: 80, status: "pending", dueDate: "2026-10-20" },
      { ...records[0], id: "paid", amount: 50, paidAmount: 50, status: "paid", dueDate: "2026-09-20" },
    ];
    const payments: ExpensePaymentRecord[] = [{
      id: "payment-1", expenseId: "late", paymentDate: "2026-10-08", amount: 25, createdAt: "",
    }, {
      id: "payment-2", expenseId: "paid", paymentDate: "2026-09-25", amount: 50, createdAt: "",
    }];
    const summary = buildExpenseFinancialSummary(monthlyExpenses, payments, 2026, 10, "2026-10-10");
    expect(summary.monthSpend.get("EUR")).toBe(230);
    expect(summary.payable.get("EUR")).toBe(80);
    expect(summary.overdue.get("EUR")).toBe(75);
    expect(summary.paidThisMonth.get("EUR")).toBe(25);
    expect(summary.incompleteBalanceCount).toBe(0);
  });

  it("attributes a linked supplier invoice expense to the actual payment month, not the invoice date", () => {
    const invoiceExpense: ExpenseRecord = {
      ...records[0]!,
      id: "supplier-expense-linked",
      label: "Facture fournisseur FOU-7",
      amount: 120,
      expenseDate: "2026-09-28",
      dueDate: "2026-10-05",
      invoiceId: "supplier-invoice-7",
      status: "paid",
      paidAmount: 120,
    };
    const summary = buildExpenseFinancialSummary([invoiceExpense], [{
      id: "supplier-payment",
      expenseId: invoiceExpense.id,
      paymentDate: "2026-10-08",
      amount: 120,
      createdAt: "2026-10-08T10:00:00Z",
    }], 2026, 10, "2026-10-12");

    expect(summary.monthSpend.size).toBe(0);
    expect(summary.paidThisMonth.get("EUR")).toBe(120);
  });

  it("counts a partial supplier invoice payment only once and leaves the unpaid remainder payable", () => {
    const linkedExpense: ExpenseRecord = {
      ...records[0]!,
      id: "supplier-partial-expense",
      amount: 120,
      expenseDate: "2026-09-28",
      invoiceId: "supplier-partial-invoice",
      paidAmount: 40,
      status: "pending",
    };
    const payment: ExpensePaymentRecord = {
      id: "supplier-partial-payment",
      expenseId: linkedExpense.id,
      paymentDate: "2026-10-08",
      amount: 40,
      createdAt: "2026-10-08T10:00:00Z",
    };
    const summary = buildExpenseFinancialSummary([linkedExpense], [payment], 2026, 10, "2026-10-12");

    expect(summary.paidThisMonth.get("EUR")).toBe(40);
    expect(summary.payable.get("EUR")).toBe(80);
  });

  it("excludes an unknown payment balance instead of treating an unavailable ledger as unpaid", () => {
    const summary = buildExpenseFinancialSummary([
      { ...records[0]!, id: "unknown-balance", amount: 100, paidAmount: null, status: "pending" },
    ], [], 2026, 10, "2026-10-10");

    expect(summary.payable.size).toBe(0);
    expect(summary.overdue.size).toBe(0);
    expect(summary.incompleteBalanceCount).toBe(1);
  });

  it("builds actual monthly and annual chart periods and leaves future months empty", () => {
    const monthly = buildMonthlyExpenseSeries(records, 2026, "2026-10-10");
    expect(monthly).toHaveLength(12);
    expect(monthly[9]?.amount).toBe(40);
    expect(monthly[10]?.amount).toBeNull();
    expect(monthly[11]?.amount).toBeNull();
    expect(buildAnnualExpenseSeries(records, 2026, "2026-10-10").map(({ period }) => period)).toEqual(["2026"]);
  });

  it("normalizes recurring costs with the specified periods", () => {
    expect(normalizeRecurringMonthlyCost(12, "weekly")).toBe(52);
    expect(normalizeRecurringMonthlyCost(300, "quarterly")).toBe(100);
    expect(normalizeRecurringMonthlyCost(1200, "yearly")).toBe(100);
    expect(normalizeRecurringMonthlyCost(30, "monthly")).toBe(30);
  });

  it("plans only active occurrences inside the current month and respects quarterly anchors and end dates", () => {
    const totals = buildCurrentMonthRecurringExpenseTotals([
      recurring("quarterly", {
        amount: 120,
        frequency: "quarterly",
        startDate: "2026-01-31",
        nextDueDate: "2026-10-31",
      }),
      recurring("monthly-ended", {
        amount: 50,
        startDate: "2026-09-30",
        nextDueDate: "2026-10-30",
        endDate: "2026-10-20",
      }),
      recurring("paused", { status: "paused", amount: 80 }),
      recurring("next-month", { nextDueDate: "2026-11-15", amount: 90 }),
    ], [], "2026-10-11");

    expect([...totals]).toEqual([["EUR", 120]]);
  });

  it("deduplicates materialized occurrences and includes weekly dates only through this month", () => {
    const totals = buildCurrentMonthRecurringExpenseTotals([
      recurring("weekly", {
        amount: 25,
        frequency: "weekly",
        startDate: "2026-10-07",
        nextDueDate: "2026-10-07",
      }),
    ], [
      { ...records[0]!, id: "occurrence", recurrenceId: "weekly", recurrenceDate: "2026-10-14", expenseDate: "2026-10-14" },
    ], "2026-10-11");

    expect([...totals]).toEqual([["EUR", 75]]);
  });
});
