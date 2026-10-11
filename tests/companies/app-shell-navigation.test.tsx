// @vitest-environment jsdom

import { createElement, type AnchorHTMLAttributes } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/database/components/app-shell";
import { messages } from "@/i18n/messages";

const { getPathname } = vi.hoisted(() => ({ getPathname: vi.fn(() => "/dashboard") }));

vi.mock("next/navigation", () => ({ usePathname: getPathname }));
vi.mock("next/link", () => ({
  default: ({
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => createElement("a", { ...props, href }),
}));
vi.mock("@/app/settings/actions", () => ({
  saveUserPreferences: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  }),
}));
vi.mock("@/database/components/auth/logout-button", () => ({
  LogoutButton: () => createElement("button", null, "Déconnexion"),
}));

const expectedEntries = [
  ["Dashboard", "/dashboard", "main"],
  ["Factures", "/invoices", "finance"],
  ["Dépenses", "/expenses", "finance"],
  ["Échéances", "/due-dates", "finance"],
  ["Clients", "/clients", "company"],
  ["Fournisseurs", "/suppliers", "company"],
  ["Documents", "/documents", "company"],
  ["AI CFO", "/ai-cfo", "intelligence"],
  ["Paramètres", "/settings", "system"],
] as const;

describe("application sidebar navigation", () => {
  afterEach(cleanup);

  it("renders exactly the nine retained links with existing group labels and real routes", () => {
    render(<AppShell initialLocale="fr" initialTheme="light"><div /></AppShell>);
    const nav = screen.getByRole("navigation", { name: "Navigation de l’application" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(9);
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
      expectedEntries.map(([label, href]) => [label, href]),
    );

    const groups = within(nav).getAllByText(/^(Principal|Finance|Entreprise|Intelligence|Système)$/);
    expect(groups.map((group) => group.textContent)).toEqual([
      messages.fr.groups.main,
      messages.fr.groups.finance,
      messages.fr.groups.company,
      messages.fr.groups.intelligence,
      messages.fr.groups.system,
    ]);
    for (const [label, , group] of expectedEntries) {
      const sectionIndex = ["main", "finance", "company", "intelligence", "system"].indexOf(group);
      const section = nav.querySelectorAll<HTMLElement>(".nav-section").item(sectionIndex);
      expect(section && within(section).getByRole("link", { name: label })).toBeTruthy();
    }

    expect(within(nav).queryByText("Accueil")).toBeNull();
    expect(within(nav).queryByText(/^(Alertes|Historique|Revenus|Équipe|Analyses|AI Finance|Automatisations)$/)).toBeNull();
  });

  it("keeps the Dashboard route active without changing the route", () => {
    getPathname.mockReturnValue("/dashboard");
    render(<AppShell initialLocale="fr" initialTheme="light"><div /></AppShell>);
    const dashboardLink = within(screen.getByRole("navigation", { name: "Navigation de l’application" }))
      .getByRole("link", { name: "Dashboard" });

    expect(dashboardLink.getAttribute("href")).toBe("/dashboard");
    expect(dashboardLink.className).toContain("is-active");
  });
});
