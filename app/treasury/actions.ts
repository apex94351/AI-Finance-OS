"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";

const openingBalanceInputSchema = z.object({
  companyId: z.union([z.literal(""), z.uuid()]),
  amount: z.string().trim().regex(/^-?\d{1,12}(?:[.,]\d{1,2})?$/),
  date: z.iso.date(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
});

export interface TreasuryActionState {
  error?: string;
  success?: string;
}

export async function saveTreasuryOpeningBalance(
  _previousState: TreasuryActionState,
  formData: FormData,
): Promise<TreasuryActionState> {
  const parsed = openingBalanceInputSchema.safeParse({
    companyId: formData.get("companyId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) {
    return { error: "Vérifiez le montant, la date et la devise du solde initial." };
  }
  const amount = Number(parsed.data.amount.replace(",", "."));
  if (!Number.isFinite(amount) || Math.abs(amount) > 999999999999.99) {
    return { error: "Le montant du solde initial dépasse la limite autorisée." };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.date > today) {
    return { error: "La date du solde initial ne peut pas être future." };
  }

  const { supabase, user } = await getAuthenticatedSupabase("/treasury");
  const companyId = parsed.data.companyId || null;
  if (companyId) {
    const { data: membership, error: membershipError } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) {
      console.error("Treasury company membership check failed", { code: membershipError.code });
      return { error: "Impossible de vérifier votre accès à cette entreprise." };
    }
    if (!membership) return { error: "Cette entreprise n’est pas associée à votre compte." };
  }

  const result = await supabase.from("treasury_opening_balances").upsert({
    user_id: companyId ? null : user.id,
    company_id: companyId,
    currency: parsed.data.currency,
    opening_balance: amount,
    opening_date: parsed.data.date,
  }, {
    onConflict: "user_id,company_id,currency",
  });
  if (result.error) {
    console.error("Treasury opening balance save failed", { code: result.error.code });
    if (["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(result.error.code ?? "")) {
      return { error: "La configuration du solde initial nécessite l’application manuelle de la migration 019_treasury_opening_balance_and_supplier_payment_idempotency.sql sur Supabase." };
    }
    if (result.error.code === "42501") {
      return { error: "Vous ne disposez pas des droits nécessaires pour configurer le solde initial de cet espace." };
    }
    return { error: "Le solde initial n’a pas pu être enregistré. Vérifiez vos droits et réessayez." };
  }

  revalidatePath("/treasury");
  return { success: "Le solde initial a été enregistré." };
}
