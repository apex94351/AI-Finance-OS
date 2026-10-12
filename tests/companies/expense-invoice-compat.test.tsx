// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/database/components/expenses/expense-manager", () => ({
  ExpenseManager: ({ expenses, payments, recurringExpenses, loadError, supplierWarning }: { expenses: unknown[]; payments: unknown[]; recurringExpenses: unknown[]; loadError: string | null; supplierWarning: string | null }) => (
    <section data-testid="expense-manager">
      <p>{loadError ?? `${expenses.length} ligne(s) chargée(s)`}</p>
      <p>{supplierWarning}</p>
      <pre>{JSON.stringify(expenses)}</pre>
      <pre>{JSON.stringify(payments)}</pre>
      <pre>{JSON.stringify(recurringExpenses)}</pre>
    </section>
  ),
}));

import ExpensesPage from "@/app/expenses/page";

const userId = "123e4567-e89b-42d3-a456-426614174099";
const supplierId = "123e4567-e89b-42d3-a456-426614174001";
const invoiceId = "123e4567-e89b-42d3-a456-426614174002";

function query(result: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "or"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  );
  return builder;
}

describe("expense page invoice compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps legacy supplier invoices and loads an existing recurring subscription from the schema 016 shape", async () => {
    const oldInvoice = {
      id: invoiceId,
      user_id: userId,
      company_id: null,
      supplier_id: supplierId,
      document_id: null,
      invoice_number: "FOU-EXISTANTE",
      client_name: "Fournisseur existant",
      description: "Achat",
      issue_date: "2026-10-01",
      due_date: "2026-10-20",
      subtotal_ht: 100,
      vat_rate: 20,
      vat_amount: 20,
      total_ttc: 120,
      currency: "EUR",
      status: "pending",
      category: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };
    const missingType = { code: "42703" };
    const recurringSubscription = {
      id: "123e4567-e89b-42d3-a456-426614174003",
      user_id: userId,
      company_id: null,
      label: "Abonnement existant",
      amount: "48.00",
      currency: "EUR",
      subtotal_ht: null,
      vat_rate: null,
      vat_amount: null,
      supplier_id: null,
      document_id: null,
      category: "Logiciel",
      frequency: "monthly",
      start_date: "2026-01-01",
      next_due_date: "2026-11-01",
      end_date: null,
      status: "active",
      paused_on: null,
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      expenses: [query({ data: [], error: null })],
      suppliers: [
        query({ data: [], error: null }),
        query({ data: [{ id: supplierId, user_id: userId, company_id: null, name: "Fournisseur existant" }], error: null }),
      ],
      invoices: [
        query({ data: null, error: missingType }),
        query({ data: [oldInvoice], error: null }),
      ],
      recurring_expenses: [query({ data: [recurringSubscription], error: null })],
      documents: [query({ data: [], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const page = await ExpensesPage() as ReactElement<{ children: ReactElement }>;
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("1 ligne(s) chargée(s)");
    expect(markup).toContain("FOU-EXISTANTE");
    expect(markup).toContain("supplier_invoice");
    expect(markup).toContain("Abonnement existant");
    expect(markup).toContain("&quot;amount&quot;:48");
    expect(markup).toContain("&quot;frequency&quot;:&quot;monthly&quot;");
    expect(markup).toContain("&quot;nextDueDate&quot;:&quot;2026-11-01&quot;");
    expect(markup).not.toContain("Le modèle Dépenses étendu n’est pas disponible");
  });

  it("keeps expenses visible and marks balances unknown when optional recurrence or payment tables are unavailable", async () => {
    const expenseId = "123e4567-e89b-42d3-a456-426614174004";
    const storedExpense = {
      id: expenseId,
      user_id: userId,
      company_id: null,
      label: "Dépense existante",
      amount: 70,
      currency: "EUR",
      expense_date: "2026-10-10",
      due_date: "2026-10-20",
      subtotal_ht: null,
      vat_rate: null,
      vat_amount: null,
      category: null,
      supplier_id: null,
      document_id: null,
      invoice_id: null,
      recurrence_id: null,
      recurrence_date: null,
      status: "pending",
      notes: null,
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      expenses: [query({ data: [storedExpense], error: null })],
      suppliers: [query({ data: [], error: null })],
      invoices: [query({ data: [], error: null })],
      recurring_expenses: [query({ data: null, error: { code: "PGRST205" } })],
      documents: [query({ data: [], error: null })],
      expense_payments: [query({ data: null, error: { code: "42501" } })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const page = await ExpensesPage() as ReactElement<{ children: ReactElement }>;
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("1 ligne(s) chargée(s)");
    expect(markup).toContain("Dépense existante");
    expect(markup).toContain("&quot;paidAmount&quot;:null");
    expect(markup).toContain("abonnements récurrents ne sont pas tous disponibles");
    expect(markup).toContain("historique des paiements de dépenses est inaccessible");
    expect(markup).not.toContain("Le modèle Dépenses étendu n’est pas disponible");
  });

  it("renders one linked supplier invoice expense and its dated payment exactly once", async () => {
    const expenseId = "123e4567-e89b-42d3-a456-426614174006";
    const supplierInvoice = {
      id: invoiceId,
      user_id: userId,
      company_id: null,
      invoice_type: "supplier",
      supplier_id: supplierId,
      document_id: null,
      invoice_number: "FOU-LIEE-7",
      client_name: "Fournisseur exemple",
      description: "Matériel",
      issue_date: "2026-09-28",
      due_date: "2026-10-05",
      subtotal_ht: 100,
      vat_rate: 20,
      vat_amount: 20,
      total_ttc: 120,
      currency: "EUR",
      status: "paid",
      category: null,
      created_at: "2026-09-28T00:00:00Z",
      updated_at: "2026-10-08T10:00:00Z",
    };
    const linkedExpense = {
      id: expenseId,
      user_id: userId,
      company_id: null,
      label: "Facture fournisseur FOU-LIEE-7",
      amount: 120,
      currency: "EUR",
      expense_date: "2026-09-28",
      due_date: "2026-10-05",
      subtotal_ht: 100,
      vat_rate: 20,
      vat_amount: 20,
      category: null,
      supplier_id: supplierId,
      document_id: null,
      invoice_id: invoiceId,
      recurrence_id: null,
      recurrence_date: null,
      status: "paid",
      notes: null,
      created_at: "2026-09-28T00:00:00Z",
      updated_at: "2026-10-08T10:00:00Z",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      expenses: [query({ data: [linkedExpense], error: null })],
      suppliers: [query({ data: [{ id: supplierId, user_id: userId, company_id: null, name: "Fournisseur" }], error: null })],
      invoices: [query({ data: [supplierInvoice], error: null })],
      recurring_expenses: [query({ data: [], error: null })],
      documents: [query({ data: [], error: null })],
      expense_payments: [query({ data: [{
        id: "123e4567-e89b-42d3-a456-426614174007",
        expense_id: expenseId,
        payment_date: "2026-10-08",
        amount: 120,
        created_at: "2026-10-08T10:00:00Z",
      }], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const markup = renderToStaticMarkup(await ExpensesPage() as ReactElement<{ children: ReactElement }>);

    expect(markup).toContain("1 ligne(s) chargée(s)");
    expect(markup.match(/&quot;id&quot;:&quot;123e4567-e89b-42d3-a456-426614174006&quot;/g)).toHaveLength(1);
    expect(markup).toContain("&quot;paymentDate&quot;:&quot;2026-10-08&quot;,&quot;amount&quot;:120");
    expect(markup).not.toContain('"sourceType":"supplier_invoice"');
  });
});
