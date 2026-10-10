import { describe, expect, it, vi } from "vitest";
import { registerWithPassword } from "@/lib/auth/register";

const credentials = {
  firstName: "Jeanne",
  lastName: "Martin",
  email: "jeanne@example.com",
  password: "securite123",
};

describe("Supabase account registration", () => {
  it("passes names as user metadata and requests an email callback", async () => {
    const signUp = vi.fn(async () => ({ data: { session: null }, error: null }));
    const result = await registerWithPassword(
      signUp,
      credentials,
      "https://finance.example/auth/callback?next=%2Fdashboard",
    );

    expect(signUp).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
      options: {
        data: { first_name: "Jeanne", last_name: "Martin", full_name: "Jeanne Martin" },
        emailRedirectTo: "https://finance.example/auth/callback?next=%2Fdashboard",
      },
    });
    expect(result).toEqual({ confirmationRequired: true });
  });

  it("reports immediate session creation when email confirmation is disabled", async () => {
    const result = await registerWithPassword(
      async () => ({ data: { session: { access_token: "test" } }, error: null }),
      credentials,
      "https://finance.example/auth/callback?next=%2Fdashboard",
    );
    expect(result).toEqual({ confirmationRequired: false });
  });

  it("maps provider errors to a French message without exposing raw details", async () => {
    const result = await registerWithPassword(
      async () => ({ data: { session: null }, error: { message: "User already registered" } }),
      credentials,
      "https://finance.example/auth/callback?next=%2Fdashboard",
    );
    expect(result).toEqual({
      error: "Un compte existe déjà avec cette adresse e-mail. Connectez-vous ou réinitialisez votre mot de passe.",
    });
  });
});