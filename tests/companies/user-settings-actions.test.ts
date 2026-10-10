import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, updateUser } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveUserPreferences, saveUserProfile } from "@/app/settings/actions";

function profileForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "",
    country: "",
    locale: "fr",
    ...overrides,
  })) {
    form.set(key, value);
  }
  return form;
}

describe("user settings persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue({ error: null });
    getAuthenticatedSupabase.mockResolvedValue({
      supabase: { auth: { updateUser } },
      user: {
        id: "user-id",
        email: "ada@example.com",
        user_metadata: {
          avatar_url: "https://example.invalid/avatar.png",
          phone: "existing phone",
          country_of_residence: "Existing country",
          ai_finance_preferences: { locale: "fr", theme: "dark" },
        },
      },
    });
  });

  it("validates profile fields before making an authenticated update", async () => {
    const result = await saveUserProfile({}, profileForm({ firstName: "" }));

    expect(result.fieldErrors?.firstName).toContain("prénom");
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
  });

  it("persists profile names while preserving existing auth metadata", async () => {
    const result = await saveUserProfile({}, profileForm({ firstName: " Grace ", lastName: " Hopper " }));

    expect(getAuthenticatedSupabase).toHaveBeenCalledWith("/settings");
    expect(updateUser).toHaveBeenCalledWith({
      data: {
        avatar_url: "https://example.invalid/avatar.png",
        phone: "",
        country_of_residence: "",
        ai_finance_preferences: { locale: "fr", theme: "dark" },
        first_name: "Grace",
        last_name: "Hopper",
        full_name: "Grace Hopper",
      },
    });
    expect(result.profile).toEqual({
      firstName: "Grace",
      lastName: "Hopper",
      phone: "",
      country: "",
      locale: "fr",
    });
    expect(result.preferences).toEqual({ locale: "fr", theme: "dark" });
    expect(result.success).toContain("profil");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("persists valid language and theme preferences without clearing profile data", async () => {
    const result = await saveUserPreferences("de", "system");

    expect(updateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        avatar_url: "https://example.invalid/avatar.png",
        phone: "existing phone",
        country_of_residence: "Existing country",
        ai_finance_preferences: { locale: "de", theme: "system" },
      }),
    });
    expect(result.success).toContain("Préférence");
  });

  it("reports invalid preferences and persistence errors without claiming success", async () => {
    expect(await saveUserPreferences("xx", "sepia")).toEqual({ error: "La langue ou le thème sélectionné n’est pas valide." });
    expect(updateUser).not.toHaveBeenCalled();

    updateUser.mockResolvedValueOnce({ error: { name: "AuthApiError" } });
    expect(await saveUserPreferences("fr", "light")).toEqual({
      error: "La préférence reste appliquée sur cet appareil, mais n’a pas pu être enregistrée sur votre compte.",
    });
  });

  it("saves profile phone, country, and language without changing the authentication email", async () => {
    const result = await saveUserProfile({}, profileForm({
      phone: "+33612345678",
      country: "France",
      locale: "en",
    }));

    expect(updateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: "+33612345678",
        country_of_residence: "France",
        ai_finance_preferences: { locale: "en", theme: "dark" },
      }),
    });
    expect(updateUser.mock.calls[0]?.[0].data).not.toHaveProperty("email");
    expect(result.profile?.locale).toBe("en");
  });

  it("preserves submitted profile data when Supabase returns an error", async () => {
    updateUser.mockResolvedValueOnce({ error: { name: "AuthApiError" } });
    const result = await saveUserProfile({}, profileForm({ firstName: "Grace", phone: "123" }));

    expect(result.error).toContain("n’a pas pu être enregistré");
    expect(result.profile).toBeUndefined();
  });
});
