import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/database/components/ai-cfo/ai-cfo-client", () => ({
  AiCfoClient: ({ invoices, invoiceError, invoiceWarning }: {
    invoices: unknown[];
    invoiceError: string | null;
    invoiceWarning: string | null;
  }) => <section>
    <p>{invoiceError ?? `${invoices.length} facture(s) CFO chargée(s)`}</p>
    {invoiceWarning ? <p>{invoiceWarning}</p> : null}
  </section>,
}));

import AiCfoPage from "@/app/ai-cfo/page";

const userId = "123e4567-e89b-42d3-a456-426614174099";
const invoiceId = "123e4567-e89b-42d3-a456-426614174010";
const documentId = "123e4567-e89b-42d3-a456-426614174011";

function query(result: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  );
  return builder;
}

describe("AI CFO schema compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retains legacy invoices when invoice_type and invoice_payments are not installed", async () => {
    const legacyInvoice = {
      id: invoiceId,
      user_id: userId,
      company_id: null,
      customer_id: null,
      supplier_id: null,
      document_id: documentId,
      invoice_number: "FAC-CFO-LEGACY",
      client_name: "Client saisi librement",
      description: "Prestation",
      issue_date: "2026-10-01",
      due_date: "2026-10-30",
      subtotal_ht: 100,
      vat_amount: 20,
      total_ttc: 120,
      currency: "EUR",
      status: "pending",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      invoices: [
        query({ data: null, error: { code: "42703" } }),
        query({ data: [legacyInvoice], error: null }),
      ],
      documents: [query({ data: [{
        id: documentId,
        user_id: userId,
        company_id: null,
        category: "customer_invoice",
      }], error: null })],
      invoice_payments: [query({ data: null, error: { code: "PGRST205" } })],
      expenses: [query({ data: [], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const markup = renderToStaticMarkup(await AiCfoPage() as ReactElement);

    expect(markup).toContain("1 facture(s) CFO chargée(s)");
    expect(markup).toContain("migration 017");
    expect(markup).not.toContain("Analyse des factures indisponible");
  });
});
