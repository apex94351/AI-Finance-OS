import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, rpc } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { createCompany } from "@/app/dashboard/actions";

function companyForm(name: string) {
  const formData = new FormData();
  formData.set("name", name);
  return formData;
}

describe("create company server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedSupabase.mockResolvedValue({ supabase: { rpc } });
    rpc.mockResolvedValue({
      data: [{ company_id: "123e4567-e89b-42d3-a456-426614174000", company_name: "Atelier Nova" }],
      error: null,
    });
  });

  it("uses the authenticated server session and never accepts a user id", async () => {
    const result = await createCompany({}, companyForm("  Atelier Nova  "));

    expect(getAuthenticatedSupabase).toHaveBeenCalledWith("/dashboard");
    expect(rpc).toHaveBeenCalledWith("create_company_for_current_user", { p_name: "Atelier Nova" });
    expect(result).toEqual({ createdCompanyName: "Atelier Nova" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects invalid names before accessing the database", async () => {
    const result = await createCompany({}, companyForm("   "));

    expect(result).toEqual({ error: "Saisissez le nom de votre entreprise." });
    expect(getAuthenticatedSupabase).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports when the required migration is not installed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });

    const result = await createCompany({}, companyForm("Atelier Nova"));

    expect(result.error).toContain("Appliquez la migration Supabase");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not report success if the RPC returns an invalid result", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await createCompany({}, companyForm("Atelier Nova"));

    expect(result.error).toContain("La réponse de Supabase est invalide");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
