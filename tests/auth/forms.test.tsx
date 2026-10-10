// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { LoginForm } from "@/database/components/auth/login-form";
import { RegisterForm } from "@/database/components/auth/register-form";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  createSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      getSession: mocks.getSession,
    },
  })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: mocks.createSupabaseBrowserClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

describe("authentication forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseBrowserClient.mockImplementation(() => ({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signUp: mocks.signUp,
        getSession: mocks.getSession,
      },
    }));
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  });

  afterEach(() => cleanup());

  it("renders login without redirecting or reading an existing session", () => {
    render(<LoginForm nextPath="/dashboard" />);
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("toggles password visibility accessibly", () => {
    render(<LoginForm nextPath="/dashboard" />);
    const password = screen.getByLabelText("Mot de passe") as HTMLInputElement;
    expect(password.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(password.type).toBe("text");
    expect(screen.getByRole("button", { name: "Masquer le mot de passe" })).toBeTruthy();
  });

  it("shows loading and ignores repeated login submissions", async () => {
    let finishRequest: ((result: { error: null }) => void) | undefined;
    mocks.signInWithPassword.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
    render(<LoginForm nextPath="/settings" />);
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "secret" } });
    const form = screen.getByRole("button", { name: "Se connecter" }).closest("form");
    if (!form) throw new Error("Login form was not rendered");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Connexion…" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);

    finishRequest?.({ error: null });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/settings"));
  });

  it("shows a clear French message on login failure", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm nextPath="/dashboard" />);
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "incorrect" } });
    const form = screen.getByRole("button", { name: "Se connecter" }).closest("form");
    if (!form) throw new Error("Login form was not rendered");
    fireEvent.submit(form);

    expect((await screen.findByRole("alert")).textContent).toContain("Adresse e-mail ou mot de passe incorrect.");
  });

  it("shows exact missing Supabase variables and never calls signUp", async () => {
    mocks.createSupabaseBrowserClient.mockImplementationOnce(() => {
      throw new SupabaseConfigurationError(
        "Configuration Supabase incomplète. Définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.local puis redémarrez le serveur.",
      );
    });
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Jeanne" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Martin" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe (8 caractères minimum)"), { target: { value: "securite123" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "securite123" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /conditions d’utilisation/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Créer mon compte" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("renders all registration fields and completes the email-confirmation state", async () => {
    render(<RegisterForm />);
    expect(screen.getByLabelText("Prénom")).toBeTruthy();
    expect(screen.getByLabelText("Nom")).toBeTruthy();
    expect(screen.getByLabelText("Adresse e-mail")).toBeTruthy();
    expect(screen.getByLabelText("Mot de passe (8 caractères minimum)")).toBeTruthy();
    expect(screen.getByLabelText("Confirmer le mot de passe")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /conditions d’utilisation/ })).toBeTruthy();
    expect(screen.queryByLabelText(/entreprise|siret|iban/i)).toBeNull();

    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Jeanne" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Martin" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe (8 caractères minimum)"), { target: { value: "securite123" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "securite123" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /conditions d’utilisation/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Créer mon compte" }).closest("form")!);

    expect((await screen.findByRole("status")).textContent).toContain("Consultez votre boîte mail");
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "jeanne@example.com",
      options: expect.objectContaining({
        data: { first_name: "Jeanne", last_name: "Martin", full_name: "Jeanne Martin" },
      }),
    }));
  });

  it("blocks mismatched passwords and missing terms consent before calling Supabase", async () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Jeanne" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Martin" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe (8 caractères minimum)"), { target: { value: "securite123" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "different123" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /conditions d’utilisation/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Créer mon compte" }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("Les mots de passe ne correspondent pas.");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("redirects after immediate account creation when email confirmation is disabled", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Jeanne" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Martin" } });
    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "jeanne@example.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe (8 caractères minimum)"), { target: { value: "securite123" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "securite123" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /conditions d’utilisation/ }));
    fireEvent.submit(screen.getByRole("button", { name: "Créer mon compte" }).closest("form")!);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
  });
});