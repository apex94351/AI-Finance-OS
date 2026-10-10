import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, from } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveCompanyProfile } from "@/app/settings/actions";

const companyId = "123e4567-e89b-42d3-a456-426614174000";

function profileForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    companyId,
    legalName: "Atelier Nova",
    tradeName: "Nova",
    legalForm: "SAS",
    siret: "12345678901234",
    siren: "123456789",
    vatNumber: "FR12345678901",
    industry: "Conseil",
    country: "FR",
    address: "1 rue des Fleurs",
    addressComplement: "Bâtiment A",
    postalCode: "75001",
    city: "Paris",
    phone: "+33123456789",
    email: "contact@example.com",
    currency: "EUR",
    registrationNumber: "RCS Paris B 123456789",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function setupQueries({
  membership = { data: { company_id: companyId, role: "owner" }, error: null },
  update = { data: { id: companyId }, error: null },
}: {
  membership?: { data: { company_id: string; role: string } | null; error: { code: string } | null };
  update?: { data: { id: string } | null; error: { code: string } | null };
} = {}) {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  membershipQuery.maybeSingle.mockResolvedValue(membership);

  const companyQuery = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  companyQuery.update.mockReturnValue(companyQuery);
  companyQuery.eq.mockReturnValue(companyQuery);
  companyQuery.select.mockReturnValue(companyQuery);
  companyQuery.maybeSingle.mockResolvedValue(update);
  from.mockImplementation((table: string) => table === "company_members" ? membershipQuery : companyQuery);
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from },
    user: { id: "123e4567-e89b-42d3-a456-426614174001" },
  });

  return { membershipQuery, companyQuery };
}

describe("save company profile server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates the form before querying Supabase", async () => {
    const result = await saveCompanyProfile({}, profileForm({ siret: "123" }));

    expect(result.fieldErrors?.siret).toContain("14 chiffres");
    expect(result.fieldErrors?.siret).toContain("SIRET");
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
  });

  it("accepts foreign registration identifiers without French-only digit rules", async () => {
    const { companyQuery } = setupQueries();
    const result = await saveCompanyProfile({}, profileForm({
      country: "DE",
      siret: "HRB 123456",
      siren: "Amtsgericht Berlin",
    }));

    expect(result.success).toContain("enregistrées");
    expect(companyQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      country: "DE",
      siret: "HRB 123456",
      siren: "Amtsgericht Berlin",
    }));
  });

  it("does not update a company without a current-user membership", async () => {
    const { companyQuery } = setupQueries({ membership: { data: null, error: null } });

    const result = await saveCompanyProfile({}, profileForm());

    expect(result.error).toContain("n’est pas associée");
    expect(companyQuery.update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not let a non-owner edit shared company settings", async () => {
    const { companyQuery } = setupQueries({ membership: { data: { company_id: companyId, role: "member" }, error: null } });

    const result = await saveCompanyProfile({}, profileForm());

    expect(result.error).toContain("propriétaire");
    expect(companyQuery.update).not.toHaveBeenCalled();
  });

  it("scopes the membership check and update to the submitted company and current user", async () => {
    const { membershipQuery, companyQuery } = setupQueries();

    await saveCompanyProfile({}, profileForm());

    expect(membershipQuery.eq).toHaveBeenNthCalledWith(1, "company_id", companyId);
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(companyQuery.eq).toHaveBeenCalledWith("id", companyId);
  });

  it("updates the existing company row and reports success", async () => {
    const { membershipQuery, companyQuery } = setupQueries();

    const result = await saveCompanyProfile({}, profileForm());

    expect(getAuthenticatedSupabase).toHaveBeenCalledWith("/settings");
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(1, "company_id", companyId);
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(2, "user_id", "123e4567-e89b-42d3-a456-426614174001");
    expect(companyQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      name: "Atelier Nova",
      trade_name: "Nova",
      country: "FR",
      currency: "EUR",
      registration_number: "RCS Paris B 123456789",
    }));
    expect(companyQuery.eq).toHaveBeenCalledWith("id", companyId);
    expect(result.success).toContain("enregistrées");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("reports a missing profile migration instead of claiming success", async () => {
    setupQueries({ update: { data: null, error: { code: "42703" } } });

    const result = await saveCompanyProfile({}, profileForm());

    expect(result.error).toContain("migration 003");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
