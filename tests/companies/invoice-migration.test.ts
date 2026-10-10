import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/007_invoice_table.sql", import.meta.url),
  "utf8",
);

function functionBody(name: string) {
  const match = migration.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`));
  expect(match, `expected function ${name} in migration`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("invoice migration role permissions", () => {
  it("allows only owner, admin, and accountant to write company invoices", () => {
    const body = functionBody("can_write_company_invoice");
    expect(body).toContain("'owner'::public.company_role");
    expect(body).toContain("'admin'::public.company_role");
    expect(body).toContain("'accountant'::public.company_role");
    expect(body).not.toContain("'member'::public.company_role");
    expect(body).not.toContain("'viewer'::public.company_role");
    expect(migration).toMatch(/invoices_company_insert[\s\S]*?can_write_company_invoice\(company_id\)/);
    expect(migration).toMatch(/invoices_company_update[\s\S]*?using \([\s\S]*?can_write_company_invoice\(company_id\)[\s\S]*?with check \([\s\S]*?can_write_company_invoice\(company_id\)/);
  });

  it("allows only owner and admin to delete company invoices", () => {
    const body = functionBody("can_delete_company_invoice");
    expect(body).toContain("'owner'::public.company_role");
    expect(body).toContain("'admin'::public.company_role");
    expect(body).not.toContain("'accountant'::public.company_role");
    expect(body).not.toContain("'member'::public.company_role");
    expect(body).not.toContain("'viewer'::public.company_role");
    expect(migration).toMatch(/invoices_company_delete[\s\S]*?can_delete_company_invoice\(company_id\)/);
    expect(migration).toMatch(
      /revoke all on function public\.can_delete_company_invoice\(uuid\) from public, anon, authenticated;[\s\S]*?grant execute on function public\.can_delete_company_invoice\(uuid\) to authenticated;/i,
    );
  });

  it("keeps company reads membership-scoped and personal policies independent of company roles", () => {
    expect(migration).toMatch(/invoices_company_select[\s\S]*?public\.is_company_member\(company_id\)/);
    for (const operation of ["select", "insert", "update", "delete"]) {
      const policy = migration.match(new RegExp(`create policy invoices_personal_${operation}[\\s\\S]*?;`))?.[0] ?? "";
      expect(policy).toContain("auth.uid()");
      expect(policy).not.toContain("company_role");
      expect(policy).not.toContain("company_members");
    }
    expect(migration).toContain("set row_security = off");
    expect(functionBody("can_write_company_invoice")).toContain("public.company_members");
    expect(functionBody("can_delete_company_invoice")).toContain("public.company_members");
  });

  it("runs owner immutability before the updated_at trigger", () => {
    const immutableTrigger = migration.indexOf("create trigger invoices_owner_immutable");
    const updatedAtTrigger = migration.indexOf("create trigger invoices_set_updated_at");
    expect(immutableTrigger).toBeGreaterThan(-1);
    expect(updatedAtTrigger).toBeGreaterThan(immutableTrigger);
    expect(migration).toContain("new.user_id is distinct from old.user_id");
    expect(migration).toContain("new.company_id is distinct from old.company_id");
    expect(functionBody("set_invoice_updated_at")).toContain("new.updated_at := pg_catalog.now()");
  });
});
