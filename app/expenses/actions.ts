"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { expenseInputSchema, recurringExpenseInputSchema } from "@/services/expenses";

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
    dueDate: value(formData, "dueDate"),
    subtotalHt: value(formData, "subtotalHt"),
    vatRate: value(formData, "vatRate"),
    vatAmount: value(formData, "vatAmount"),
    category: value(formData, "category"),
    supplierId: value(formData, "supplierId"),
    documentId: value(formData, "documentId"),
    invoiceId: value(formData, "invoiceId"),
    status: value(formData, "status"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Vérifiez les informations de la dépense." };
  }
  if (parsed.data.dueDate && parsed.data.dueDate < parsed.data.expenseDate) {
    return { error: "L’échéance ne peut pas précéder la date de dépense." };
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
  if (parsed.data.documentId) {
    const documentQuery = access.supabase.from("documents").select("id").eq("id", parsed.data.documentId);
    const documentResult = companyId
      ? await documentQuery.eq("company_id", companyId).is("user_id", null).is("deleted_at", null).maybeSingle()
      : await documentQuery.eq("user_id", access.user.id).is("company_id", null).is("deleted_at", null).maybeSingle();
    if (documentResult.error) {
      console.error("Expense document validation failed", { code: documentResult.error.code });
      return { error: "Impossible de vérifier le justificatif sélectionné." };
    }
    if (!documentResult.data) return { error: "Ce justificatif n’est pas accessible dans l’espace sélectionné." };
  }
  if (parsed.data.invoiceId) {
    const invoiceQuery = access.supabase.from("invoices")
      .select("id, supplier_id")
      .eq("id", parsed.data.invoiceId);
    const invoiceResult = companyId
      ? await invoiceQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
      : await invoiceQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
    if (invoiceResult.error) {
      console.error("Expense invoice validation failed", { code: invoiceResult.error.code });
      return { error: "Impossible de vérifier la facture fournisseur associée." };
    }
    if (!invoiceResult.data?.supplier_id) {
      return { error: "Seule une facture fournisseur du même espace peut être associée à cette dépense." };
    }
    if (parsed.data.supplierId && parsed.data.supplierId !== invoiceResult.data.supplier_id) {
      return { error: "Le fournisseur doit correspondre à la facture associée." };
    }
  }

  const expenseData = {
    user_id: companyId ? null : access.user.id,
    company_id: companyId,
    label: parsed.data.label,
    amount: parsed.data.amount,
    currency,
    expense_date: parsed.data.expenseDate,
    due_date: parsed.data.dueDate,
    subtotal_ht: parsed.data.subtotalHt,
    vat_rate: parsed.data.vatRate,
    vat_amount: parsed.data.vatAmount,
    category: parsed.data.category,
    supplier_id: parsed.data.supplierId,
    document_id: parsed.data.documentId,
    invoice_id: parsed.data.invoiceId,
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
    if (result.error.code === "23514") {
      return { error: "Le montant ne peut pas être inférieur aux paiements déjà enregistrés." };
    }
    if (["42703", "42P01", "PGRST204", "PGRST205"].includes(result.error.code ?? "")) {
      return { error: "Le modèle étendu Dépenses n’est pas disponible. Vérifiez les migrations 009_expenses.sql et 015_expense_operations.sql ainsi que leurs prérequis." };
    }
    return { error: "L’enregistrement de la dépense a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "La dépense n’a pas été trouvée dans cet espace." };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/due-dates");
  revalidatePath("/suppliers");
  return { success: expenseId ? "La dépense a été modifiée." : "La dépense a été enregistrée." };
}

export async function deleteExpense(companyId: string | null, expenseId: string): Promise<ExpenseActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(expenseId).success) {
    return { error: "La dépense sélectionnée n’est pas valide." };
  }
  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;

  const query = access.supabase.from("expenses").delete().eq("id", expenseId);
  const scoped = companyId
    ? query.eq("company_id", companyId).is("user_id", null)
    : query.eq("user_id", access.user.id).is("company_id", null);
  const { data, error } = await scoped.select("id").maybeSingle();
  if (error) {
    console.error("Expense delete failed", { code: error.code });
    return { error: "La suppression de la dépense a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La dépense est introuvable ou vous ne disposez pas des droits nécessaires." };

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/due-dates");
  revalidatePath("/suppliers");
  return { success: "La dépense a été supprimée." };
}

export async function markExpensePaid(companyId: string | null, expenseId: string): Promise<ExpenseActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(expenseId).success) {
    return { error: "La dépense sélectionnée n’est pas valide." };
  }
  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;
  const query = access.supabase.from("expenses").update({ status: "paid" }).eq("id", expenseId);
  const scoped = companyId
    ? query.eq("company_id", companyId).is("user_id", null)
    : query.eq("user_id", access.user.id).is("company_id", null);
  const { data, error } = await scoped.select("id").maybeSingle();
  if (error) {
    console.error("Expense status update failed", { code: error.code });
    return { error: "La dépense n’a pas pu être marquée comme payée." };
  }
  if (!data) return { error: "La dépense est introuvable ou vous ne disposez pas des droits nécessaires." };
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/due-dates");
  return { success: "La dépense a été marquée comme payée." };
}

export async function recordExpensePayment(
  companyId: string | null,
  expenseId: string,
  paymentDate: string,
  amount: string,
): Promise<ExpenseActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(expenseId).success) {
    return { error: "La dépense sélectionnée n’est pas valide." };
  }
  const parsedDate = z.iso.date().safeParse(paymentDate);
  const parsedAmount = z.string().trim().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/).safeParse(amount);
  if (!parsedDate.success || !parsedAmount.success || Number(parsedAmount.data.replace(",", ".")) <= 0) {
    return { error: "Saisissez une date et un montant de paiement valides." };
  }
  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;

  const { error } = await access.supabase.rpc("record_expense_payment", {
    target_expense_id: expenseId,
    target_payment_date: parsedDate.data,
    target_amount: Number(parsedAmount.data.replace(",", ".")),
  });
  if (error) {
    console.error("Expense payment recording failed", { code: error.code });
    if (error.code === "P0002") return { error: "La dépense est introuvable, annulée ou inaccessible." };
    if (error.code === "22003") return { error: "Le paiement dépasse le solde restant de la dépense." };
    if (error.code === "22007") return { error: "La date de paiement ne peut pas être future." };
    if (["42883", "PGRST202"].includes(error.code ?? "")) {
      return { error: "L’enregistrement des paiements n’est pas activé. Appliquez manuellement la migration 015_expense_operations.sql." };
    }
    return { error: "Le paiement n’a pas pu être enregistré. Vérifiez vos droits et réessayez." };
  }
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/due-dates");
  revalidatePath("/suppliers");
  return { success: "Le paiement a été enregistré." };
}

export async function saveRecurringExpense(
  _previousState: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const companyId = value(formData, "companyId") || null;
  const recurringIdValue = value(formData, "recurringId");
  const recurringId = recurringIdValue ? uuidSchema.safeParse(recurringIdValue) : null;
  if ((companyId && !uuidSchema.safeParse(companyId).success) || (recurringId && !recurringId.success)) {
    return { error: "L’espace ou la récurrence sélectionné n’est pas valide." };
  }
  const parsed = recurringExpenseInputSchema.safeParse({
    label: value(formData, "label"),
    amount: value(formData, "amount"),
    currency: value(formData, "currency"),
    subtotalHt: value(formData, "subtotalHt"),
    vatRate: value(formData, "vatRate"),
    vatAmount: value(formData, "vatAmount"),
    category: value(formData, "category"),
    supplierId: value(formData, "supplierId"),
    documentId: value(formData, "documentId"),
    frequency: value(formData, "frequency"),
    startDate: value(formData, "startDate"),
    endDate: value(formData, "endDate"),
    notes: value(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Vérifiez les paramètres de récurrence." };

  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;
  let currency = parsed.data.currency;
  if (companyId) {
    const companyResult = await access.supabase.from("companies").select("currency").eq("id", companyId).maybeSingle();
    if (companyResult.error) {
      console.error("Recurring expense company query failed", { code: companyResult.error.code });
      return { error: "Impossible de charger la devise de l’entreprise." };
    }
    if (!companyResult.data) return { error: "Cette entreprise n’est pas accessible." };
    currency = companyResult.data.currency;
  }
  if (parsed.data.supplierId) {
    const supplierQuery = access.supabase.from("suppliers").select("id").eq("id", parsed.data.supplierId);
    const supplier = companyId
      ? await supplierQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
      : await supplierQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
    if (supplier.error) {
      console.error("Recurring expense supplier validation failed", { code: supplier.error.code });
      return { error: "Impossible de vérifier le fournisseur sélectionné." };
    }
    if (!supplier.data) return { error: "Ce fournisseur n’est pas accessible dans l’espace sélectionné." };
  }
  if (parsed.data.documentId) {
    const documentQuery = access.supabase.from("documents").select("id").eq("id", parsed.data.documentId).is("deleted_at", null);
    const document = companyId
      ? await documentQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
      : await documentQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
    if (document.error || !document.data) {
      if (document.error) console.error("Recurring expense document validation failed", { code: document.error.code });
      return { error: "Le justificatif n’est pas accessible dans l’espace sélectionné." };
    }
  }

  let nextDueDate = parsed.data.startDate;
  if (recurringId) {
    const currentQuery = access.supabase.from("recurring_expenses")
      .select("next_due_date")
      .eq("id", recurringId.data);
    const currentResult = companyId
      ? await currentQuery.eq("company_id", companyId).is("user_id", null).maybeSingle()
      : await currentQuery.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
    if (currentResult.error) {
      console.error("Recurring expense schedule query failed", { code: currentResult.error.code });
      return { error: "Impossible de préserver la prochaine échéance de cette récurrence." };
    }
    if (!currentResult.data) return { error: "Cette récurrence est introuvable ou inaccessible." };
    nextDueDate = currentResult.data.next_due_date < parsed.data.startDate
      ? parsed.data.startDate
      : currentResult.data.next_due_date;
  }

  const data = {
    user_id: companyId ? null : access.user.id,
    company_id: companyId,
    label: parsed.data.label,
    amount: parsed.data.amount,
    currency,
    subtotal_ht: parsed.data.subtotalHt,
    vat_rate: parsed.data.vatRate,
    vat_amount: parsed.data.vatAmount,
    supplier_id: parsed.data.supplierId,
    document_id: parsed.data.documentId,
    category: parsed.data.category,
    frequency: parsed.data.frequency,
    start_date: parsed.data.startDate,
    next_due_date: nextDueDate,
    end_date: parsed.data.endDate,
    notes: parsed.data.notes,
  };
  const result = recurringId
    ? await access.supabase.from("recurring_expenses").update(data).eq("id", recurringId.data)
      .eq(companyId ? "company_id" : "user_id", companyId ?? access.user.id)
      .select("id").maybeSingle()
    : await access.supabase.from("recurring_expenses").insert(data).select("id").maybeSingle();
  if (result.error || !result.data) {
    if (result.error) console.error("Recurring expense save failed", { code: result.error.code });
    return { error: "La récurrence n’a pas pu être enregistrée. Vérifiez que la migration 015_expense_operations.sql est appliquée." };
  }
  revalidatePath("/expenses");
  return { success: recurringId ? "La récurrence a été modifiée." : "La récurrence a été créée." };
}

export async function setRecurringExpenseStatus(
  companyId: string | null,
  recurringId: string,
  status: "active" | "paused" | "stopped",
): Promise<ExpenseActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(recurringId).success) {
    return { error: "La récurrence sélectionnée n’est pas valide." };
  }
  const access = await getExpenseAccess(companyId);
  if ("error" in access) return access;
  const { error } = await access.supabase.rpc("set_recurring_expense_status", {
    target_id: recurringId,
    target_status: status,
  });
  if (error) {
    console.error("Recurring expense status update failed", { code: error.code });
    return { error: "Le statut de la récurrence n’a pas pu être mis à jour. Vérifiez la migration 015." };
  }
  revalidatePath("/expenses");
  return { success: "Le statut de la récurrence a été mis à jour." };
}
