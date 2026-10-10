// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, from, propsSink } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  from: vi.fn(),
  propsSink: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("@/database/components/settings/settings-client", () => ({
  default: (props: Record<string, unknown>) => {
    propsSink(props);
    return <output>{JSON.stringify(props)}</output>;
  },
}));

import SettingsPage from "@/app/settings/page";

const firstCompanyId = "123e4567-e89b-42d3-a456-426614174000";
const secondCompanyId = "123e4567-e89b-42d3-a456-426614174002";

function setup({
  memberships = [
    { company_id: firstCompanyId, role: "owner" },
    { company_id: secondCompanyId, role: "member" },
  ],
  companies = [
    {
      id: firstCompanyId, name: "Atelier Nova", trade_name: "Nova", legal_form: "SAS",
      siret: "12345678901234", siren: "123456789", vat_number: "FR123",
      industry: "Conseil", country: "FR", address: "1 rue A", address_complement: "Étage 2",
      postal_code: "75001", city: "Paris", phone: "+33123456789", email: "pro@example.com",
      currency: "EUR", registration_number: "RCS Paris",
    },
    {
      id: secondCompanyId, name: "Entreprise B", trade_name: null, legal_form: null,
      siret: null, siren: null, vat_number: null, industry: null, country: "DE",
      address: null, address_complement: null, postal_code: null, city: null,
      phone: null, email: null, currency: "EUR", registration_number: null,
    },
  ],
} = {}) {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockResolvedValue({ data: memberships, error: null });

  const companyQuery = {
    select: vi.fn(),
    in: vi.fn(),
  };
  companyQuery.select.mockReturnValue(companyQuery);
  companyQuery.in.mockResolvedValue({ data: companies, error: null });
  from.mockImplementation((table: string) => table === "company_members" ? membershipQuery : companyQuery);
  getAuthenticatedSupabase.mockResolvedValue({
    supabase: { from },
    user: {
      id: "123e4567-e89b-42d3-a456-426614174001",
      email: "ada@example.com",
      user_metadata: {
        first_name: "Ada",
        last_name: "Lovelace",
        phone: "+33111111111",
        country_of_residence: "France",
        ai_finance_preferences: { locale: "fr", theme: "dark" },
      },
    },
  });
  return { companyQuery };
}

describe("settings server page data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefills profile from auth metadata and company data from membership-scoped rows", async () => {
    const { companyQuery } = setup();

    render(await SettingsPage());

    const props = propsSink.mock.calls[0]?.[0] as {
      profile: Record<string, string>;
      companies: Array<Record<string, string>>;
      editableCompanyIds: string[];
      savedPreferences: { locale: string; theme: string };
    };
    expect(props.profile).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+33111111111",
      country: "France",
      locale: "fr",
    });
    expect(props.companies[0]).toMatchObject({
      id: firstCompanyId,
      legalName: "Atelier Nova",
      tradeName: "Nova",
      addressComplement: "Étage 2",
      currency: "EUR",
    });
    expect(props.editableCompanyIds).toEqual([firstCompanyId]);
    expect(props.savedPreferences).toEqual({ locale: "fr", theme: "dark" });
    expect(companyQuery.in).toHaveBeenCalledWith("id", [firstCompanyId, secondCompanyId]);
  });

  it("shows no invented personal data when user metadata lacks optional values", async () => {
    setup({ memberships: [], companies: [] });
    getAuthenticatedSupabase.mockResolvedValueOnce({
      supabase: { from },
      user: { id: "user-id", email: "new@example.com", user_metadata: {} },
    });

    render(await SettingsPage());

    const props = propsSink.mock.calls[0]?.[0] as {
      profile: Record<string, string>;
      companies: unknown[];
      editableCompanyIds: unknown[];
      savedPreferences: unknown;
    };
    expect(props.profile).toEqual({
      firstName: "",
      lastName: "",
      email: "new@example.com",
      phone: "",
      country: "",
      locale: "fr",
    });
    expect(props.companies).toEqual([]);
    expect(props.editableCompanyIds).toEqual([]);
    expect(props.savedPreferences).toBeNull();
  });
});
