import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSupabase, revalidatePath, rpc } = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedSupabase }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { recordExpensePayment } from "@/app/expenses/actions";

const expenseId = "123e4567-e89b-42d3-a456-426614174002";

describe("expense payment server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ error: null });
    getAuthenticatedSupabase.mockResolvedValue({
      supabase: { rpc, from: vi.fn() },
      user: { id: "123e4567-e89b-42d3-a456-426614174001" },
    });
  });

  it("records the user-confirmed amount and actual payment date through the existing RPC", async () => {
    const result = await recordExpensePayment(null, expenseId, "2026-10-08", "42,50");

    expect(rpc).toHaveBeenCalledWith("record_expense_payment", {
      target_expense_id: expenseId,
      target_payment_date: "2026-10-08",
      target_amount: 42.5,
    });
    expect(result.success).toContain("paiement a été enregistré");
    expect(revalidatePath).toHaveBeenCalledWith("/expenses");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/due-dates");
  });

  it("returns a visible overpayment error and does not claim success", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "22003" } });

    const result = await recordExpensePayment(null, expenseId, "2026-10-08", "42.50");

    expect(result.error).toContain("dépasse le solde restant");
    expect(result.success).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
