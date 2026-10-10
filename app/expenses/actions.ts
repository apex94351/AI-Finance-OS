"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { expenseInputSchema } from "@/services/expenses";

export interface ExpenseActionState {
  error?: string;
  success?: string;
}

const uuidSchema = z.uuid();

function value(formData: FormData, key: string): string {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry : "";
}

async function getExpenseAccess(companyId: string | null) {
  const { supabase, user } = await getAuthenticatedSupabase("/expenses");
  if (!companyId) return { supabase, user } as const;
  if (!uuidSchema.safeParse(companyId).success) {
    return { error: "Sélectionnez un espace d’entreprise valide." } as const;
  }
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Expense company membership check failed", { code: error.code });
    return { error: "Impossible de vérifier votre accès à cette entreprise." } as const;
  }
  if (!data) return { error: "Cette entreprise n’est pas associée à votre compte." } as const;
  if (!["owner", "admin", "accountant"].includes(data.role)) {
    return { error: "Vous ne disposez pas des droits nécessaires pour modifier les dépenses de cette entreprise." } as const;
  }
  return { supabase, user } as const;
}

export async function saveExpense(
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const companyIdValue = value(formData, "companyId");
  const expenseIdValue = value(formData, "expenseId");
  const companyId = companyIdValue || null;
  if (companyId && !uuidSchema.safeParse(companyId).success) {
    return { error: "Sélectionnez un espace d’entreprise valide." };
  }
  const expenseId = expenseIdValue ? uuidSchema.safeParse(expenseIdValue) : null;
  if (expenseId && !expenseId.success) return { error: "La dépense sélectionnée n’est pas valide." };

  const parsed = expenseInputSchema.safeParse({
    label: value(formData, "label"),
    amount: value(formData, "amount"),
    currency: value(formData, "currency"),
    expenseDate: value(formData, "expenseDate"),
    category: value(formData, "category"),
    supplierId: value(formData, "supplierId"),
    status: value(formData, "status"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Vérifiez les informations de la dépense." };
  }

  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;

  let currency = parsed.data.currency;
  if (companyId) {
    const companyResult = await access.supabase
      .from("companies")
      .select("currency")
      .eq("id", companyId)
      .maybeSingle();
    if (companyResult.error) {
      console.error("Expense company currency query failed", { code: companyResult.error.code });
      return { error: "Impossible de charger la devise de l’entreprise." };
    }
    if (!companyResult.data || !/^[A-Z]{3}$/.test(companyResult.data.currency)) {
      return { error: "La devise de cette entreprise n’est pas disponible." };
    }
    currency = companyResult.data.currency;
  }

  if (parsed.data.supplierId) {
    const supplierQuery = access.supabase.from("suppliers")
      .select("id")
      .eq("id", parsed.data.supplierId);
    const supplierResult = companyId
      ? await supplierQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
      : await supplierQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
    if (supplierResult.error) {
      console.error("Expense supplier validation failed", { code: supplierResult.error.code });
      return { error: "Impossible de vérifier le fournisseur sélectionné." };
    }
    if (!supplierResult.data) return { error: "Ce fournisseur n’est pas accessible dans l’espace sélectionné." };
  }

  const expenseData = {
    user_id: companyId ? null : access.user.id,
    company_id: companyId,
    label: parsed.data.label,
    amount: parsed.data.amount,
    currency,
    expense_date: parsed.data.expenseDate,
    category: parsed.data.category,
    supplier_id: parsed.data.supplierId,
    status: parsed.data.status,
    notes: parsed.data.notes,
  };

  const result = expenseId
    ? await (companyId
      ? access.supabase.from("expenses").update(expenseData).eq("id", expenseId.data).eq("company_id", companyId).is("user_id", null)
      : access.supabase.from("expenses").update(expenseData).eq("id", expenseId.data).eq("user_id", access.user.id).is("company_id", null))
      .select("id").maybeSingle()
    : await access.supabase.from("expenses")
      .insert(expenseData)
      .select("id")
      .maybeSingle();

  if (result.error) {
    console.error("Expense save failed", { code: result.error.code });
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(result.error.code ?? "")) {
      return { error: "Le module Dépenses n’est pas encore activé dans Supabase. Appliquez la migration 009_expenses.sql après ses prérequis." };
    }
    return { error: "L’enregistrement de la dépense a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "La dépense n’a pas été trouvée dans cet espace." };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { success: expenseId ? "La dépense a été modifiée." : "La dépense a été enregistrée." };
}
