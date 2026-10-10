import { z } from "zod";

export const expenseStatusSchema = z.enum(["pending", "paid", "cancelled"]);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const expenseInputSchema = z.object({
  label: z.string().trim().min(1, "Saisissez un libellé.").max(200),
  amount: z.string().trim().min(1, "Saisissez un montant.")
    .transform((value) => Number(value.replace(",", ".")))
    .pipe(z.number().finite().positive("Le montant doit être supérieur à zéro.").max(999999999999.99)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Sélectionnez une devise valide."),
  expenseDate: z.iso.date("Saisissez une date de dépense valide."),
  category: z.string().trim().max(100).transform((value) => value || null),
  supplierId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
  status: expenseStatusSchema,
  notes: z.string().trim().max(2000).transform((value) => value || null),
});

export type ExpenseInput = z.input<typeof expenseInputSchema>;

export interface ExpenseRecord {
  id: string;
  userId: string | null;
  companyId: string | null;
  label: string;
  amount: number;
  currency: string;
  expenseDate: string;
  category: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: ExpenseStatus;
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
  category: z.string().nullable(),
  supplier_id: z.uuid().nullable(),
  status: expenseStatusSchema,
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

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
    category: row.category,
    supplierId: row.supplier_id,
    supplierName: supplier?.name ?? null,
    status: row.status,
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
  ownerId: string;
  sort: "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
  today: string;
};

export function filterExpenses(expenses: readonly ExpenseRecord[], filters: ExpenseFilters): ExpenseRecord[] {
  const query = filters.query.trim().toLocaleLowerCase("fr");
  const start = filters.period === "month"
    ? `${filters.today.slice(0, 7)}-01`
    : filters.period === "year" ? `${filters.today.slice(0, 4)}-01-01` : null;

  return expenses.filter((expense) => {
    const matchesQuery = !query || [expense.label, expense.supplierName]
      .some((value) => value?.toLocaleLowerCase("fr").includes(query));
    const matchesPeriod = !start || (expense.expenseDate >= start && expense.expenseDate <= filters.today);
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

export function sumExpensesByCurrency(expenses: readonly ExpenseRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.status === "cancelled") continue;
    const nextTotal = (totals.get(expense.currency) ?? 0) + expense.amount;
    totals.set(expense.currency, Math.round((nextTotal + Number.EPSILON) * 100) / 100);
  }
  return totals;
}
