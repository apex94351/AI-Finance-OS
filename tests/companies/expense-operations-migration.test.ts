import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/015_expense_operations.sql", import.meta.url),
  "utf8",
);
const correction = readFileSync(
  new URL("../../database/migrations/016_supabase_managed_schedulers.sql", import.meta.url),
  "utf8",
);

describe("expense operations migration", () => {
  it("installs scheduled, idempotent recurring generation and overdue status updates", () => {
    expect(migration).toContain("generate_due_recurring_expense_occurrences");
    expect(migration).toContain("on conflict (recurrence_id, recurrence_date)");
    expect(migration).toContain("update_overdue_expense_statuses");
    expect(migration).toContain("ai-finance-os-expenses-overdue-daily");
    expect(migration).toContain("ai-finance-os-recurring-expenses-daily");
    expect(migration).toContain("cron.schedule");
  });

  it("preserves manually overdue unpaid expenses and never permits overpayment", () => {
    expect(migration).toContain("when expense_row.status = 'overdue' then 'overdue'");
    expect(migration).toContain("already_paid + target_amount > expense_row.amount");
    expect(migration).toContain("when already_paid + target_amount >= expense_row.amount then 'paid'");
  });

  it("restricts payment writes to the validated RPC and validates linked records", () => {
    expect(migration).toContain("grant select on table public.expense_payments to authenticated");
    expect(migration).not.toContain("grant select, insert on table public.expense_payments");
    expect(migration).toContain("security definer\nset search_path = ''\nset row_security = off");
    expect(migration).toContain("validate_expense_links");
    expect(migration).toContain("expenses_invoice_unique_idx");
    expect(migration).toContain("expenses_recurrence_occurrence_unique_idx");
  });

  it("fails closed when required schema or pg_cron is unavailable", () => {
    expect(migration).toContain("raise exception 'Migrations 008, 009, 011, 012, and 013 must be applied before 015.'");
    expect(migration).toContain("pg_cron with cron.schedule(text,text,text) is required");
    expect(migration).toContain("Apply migration 015 manually as a database superuser");
  });

  it("repairs missing recurring/payment tables and schedules without superuser-only checks", () => {
    expect(correction).toMatch(/create table if not exists public\.recurring_expenses/i);
    expect(correction).toMatch(/create table if not exists public\.expense_payments/i);
    expect(correction).toContain("ai-finance-os-recurring-expenses-daily");
    expect(correction).toContain("'select public.generate_due_recurring_expense_occurrences();'");
    expect(correction).toContain("expenses_recurrence_occurrence_unique_idx");
    expect(correction).toMatch(/on conflict \(recurrence_id, recurrence_date\).*do nothing/i);
    expect(correction).not.toMatch(/rolsuper\s*=\s*true/i);
  });

  it("does not overwrite manual overdue statuses and excludes paid/cancelled expenses", () => {
    expect(correction).toContain("when expense_row.status = 'overdue' then 'overdue'");
    expect(correction).toMatch(/where expense\.status = 'pending'\s+and expense\.due_date < today_utc/i);
    expect(correction).toContain("ai-finance-os-expenses-overdue-daily");
    expect(correction).toContain("'select public.update_overdue_expense_statuses();'");
  });

  it("checks function ownership and the effective cron permissions instead of disabling RLS", () => {
    expect(correction).toContain("has_function_privilege(current_user, 'cron.schedule(text,text,text)', 'EXECUTE')");
    expect(correction).toContain("routine.proowner <> migration_role");
    expect(correction).toContain("function_row.prosecdef");
    expect(correction).toContain("function_row.proconfig @> array['search_path=\"\"', 'row_security=off']");
    expect(correction).toContain("alter table public.expense_payments enable row level security");
    expect(correction).not.toMatch(/disable row level security/i);
  });
});
