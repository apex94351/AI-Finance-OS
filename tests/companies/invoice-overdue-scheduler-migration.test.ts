import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legacyMigration = readFileSync(
  new URL("../../database/migrations/014_invoice_overdue_scheduler.sql", import.meta.url),
  "utf8",
);
const correction = readFileSync(
  new URL("../../database/migrations/016_supabase_managed_schedulers.sql", import.meta.url),
  "utf8",
);

describe("invoice overdue scheduler migrations", () => {
  it("documents the legacy role-switch/superuser failure and replaces it in 016", () => {
    expect(legacyMigration).toContain("SET ROLE invoice_overdue_scheduler");
    expect(legacyMigration).toContain("rolsuper");
    expect(correction).not.toContain("SET ROLE invoice_overdue_scheduler");
    expect(correction).not.toMatch(/rolsuper\s*=\s*true/i);
    expect(correction).toContain("public.update_overdue_invoice_statuses()");
  });

  it("updates only eligible unpaid invoices and leaves paid/cancelled rows untouched", () => {
    expect(correction).toMatch(
      /where invoice\.status::text in \('pending', 'receivable'\)\s+and invoice\.due_date < today_utc/i,
    );
    expect(correction).toContain("set status = 'overdue'");
    expect(correction).toContain("set search_path = ''\nset row_security = off");
  });

  it("uses stable named cron jobs and permission-checked idempotent replacement", () => {
    expect(correction).toContain("cron.schedule(text,text,text)");
    expect(correction).toContain("cron.unschedule(bigint)");
    expect(correction).toContain("ai-finance-os-invoice-overdue-daily");
    expect(correction).toContain("'select public.update_overdue_invoice_statuses();'");
    expect(correction).toContain("perform cron.unschedule(scheduled_job.jobid)");
    expect(correction).toContain("scheduled_job.username <> current_user");
    expect(correction).not.toMatch(/grant\s+create\s+on\s+schema\s+cron/i);
  });
});
