import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));

import { loadContactWorkspace } from "@/app/contacts/data";

const userId = "123e4567-e89b-42d3-a456-426614174099";
const contactId = "123e4567-e89b-42d3-a456-426614174001";
const invoiceId = "123e4567-e89b-42d3-a456-426614174002";

function query(result: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "not", "in"]) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  );
  return builder;
}

describe("contact workspace schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps contacts and linked invoices visible when invoice_payments is absent before migration 017", async () => {
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      customers: [query({ data: [{
        id: contactId,
        user_id: userId,
        company_id: null,
        name: "Client existant",
        email: null,
        phone: null,
        address: null,
        notes: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      }], error: null })],
      suppliers: [query({ data: [], error: null })],
      invoices: [query({ data: [{
        id: invoiceId,
        customer_id: contactId,
        supplier_id: null,
        invoice_number: "CLI-EXISTANTE",
        client_name: "Client existant",
        issue_date: "2026-10-01",
        due_date: "2026-10-30",
        total_ttc: 120,
        currency: "EUR",
        status: "pending",
      }], error: null })],
      invoice_payments: [query({ data: null, error: { code: "PGRST205" } })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { from }, user: { id: userId } });

    const result = await loadContactWorkspace("customers", contactId);

    expect(result.loadError).toBeNull();
    expect(result.contacts).toHaveLength(1);
    expect(result.invoicesByContact[contactId]).toHaveLength(1);
    expect(result.invoicesByContact[contactId]?.[0]).toMatchObject({
      id: invoiceId,
      invoiceNumber: "CLI-EXISTANTE",
      paidAmount: 0,
    });
    expect(result.paymentWarning).toContain("migration 017");
  });
});
