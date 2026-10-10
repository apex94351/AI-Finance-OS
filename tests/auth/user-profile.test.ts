import { describe, expect, it } from "vitest";
import { getUserProfileSettings } from "@/lib/auth/user-profile";

describe("auth-backed profile settings", () => {
  it("loads signup names, verified auth email, optional persisted details, and locale", () => {
    expect(getUserProfileSettings({
      email: "ada@example.com",
      user_metadata: {
        first_name: "Ada",
        last_name: "Lovelace",
        full_name: "Ada Lovelace",
        phone: "+33123456789",
        country_of_residence: "France",
        ai_finance_preferences: { locale: "fr", theme: "dark" },
      },
    })).toEqual({
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "+33123456789",
        country: "France",
        locale: "fr",
      },
      preferences: { locale: "fr", theme: "dark" },
    });
  });

  it("keeps missing optional profile data empty and does not invent loaded preferences", () => {
    expect(getUserProfileSettings({ email: "user@example.com", user_metadata: {} })).toEqual({
      profile: {
        firstName: "",
        lastName: "",
        email: "user@example.com",
        phone: "",
        country: "",
        locale: "fr",
      },
      preferences: null,
    });
  });
});
