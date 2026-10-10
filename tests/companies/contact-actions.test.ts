import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createContact, deleteContact, updateContact } from "@/app/contacts/actions";

const companyId = "123e4567-e89b-42d3-a456-426614174000";
const userId = "123e4567-e89b-42d3-a456-426614174001";
const contactId = "123e4567-e89b-42d3-a456-426614174002";

function contactForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    name: " Client Exemple ",
    email: "client@example.com",
    phone: "0102030405",
    address: "",
    notes: "",
    ...overrides,
  }).forEach(([key, value]) => form.set(key, value));
  return form;
}

function setup({
  companyMembership = { data: { company_id: companyId }, error: null },
  result = { data: { id: contactId, name: "Client Exemple", user_id: userId, company_id: null }, error: null },
}: {
  companyMembership?: { data: { company_id: string } | null; error: { code: string } | null };
  result?: { data: { id: string; name: string; user_id: string | null; company_id: string | null } | null; error: { code: string } | null };
} = {}) {
  const membershipQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  membershipQuery.maybeSingle.mockResolvedValue(companyMembership);

  const contactQuery = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const method of [contactQuery.insert, contactQuery.update, contactQuery.delete, contactQuery.select, contactQuery.eq, contactQuery.is]) {
    method.mockReturnValue(contactQuery);
  }
  contactQuery.maybeSingle.mockResolvedValue(result);
  from.mockImplementation((table: string) => table === "company_members" ? membershipQuery : contactQuery);
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from },
    user: { id: userId },
  });
  return { membershipQuery, contactQuery };
}

describe("contact server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a personal customer under the authenticated user", async () => {
    const { contactQuery, membershipQuery } = setup();

    const result = await createContact("customers", null, contactForm());

    expect(contactQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: userId,
      company_id: null,
      name: "Client Exemple",
      email: "client@example.com",
    }));
    expect(membershipQuery.maybeSingle).not.toHaveBeenCalled();
    expect(result.contact).toMatchObject({ id: contactId, kind: "customers", userId, companyId: null });
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith("/clients");
  });

  it("verifies company membership before attempting an authorized supplier insert", async () => {
    const { membershipQuery, contactQuery } = setup({
      result: { data: { id: contactId, name: "Client Exemple", user_id: null, company_id: companyId }, error: null },
    });

    const result = await createContact("suppliers", companyId, contactForm());

    expect(membershipQuery.eq).toHaveBeenCalledWith("company_id", companyId);
    expect(membershipQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(contactQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: null,
      company_id: companyId,
    }));
    expect(result.contact?.kind).toBe("suppliers");
  });

  it("does not write a company contact when the user is not a member", async () => {
    const { contactQuery } = setup({ companyMembership: { data: null, error: null } });

    const result = await createContact("customers", companyId, contactForm());

    expect(result.error).toContain("n’est pas associée");
    expect(contactQuery.insert).not.toHaveBeenCalled();
  });

  it("rejects invalid form values before authenticating or writing", async () => {
    setup();

    const result = await createContact("customers", null, contactForm({ email: "invalid" }));

    expect(result.error).toContain("adresse e-mail");
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
  });

  it("updates only the contact in the selected owner scope", async () => {
    const { contactQuery } = setup();

    const result = await updateContact("customers", null, contactId, contactForm({ name: "Nouveau nom" }));

    expect(contactQuery.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Nouveau nom" }));
    expect(contactQuery.eq).toHaveBeenCalledWith("id", contactId);
    expect(contactQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(contactQuery.is).toHaveBeenCalledWith("company_id", null);
    expect(result.success).toContain("modifié");
  });

  it("preserves the contact and associated invoices when RLS denies deletion", async () => {
    const { contactQuery } = setup({
      result: { data: null, error: { code: "42501" } },
    });

    const result = await deleteContact("suppliers", companyId, contactId);

    expect(contactQuery.delete).toHaveBeenCalled();
    expect(result.error).toContain("suppression a échoué");
    expect(result.success).toBeUndefined();
  });

  it("rejects malformed identifiers without running a query", async () => {
    const { contactQuery } = setup();

    const result = await deleteContact("customers", null, "not-a-uuid");

    expect(result.error).toContain("n’est pas valide");
    expect(contactQuery.delete).not.toHaveBeenCalled();
  });
});
