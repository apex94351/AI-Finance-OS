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
  InvoiceManager: ({ loadError }: { loadError: string | null }) => <p>{loadError}</p>,
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
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
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
  const invoiceQueries = [query(personalResult), query(companyResult)];

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
});
