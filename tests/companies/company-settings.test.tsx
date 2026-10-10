// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyProfile } from "@/types/company";

const { saveUserPreferences } = vi.hoisted(() => ({ saveUserPreferences: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/database/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LanguagePicker: () => <select aria-label="Langue de l’application" />,
  ThemeIcon: () => <span />,
}));
vi.mock("@/app/settings/actions", () => ({
  saveCompanyProfile: vi.fn(),
  saveUserProfile: vi.fn(),
  saveUserPreferences,
}));

const existingCompany: CompanyProfile = {
  id: "123e4567-e89b-42d3-a456-426614174000",
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
  registrationNumber: "RCS Paris",
};

import SettingsClient from "@/database/components/settings/settings-client";

describe("company settings panel", () => {
  afterEach(() => cleanup());

  it("keeps settings accessible and explains why company details cannot be saved without an association", () => {
    render(<SettingsClient companies={[]} companyLoadError={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Entreprise" }));

    expect(screen.getByRole("heading", { name: "Aucune entreprise associée" })).toBeTruthy();
    expect(screen.getByText(/L’espace entreprise est facultatif/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Créer l’entreprise" })).toBeTruthy();
  });

  it("loads saved language and theme preferences and persists changes", async () => {
    saveUserPreferences.mockResolvedValue({ success: "Préférence enregistrée sur votre compte." });
    render(
      <SettingsClient
        companies={[]}
        companyLoadError={null}
        profile={{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+33123456789", country: "France", locale: "fr" }}
        savedPreferences={{ locale: "fr", theme: "light" }}
      />,
    );

    const darkTheme = screen.getByRole("button", { name: /Sombre/ });
    expect(darkTheme.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(darkTheme);
    await waitFor(() => expect(saveUserPreferences).toHaveBeenCalledWith("fr", "dark"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Sombre/ }).getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("enregistrée"))).toBe(true));

    const sidebar = within(document.querySelector(".settings-sidebar")!);
    fireEvent.click(sidebar.getByRole("button", { name: "Apparence" }));
    expect(screen.getByRole("button", { name: /Sombre/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sidebar.getByRole("button", { name: "Langue" }));
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    await waitFor(() => expect(saveUserPreferences).toHaveBeenLastCalledWith("en", "dark"));
  });

  it("shows authenticated profile details and a real sign-out action", () => {
    render(
      <SettingsClient
        companies={[]}
        companyLoadError={null}
        profile={{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+33123456789", country: "France", locale: "fr" }}
        savedPreferences={{ locale: "fr", theme: "light" }}
      />,
    );
    fireEvent.click(within(document.querySelector(".settings-sidebar")!).getByRole("button", { name: "Profil" }));

    expect((screen.getByLabelText("Prénom") as HTMLInputElement).value).toBe("Ada");
    expect((screen.getByLabelText("Nom") as HTMLInputElement).value).toBe("Lovelace");
    expect((screen.getByLabelText("Adresse e-mail du compte") as HTMLInputElement).value).toBe("ada@example.com");
    expect((screen.getByLabelText("Téléphone") as HTMLInputElement).value).toBe("+33123456789");
    expect((screen.getByLabelText("Pays de résidence") as HTMLInputElement).value).toBe("France");
    expect((screen.getByLabelText("Langue préférée") as HTMLSelectElement).value).toBe("fr");
    expect(screen.getByRole("button", { name: "Déconnexion" })).toBeTruthy();
  });

  it("prefills company fields and keeps company data read-only for non-owners", () => {
    render(
      <SettingsClient
        companies={[existingCompany]}
        editableCompanyIds={[]}
        companyLoadError={null}
        profile={{ firstName: "", lastName: "", email: "", phone: "", country: "", locale: "fr" }}
        savedPreferences={{ locale: "fr", theme: "light" }}
      />,
    );
    fireEvent.click(within(document.querySelector(".settings-sidebar")!).getByRole("button", { name: "Entreprise" }));

    expect((screen.getByLabelText("Nom légal de l’entreprise") as HTMLInputElement).value).toBe("Atelier Nova");
    expect((screen.getByLabelText("SIRET (si applicable)") as HTMLInputElement).value).toBe("12345678901234");
    expect((screen.getByLabelText("Adresse") as HTMLInputElement).value).toBe("1 rue des Fleurs");
    expect((screen.getByLabelText("Adresse e-mail professionnelle") as HTMLInputElement).value).toBe("contact@example.com");
    expect((screen.getByLabelText("Devise principale") as HTMLSelectElement).value).toBe("EUR");
    expect((screen.getByLabelText("Nom légal de l’entreprise") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByText(/Seul le propriétaire peut modifier/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer les modifications" })).toBeNull();
  });
});
