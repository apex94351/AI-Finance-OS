import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/017_invoice_directions_and_customer_payments.sql", import.meta.url),
  "utf8",
);
const expenseOperations = readFileSync(
  new URL("../../database/migrations/015_expense_operations.sql", import.meta.url),
  "utf8",
);
const dueDatesPage = readFileSync(
  new URL("../../app/due-dates/page.tsx", import.meta.url),
  "utf8",
);

function functionBody(name: string) {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    "i",
  ));
  expect(match, `expected function ${name} in migration`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("customer invoice direction and payment migration", () => {
  it("backfills direction only from explicit party IDs and leaves ambiguous rows nullable", () => {
    expect(migration).toContain("add column if not exists invoice_type text;");
    expect(migration).toMatch(/when customer_id is not null then 'customer'[\s\S]*when supplier_id is not null then 'supplier'/);
    expect(migration).toMatch(/where invoice_type is null[\s\S]*\(customer_id is not null or supplier_id is not null\)/);
    expect(migration).toContain("document.category in ('customer_invoice', 'supplier_invoice')");
    expect(migration).toContain("document.company_id is not distinct from invoice.company_id");
    expect(migration).toContain("document.user_id is not distinct from invoice.user_id");
    expect(migration).not.toMatch(/when status[^\n]*receivable/i);
    expect(migration).not.toMatch(/when client_name/i);
  });

  it("stores owner scope on payments and exposes reads, not direct writes, through RLS", () => {
    expect(migration).toContain("create table if not exists public.invoice_payments");
    expect(migration).toContain("user_id uuid references auth.users(id)");
    expect(migration).toContain("company_id uuid references public.companies(id)");
    expect(migration).toContain("amount numeric(14, 2) not null check (amount > 0)");
    expect(migration).toContain("alter table public.invoice_payments enable row level security");
    expect(migration).toContain("grant select on table public.invoice_payments to authenticated");
    expect(migration).not.toMatch(/grant\s+(?:select,\s*)?insert[^;]*invoice_payments/i);
    expect(migration).toContain("public.is_company_member(company_id)");
  });

  it("records payments under a row lock and enforces scope, date, precision, and remaining balance", () => {
    const body = functionBody("record_invoice_payment");
    expect(body).toContain("for update");
    expect(body).toContain("public.can_write_company_invoice(invoice_row.company_id)");
    expect(body).toContain("target_payment_date > today_utc");
    expect(body).toContain("pg_catalog.round(target_amount, 2)");
    expect(body).toContain("already_paid + target_amount > invoice_row.total_ttc");
    expect(body).toContain("when already_paid + target_amount >= invoice_row.total_ttc then 'paid'");
  });

  it("prevents reductions below recorded payments and premature customer settlement", () => {
    const body = functionBody("validate_invoice_payments_against_amount");
    expect(body).toContain("paid_total > new.total_ttc");
    expect(body).toContain("new.status = 'paid'");
    expect(body).toContain("paid_total < new.total_ttc");
    expect(body).toContain("invoice_type is distinct from old.invoice_type");
    expect(body).toContain("public.expense_payments");
    expect(migration).toContain("create or replace function public.validate_supplier_invoice_payment()");
    expect(migration).toContain("Payment exceeds the outstanding supplier invoice balance.");
  });

  it("keeps one supplier obligation when an invoice is also linked to an expense", () => {
    expect(expenseOperations).toContain("create unique index if not exists expenses_invoice_unique_idx");
    expect(dueDatesPage).toContain("expense.invoice_id === null && expense.due_date !== null");
    expect(dueDatesPage).toContain("linkedExpensePayments.set(");
  });
});
