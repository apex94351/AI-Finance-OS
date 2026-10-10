import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../database/migrations/008_contacts_and_invoice_parties.sql", import.meta.url),
  "utf8",
);

describe("contacts migration", () => {
  it("creates isolated personal/company contact tables with role-aware policies", () => {
    for (const table of ["customers", "suppliers"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`constraint ${table}_single_owner`);
      expect(migration).toContain(`${table}_personal_select`);
      expect(migration).toContain(`${table}_company_select`);
      expect(migration).toContain(`${table}_personal_insert`);
      expect(migration).toContain(`${table}_company_insert`);
      expect(migration).toContain(`${table}_personal_update`);
      expect(migration).toContain(`${table}_company_update`);
      expect(migration).toContain(`${table}_personal_delete`);
      expect(migration).toContain(`${table}_company_delete`);
    }
    expect(migration).toContain("'owner'::public.company_role");
    expect(migration).toContain("'admin'::public.company_role");
    expect(migration).toContain("'accountant'::public.company_role");
    expect(migration).not.toMatch(/'member'::public\.company_role[\s\S]{0,100}can_write_company_contact/);
    expect(migration).not.toMatch(/'viewer'::public\.company_role[\s\S]{0,100}can_write_company_contact/);
    const deleteRoleFunction = migration.match(/create function public\.can_delete_company_contact[\s\S]*?as \$function\$([\s\S]*?)\$function\$/)?.[1] ?? "";
    expect(deleteRoleFunction).toContain("'owner'::public.company_role");
    expect(deleteRoleFunction).toContain("'admin'::public.company_role");
    expect(deleteRoleFunction).not.toContain("'accountant'::public.company_role");
    expect(deleteRoleFunction).not.toContain("'member'::public.company_role");
    expect(deleteRoleFunction).not.toContain("'viewer'::public.company_role");
    expect(migration).toContain("public.is_company_member(company_id)");
  });

  it("adds nullable explicit invoice links without backfilling old names and preserves invoices on contact deletion", () => {
    expect(migration).toMatch(/add column customer_id uuid references public\.customers\(id\) on delete set null/i);
    expect(migration).toMatch(/add column supplier_id uuid references public\.suppliers\(id\) on delete set null/i);
    expect(migration).toContain("customer_id is null or supplier_id is null");
    expect(migration).not.toMatch(/update public\.invoices/i);
    expect(migration).toContain("Invoice customer must have the same owner as the invoice.");
    expect(migration).toContain("Invoice supplier must have the same owner as the invoice.");
    expect(migration).toContain("set row_security = off");
  });
});
