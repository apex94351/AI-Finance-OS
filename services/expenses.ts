import { z } from "zod";

export const expenseStatusSchema = z.enum(["pending", "paid", "overdue", "cancelled"]);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;
export const recurringExpenseFrequencySchema = z.enum(["weekly", "monthly", "quarterly", "yearly"]);
export type RecurringExpenseFrequency = z.infer<typeof recurringExpenseFrequencySchema>;
export const recurringExpenseStatusSchema = z.enum(["active", "paused", "stopped"]);
export type RecurringExpenseStatus = z.infer<typeof recurringExpenseStatusSchema>;

const optionalAmount = z.union([
  z.literal(""),
  z.string().trim().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/)
    .transform((value) => Number(value.replace(",", ".")))
    .pipe(z.number().finite().nonnegative().max(999999999999.99)),
]).transform((value) => value === "" ? null : value);

export const expenseInputSchema = z.object({
  label: z.string().trim().min(1, "Saisissez un libellé.").max(200),
  amount: z.string().trim().min(1, "Saisissez un montant.")
    .transform((value) => Number(value.replace(",", ".")))
    .pipe(z.number().finite().positive("Le montant doit être supérieur à zéro.").max(999999999999.99)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Sélectionnez une devise valide."),
  expenseDate: z.iso.date("Saisissez une date de dépense valide."),
  dueDate: z.union([z.literal(""), z.iso.date("Saisissez une date d’échéance valide.")])
    .transform((value) => value || null),
  subtotalHt: optionalAmount,
  vatRate: z.union([
    z.literal(""),
    z.string().trim().regex(/^(?:\d{1,3})(?:[.,]\d{1,2})?$/)
      .transform((value) => Number(value.replace(",", ".")))
      .pipe(z.number().finite().min(0).max(100)),
  ]).transform((value) => value === "" ? null : value),
  vatAmount: optionalAmount,
  category: z.string().trim().max(100).transform((value) => value || null),
  supplierId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  documentId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  invoiceId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]),
  notes: z.string().trim().max(2000).transform((value) => value || null),
}).superRefine((expense, context) => {
  if (expense.subtotalHt !== null && expense.vatAmount !== null
    && Math.abs(expense.subtotalHt + expense.vatAmount - expense.amount) > 0.01) {
    context.addIssue({ code: "custom", path: ["amount"], message: "Le montant TTC doit correspondre au montant HT et à la TVA." });
  }
  if (expense.dueDate && expense.dueDate < expense.expenseDate) {
    context.addIssue({ code: "custom", path: ["dueDate"], message: "L’échéance ne peut pas précéder la date de dépense." });
  }
  if (expense.invoiceId && expense.status === "cancelled") {
    context.addIssue({ code: "custom", path: ["invoiceId"], message: "Dissociez la facture avant d’annuler cette dépense." });
  }
});

export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const recurringExpenseInputSchema = z.object({
  label: z.string().trim().min(1, "Saisissez un libellé.").max(200),
  amount: z.string().trim().min(1, "Saisissez un montant.")
    .transform((value) => Number(value.replace(",", ".")))
    .pipe(z.number().finite().positive("Le montant doit être supérieur à zéro.").max(999999999999.99)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Sélectionnez une devise valide."),
  subtotalHt: optionalAmount,
  vatRate: z.union([
    z.literal(""),
    z.string().trim().regex(/^(?:\d{1,3})(?:[.,]\d{1,2})?$/)
      .transform((value) => Number(value.replace(",", ".")))
      .pipe(z.number().finite().min(0).max(100)),
  ]).transform((value) => value === "" ? null : value),
  vatAmount: optionalAmount,
  category: z.string().trim().max(100).transform((value) => value || null),
  supplierId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  documentId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  frequency: recurringExpenseFrequencySchema,
  startDate: z.iso.date(),
  endDate: z.union([z.literal(""), z.iso.date()]).transform((value) => value || null),
  notes: z.string().trim().max(2000).transform((value) => value || null),
}).superRefine((expense, context) => {
  if (expense.subtotalHt !== null && expense.vatAmount !== null
    && Math.abs(expense.subtotalHt + expense.vatAmount - expense.amount) > 0.01) {
    context.addIssue({ code: "custom", path: ["amount"], message: "Le montant TTC doit correspondre au montant HT et à la TVA." });
  }
  if (expense.endDate && expense.endDate < expense.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "La fin ne peut pas précéder le début." });
  }
});

export type RecurringExpenseInput = z.input<typeof recurringExpenseInputSchema>;

export interface ExpenseRecord {
  id: string;
  userId: string | null;
  companyId: string | null;
  label: string;
  amount: number;
  currency: string;
  expenseDate: string;
  dueDate?: string | null;
  subtotalHt?: number | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  category: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: ExpenseStatus;
  documentId?: string | null;
  documentName?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  recurrenceId?: string | null;
  recurrenceDate?: string | null;
  sourceType?: "expense" | "supplier_invoice";
  paidAmount?: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const expenseRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  label: z.string(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expense_date: z.iso.date(),
  due_date: z.iso.date().nullable().optional(),
  subtotal_ht: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable().optional(),
  vat_rate: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable().optional(),
  vat_amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable().optional(),
  category: z.string().nullable(),
  supplier_id: z.uuid().nullable(),
  document_id: z.uuid().nullable().optional(),
  invoice_id: z.uuid().nullable().optional(),
  recurrence_id: z.uuid().nullable().optional(),
  recurrence_date: z.iso.date().nullable().optional(),
  status: expenseStatusSchema,
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const expensePaymentRowSchema = z.object({
  id: z.uuid(),
  expense_id: z.uuid(),
  payment_date: z.iso.date(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]),
  created_at: z.string(),
});
export type ExpensePaymentRecord = {
  id: string;
  expenseId: string;
  paymentDate: string;
  amount: number;
  createdAt: string;
};

export const recurringExpenseRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  label: z.string(),
  amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal_ht: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable(),
  vat_rate: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable(),
  vat_amount: z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullable(),
  supplier_id: z.uuid().nullable(),
  document_id: z.uuid().nullable(),
  category: z.string().nullable(),
  frequency: recurringExpenseFrequencySchema,
  start_date: z.iso.date(),
  next_due_date: z.iso.date(),
  end_date: z.iso.date().nullable(),
  status: recurringExpenseStatusSchema,
  paused_on: z.iso.date().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RecurringExpenseRecord = {
  id: string;
  userId: string | null;
  companyId: string | null;
  label: string;
  amount: number;
  currency: string;
  subtotalHt: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  supplierId: string | null;
  supplierName: string | null;
  documentId: string | null;
  documentName: string | null;
  category: string | null;
  frequency: RecurringExpenseFrequency;
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  status: RecurringExpenseStatus;
  pausedOn: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export function mapRecurringExpense(
  row: z.infer<typeof recurringExpenseRowSchema>,
  suppliers: readonly z.infer<typeof expenseSupplierRowSchema>[],
  documents: readonly { id: string; file_name: string }[],
): RecurringExpenseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    label: row.label,
    amount: row.amount,
    currency: row.currency,
    subtotalHt: row.subtotal_ht,
    vatRate: row.vat_rate,
    vatAmount: row.vat_amount,
    supplierId: row.supplier_id,
    supplierName: suppliers.find(({ id }) => id === row.supplier_id)?.name ?? null,
    documentId: row.document_id,
    documentName: documents.find(({ id }) => id === row.document_id)?.file_name ?? null,
    category: row.category,
    frequency: row.frequency,
    startDate: row.start_date,
    nextDueDate: row.next_due_date,
    endDate: row.end_date,
    status: row.status,
    pausedOn: row.paused_on,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expenseSupplierRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  company_id: z.uuid().nullable(),
  name: z.string(),
});
export type ExpenseSupplierRow = z.infer<typeof expenseSupplierRowSchema>;

export function mapExpense(
  row: z.infer<typeof expenseRowSchema>,
  suppliers: readonly z.infer<typeof expenseSupplierRowSchema>[],
): ExpenseRecord {
  const supplier = suppliers.find(({ id }) => id === row.supplier_id);
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    label: row.label,
    amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
    currency: row.currency,
    expenseDate: row.expense_date,
    dueDate: row.due_date ?? null,
    subtotalHt: row.subtotal_ht ?? null,
    vatRate: row.vat_rate ?? null,
    vatAmount: row.vat_amount ?? null,
    category: row.category,
    supplierId: row.supplier_id,
    supplierName: supplier?.name ?? null,
    status: row.status,
    documentId: row.document_id ?? null,
    invoiceId: row.invoice_id ?? null,
    recurrenceId: row.recurrence_id ?? null,
    recurrenceDate: row.recurrence_date ?? null,
    sourceType: "expense",
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ExpenseFilters = {
  query: string;
  category: string;
  status: "all" | ExpenseStatus;
  period: "all" | "month" | "year";
  selectedYear?: number;
  selectedMonth?: number;
  ownerId: string;
  sort: "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
  today: string;
};

export function filterExpenses(expenses: readonly ExpenseRecord[], filters: ExpenseFilters): ExpenseRecord[] {
  const query = filters.query.trim().toLocaleLowerCase("fr");
  const year = filters.selectedYear ?? Number(filters.today.slice(0, 4));
  const month = filters.selectedMonth ?? Number(filters.today.slice(5, 7));
  const start = filters.period === "month"
    ? `${year}-${String(month).padStart(2, "0")}-01`
    : filters.period === "year" ? `${year}-01-01` : null;
  const end = filters.period === "month"
    ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    : filters.period === "year" ? `${year}-12-31` : null;

  return expenses.filter((expense) => {
    const matchesQuery = !query || [expense.label, expense.supplierName]
      .some((value) => value?.toLocaleLowerCase("fr").includes(query));
    const matchesPeriod = !start || (expense.expenseDate >= start && expense.expenseDate <= (end ?? filters.today));
    return matchesQuery
      && (filters.category === "all" || expense.category === filters.category)
      && (filters.status === "all" || expense.status === filters.status)
      && (filters.ownerId === "all"
        || (filters.ownerId === "personal" ? expense.companyId === null : expense.companyId === filters.ownerId))
      && matchesPeriod;
  }).sort((left, right) => {
    if (filters.sort === "date-asc") return left.expenseDate.localeCompare(right.expenseDate);
    if (filters.sort === "amount-desc") return right.amount - left.amount;
    if (filters.sort === "amount-asc") return left.amount - right.amount;
    return right.expenseDate.localeCompare(left.expenseDate);
  });
}

export function getEffectiveExpenseStatus(
  expense: Pick<ExpenseRecord, "amount" | "status" | "dueDate">,
  paidAmount: number,
  asOfDate: string,
): ExpenseStatus {
  if (expense.status === "cancelled") return "cancelled";
  if (expense.status === "paid" || paidAmount >= expense.amount) return "paid";
  if (expense.status === "overdue" || Boolean(expense.dueDate && expense.dueDate < asOfDate)) return "overdue";
  return "pending";
}

export function normalizeRecurringMonthlyCost(amount: number, frequency: RecurringExpenseFrequency): number {
  const monthly = frequency === "weekly" ? amount * 52 / 12
    : frequency === "quarterly" ? amount / 3
      : frequency === "yearly" ? amount / 12
        : amount;
  return Math.round((monthly + Number.EPSILON) * 100) / 100;
}

export interface ExpenseChartBucket {
  period: string;
  label: string;
  amount: number | null;
}

export function buildMonthlyExpenseSeries(
  expenses: readonly ExpenseRecord[],
  year: number,
  today: string,
): ExpenseChartBucket[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const future = period > today.slice(0, 7);
    const total = expenses.reduce((sum, expense) => (
      expense.status !== "cancelled"
        && expense.expenseDate.startsWith(period)
        && expense.expenseDate <= today
        ? sum + Math.round(expense.amount * 100)
        : sum
    ), 0);
    return {
      period,
      label: new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" })
        .format(new Date(`${period}-01T00:00:00Z`)),
      amount: future ? null : total / 100,
    };
  });
}

export function buildAnnualExpenseSeries(
  expenses: readonly ExpenseRecord[],
  currentYear: number,
  today = `${currentYear}-12-31`,
): ExpenseChartBucket[] {
  const years = new Set(expenses
    .filter((expense) => expense.status !== "cancelled")
    .map((expense) => Number(expense.expenseDate.slice(0, 4)))
    .filter((year) => Number.isInteger(year) && year <= currentYear));
  years.add(currentYear);
  return [...years].sort((left, right) => left - right).map((year) => ({
    period: String(year),
    label: String(year),
    amount: expenses.reduce((sum, expense) => (
      expense.status !== "cancelled"
        && expense.expenseDate.startsWith(`${year}-`)
        && (year < currentYear || expense.expenseDate <= today)
        ? sum + Math.round(expense.amount * 100)
        : sum
    ), 0) / 100,
  }));
}

export interface ExpenseFinancialSummary {
  monthSpend: Map<string, number>;
  payable: Map<string, number>;
  paidThisMonth: Map<string, number>;
  overdue: Map<string, number>;
}

export function buildExpenseFinancialSummary(
  expenses: readonly ExpenseRecord[],
  payments: readonly ExpensePaymentRecord[],
  selectedYear: number,
  selectedMonth: number,
  today: string,
): ExpenseFinancialSummary {
  const month = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const monthEnd = new Date(Date.UTC(selectedYear, selectedMonth, 0)).toISOString().slice(0, 10);
  const add = (totals: Map<string, number>, currency: string, amount: number) => {
    totals.set(currency, (totals.get(currency) ?? 0) + Math.round(amount * 100));
  };
  const summary: ExpenseFinancialSummary = {
    monthSpend: new Map(),
    payable: new Map(),
    paidThisMonth: new Map(),
    overdue: new Map(),
  };
  for (const expense of expenses) {
    if (expense.status === "cancelled") continue;
    if (expense.expenseDate.startsWith(month) && expense.expenseDate <= today) {
      add(summary.monthSpend, expense.currency, expense.amount);
    }
    const paidAmount = expense.paidAmount ?? (expense.status === "paid" ? expense.amount : 0);
    const balance = Math.max(0, Math.round((expense.amount - paidAmount) * 100) / 100);
    const status = getEffectiveExpenseStatus(expense, paidAmount, today);
    if (balance > 0 && status === "overdue") add(summary.overdue, expense.currency, balance);
    else if (balance > 0 && (status === "pending" || !expense.dueDate || expense.dueDate >= today)) {
      add(summary.payable, expense.currency, balance);
    }
  }
  for (const payment of payments) {
    const expense = expenses.find(({ id }) => id === payment.expenseId);
    if (expense && expense.status !== "cancelled" && payment.paymentDate.startsWith(month)
      && payment.paymentDate <= today && payment.paymentDate <= monthEnd) {
      add(summary.paidThisMonth, expense.currency, payment.amount);
    }
  }
  for (const totals of Object.values(summary)) {
    for (const [currency, cents] of totals) totals.set(currency, cents / 100);
  }
  return summary;
}

export function sumCurrencyAmounts(
  entries: readonly { currency: string; amount: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + Math.round(entry.amount * 100));
  }
  for (const [currency, cents] of totals) totals.set(currency, cents / 100);
  return totals;
}

export function sumExpensesByCurrency(expenses: readonly ExpenseRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.status === "cancelled") continue;
    const nextTotal = (totals.get(expense.currency) ?? 0) + expense.amount;
    totals.set(expense.currency, Math.round((nextTotal + Number.EPSILON) * 100) / 100);
  }
  return totals;
}
