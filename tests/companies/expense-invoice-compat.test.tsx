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
  ExpenseManager: ({ expenses, loadError, supplierWarning }: { expenses: unknown[]; loadError: string | null; supplierWarning: string | null }) => (
    <section data-testid="expense-manager">
      <p>{loadError ?? `${expenses.length} ligne(s) chargée(s)`}</p>
      <p>{supplierWarning}</p>
      <pre>{JSON.stringify(expenses)}</pre>
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

  it("keeps supplier invoices visible when the remote invoices table has no invoice_type column", async () => {
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
      recurring_expenses: [query({ data: [], error: null })],
      documents: [query({ data: [], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const page = await ExpensesPage() as ReactElement<{ children: ReactElement }>;
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("1 ligne(s) chargée(s)");
    expect(markup).toContain("FOU-EXISTANTE");
    expect(markup).toContain("supplier_invoice");
    expect(markup).not.toContain("Le modèle Dépenses étendu n’est pas disponible");
  });
});
