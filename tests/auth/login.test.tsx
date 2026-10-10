import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import { signInWithPassword } from "@/lib/auth/sign-in";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("login navigation", () => {
  it("links the home sign-in button to /login", () => {
    const markup = renderToStaticMarkup(createElement(Home));
    expect(markup).toMatch(/<a[^>]+href="\/login"[^>]*>Se connecter<\/a>/);
    expect(markup).toContain('href="/register"');
    expect(markup).toMatch(/S(?:'|&#x27;)inscrire/);
  });

  it("renders the login form without checking for an existing session", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain("name=\"email\"");
    expect(markup).toContain("name=\"password\"");
    expect(markup).toContain("Connectez-vous");
  });

  it("renders a complete registration form and links back to login", () => {
    const markup = renderToStaticMarkup(createElement(RegisterPage));
    expect(markup).toContain("name=\"firstName\"");
    expect(markup).toContain("name=\"lastName\"");
    expect(markup).toContain("name=\"passwordConfirmation\"");
    expect(markup).toContain("J’accepte les");
    expect(markup).toContain("href=\"/terms\"");
    expect(markup).toContain("href=\"/login\"");
  });

  it("shows invalid confirmation callback errors on login", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ authError: "callback" }) });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain("Le lien de confirmation ou de récupération est invalide ou a expiré");
  });

  it("uses the authenticated destination after a successful password login", async () => {
    const authSignIn = vi.fn(async () => ({ error: null }));
    const result = await signInWithPassword(
      authSignIn,
      { email: "person@example.com", password: "correct horse" },
      "/settings?tab=profile",
    );

    expect(authSignIn).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "correct horse",
    });
    expect(result).toEqual({ redirectTo: "/settings?tab=profile" });
  });

  it("falls back to the dashboard when next is unsafe after login", async () => {
    const result = await signInWithPassword(
      async () => ({ error: null }),
      { email: "person@example.com", password: "correct horse" },
      "https://attacker.example",
    );
    expect(result).toEqual({ redirectTo: "/dashboard" });
  });
});