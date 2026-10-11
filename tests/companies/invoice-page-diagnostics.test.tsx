// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/database/components/invoices/invoice-manager", () => ({
  InvoiceManager: ({ loadError, invoices, contactWarning }: { loadError: string | null; invoices: unknown[]; contactWarning?: string | null }) => (
    <section data-testid="invoice-manager" data-invoice-type={(invoices[0] as { invoiceType?: string } | undefined)?.invoiceType}>
      <p>{loadError ?? `${invoices.length} facture(s) chargée(s)`}</p>
      {contactWarning ? <p data-testid="invoice-warning">{contactWarning}</p> : null}
      <pre>{JSON.stringify(invoices)}</pre>
    </section>
  ),
}));

import InvoicesPage from "@/app/invoices/page";

const privateDiagnostic = new Error("permission denied for table invoices") as Error & {
  code: string;
  details: string;
  hint: string;
  cause: Error;
};
Object.defineProperties(privateDiagnostic, {
  name: { value: "PostgrestError", enumerable: false },
  code: { value: "42501", enumerable: false },
  details: { value: "SUPABASE_INTERNAL_DETAIL", enumerable: false },
  hint: { value: "SUPABASE_INTERNAL_HINT", enumerable: false },
  cause: { value: new Error("SUPABASE_INTERNAL_CAUSE"), enumerable: false },
});
const companyId = "123e4567-e89b-42d3-a456-426614174000";

function query(result: { data: unknown; error: Error | null }) {
  const builder = {
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function setup({ failCompanyInvoices = false }: { failCompanyInvoices?: boolean } = {}) {
  const personalResult = failCompanyInvoices
    ? { data: [], error: null }
    : { data: null, error: privateDiagnostic };
  const companyResult = failCompanyInvoices
    ? { data: null, error: privateDiagnostic }
    : { data: [], error: null };
  const companyRows = [{ id: companyId, name: "Entreprise", currency: "EUR" }];
  const invoiceQueries = failCompanyInvoices
    ? [
      query({ data: null, error: null }),
      query({ data: null, error: null }),
      query(personalResult),
      query(companyResult),
    ]
    : [query({ data: null, error: null }), query(personalResult)];

  from.mockImplementation((table: string) => {
    if (table === "company_members") {
      return query({ data: failCompanyInvoices ? [{ company_id: companyId }] : [], error: null });
    }
    if (table === "companies") return query({ data: companyRows, error: null });
    if (table === "customers" || table === "suppliers") return query({ data: [], error: null });
    return invoiceQueries.shift();
  });
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from },
    user: { id: "authenticated-user" },
  });
};

describe("invoice page query diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });
  afterEach(cleanup);

  it.each([
    ["personal_invoices", false],
    ["company_invoices", true],
  ] as const)("logs private query diagnostics for %s without exposing them in the page", async (context, failCompanyInvoices) => {
    setup({ failCompanyInvoices });
    const serverError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const page = await InvoicesPage();
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Impossible de charger les factures pour le moment. Réessayez plus tard.");
    expect(markup).not.toContain(privateDiagnostic.message);
    expect(markup).not.toContain(privateDiagnostic.details);
    expect(markup).not.toContain(privateDiagnostic.hint);
    const loggedJson = serverError.mock.calls.find(([message]) => message === "Invoice query failed")?.[1];
    expect(typeof loggedJson).toBe("string");
    const logged = JSON.parse(loggedJson as string);
    expect(logged).toMatchObject({
      context,
      name: "PostgrestError",
      message: privateDiagnostic.message,
      code: "42501",
      details: "SUPABASE_INTERNAL_DETAIL",
      hint: "SUPABASE_INTERNAL_HINT",
      cause: {
        name: "Error",
        message: "SUPABASE_INTERNAL_CAUSE",
      },
    });
    serverError.mockRestore();
  });

  it("keeps existing invoices visible when invoice_type and invoice_payments are absent", async () => {
    const userId = "123e4567-e89b-42d3-a456-426614174099";
    const invoiceId = "123e4567-e89b-42d3-a456-426614174010";
    const sourceDocumentId = "123e4567-e89b-42d3-a456-426614174011";
    const legacyInvoice = {
      id: invoiceId,
      user_id: userId,
      company_id: null,
      customer_id: null,
      supplier_id: null,
      document_id: sourceDocumentId,
      invoice_number: "FAC-EXISTANTE",
      client_name: "Client libre",
      description: "Prestation",
      issue_date: "2026-10-01",
      due_date: "2026-10-30",
      subtotal_ht: 100,
      vat_rate: 20,
      vat_amount: 20,
      total_ttc: 120,
      currency: "EUR",
      status: "pending",
      category: null,
      ai_summary: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    };
    const missingType = Object.assign(new Error("column invoice_type does not exist"), { code: "42703" });
    const missingPayments = Object.assign(new Error("table invoice_payments does not exist"), { code: "PGRST205" });
    const queues: Record<string, ReturnType<typeof query>[]> = {
      company_members: [query({ data: [], error: null })],
      customers: [query({ data: [], error: null })],
      suppliers: [query({ data: [], error: null })],
      invoices: [
        query({ data: null, error: null }),
        query({ data: null, error: missingType }),
        query({ data: [legacyInvoice], error: null }),
      ],
      documents: [query({ data: [{
        id: sourceDocumentId,
        user_id: userId,
        company_id: null,
        category: "customer_invoice",
      }], error: null })],
      invoice_payments: [query({ data: null, error: missingPayments })],
      expenses: [query({ data: [], error: null })],
    };
    from.mockImplementation((table: string) => queues[table]?.shift() ?? query({ data: [], error: null }));

    const page = await InvoicesPage();
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("1 facture(s) chargée(s)");
    expect(markup).toContain('data-invoice-type="customer"');
    expect(markup).toContain("&quot;total&quot;:120");
    expect(markup).toContain("&quot;remainingAmount&quot;:120");
    expect(markup).toContain("La migration 017 n’est pas installée");
    expect(markup).not.toContain("Impossible de charger les factures");
  });
});
