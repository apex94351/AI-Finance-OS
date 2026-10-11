// @vitest-environment jsdom

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

import DueDatesPage from "@/app/due-dates/page";

const userId = "123e4567-e89b-42d3-a456-426614174099";
const invoiceId = "123e4567-e89b-42d3-a456-426614174010";
const documentId = "123e4567-e89b-42d3-a456-426614174011";

function query(result: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "update", "lt"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  );
  return builder;
}

describe("due date compatibility with schema 016", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps and totals an existing invoice from its same-owner source category without migration 017", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const legacyInvoice = {
      id: invoiceId,
      user_id: userId,
      company_id: null,
      customer_id: null,
      supplier_id: null,
      document_id: documentId,
      invoice_number: "CLI-DOC-42",
      client_name: "Nom libre",
      due_date: "2026-10-30",
      total_ttc: 120,
      currency: "EUR",
      status: "pending",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      invoices: [
        query({ data: null, error: { code: "42703" } }),
        query({ data: [legacyInvoice], error: null }),
      ],
      expenses: [query({ data: [], error: null }), query({ data: [], error: null })],
      documents: [query({ data: [{ id: documentId, user_id: userId, company_id: null, category: "customer_invoice" }], error: null })],
      invoice_payments: [query({ data: null, error: { code: "PGRST205" } })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const markup = renderToStaticMarkup(await DueDatesPage());

    expect(markup).toContain("120,00 €");
    expect(markup).toContain("CLI-DOC-42");
    expect(markup).toContain("Les paiements partiels clients nécessitent la migration 017");
    expect(markup).not.toContain("Impossible de charger les échéances");
    vi.useRealTimers();
  });
});
