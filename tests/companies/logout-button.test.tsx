// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/database/components/auth/logout-button";

const { replace, refresh, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut } }),
}));

describe("logout button", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("signs out and redirects only after Supabase confirms success", async () => {
    signOut.mockResolvedValueOnce({ error: null });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Déconnexion" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(replace).toHaveBeenCalledWith("/login");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the session route when sign-out fails and shows an error", async () => {
    signOut.mockResolvedValueOnce({ error: { name: "AuthApiError" } });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Déconnexion" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
