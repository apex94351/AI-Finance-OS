"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  calculateInvoiceAmounts,
  getPersistedInvoiceStatus,
  manualInvoiceSchema,
} from "@/services/manual-invoice";
import type { InvoicePaymentStatus } from "@/types/invoice";

export type InvoiceActionState = {
  error?: string;
  success?: string;
};

const uuidSchema = z.uuid();

function getOptionalFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getInvoiceAccess(companyId: string | null, pathname: string) {
  const { supabase, user } = await getAuthenticatedSupabase(pathname);
  if (!companyId) return { supabase, user } as const;

  const { data: membership, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Invoice company membership check failed", { code: error.code });
    return { error: "Impossible de vérifier votre accès à cette entreprise." } as const;
  }
  if (!membership) {
    return { error: "Cette entreprise n’est pas associée à votre compte." } as const;
  }

  return { supabase, user } as const;
}

function getInvoiceValues(formData: FormData) {
  const parsed = manualInvoiceSchema.safeParse({
    invoiceNumber: getOptionalFormValue(formData, "invoiceNumber"),
    clientName: getOptionalFormValue(formData, "clientName"),
    invoiceType: getOptionalFormValue(formData, "invoiceType"),
    description: getOptionalFormValue(formData, "description"),
    subtotal: getOptionalFormValue(formData, "subtotal"),
    vatRate: getOptionalFormValue(formData, "vatRate"),
    issueDate: getOptionalFormValue(formData, "issueDate"),
    dueDate: getOptionalFormValue(formData, "dueDate"),
    status: getOptionalFormValue(formData, "status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Vérifiez les informations de la facture." } as const;
  }

  const amounts = calculateInvoiceAmounts(parsed.data.subtotal, parsed.data.vatRate);
  if (!amounts) {
    return { error: "Le montant ou le taux de TVA est hors des limites autorisées." } as const;
  }
  const status = getPersistedInvoiceStatus(parsed.data.status, parsed.data.dueDate);
  if (!status) {
    return { error: "Une facture ne peut être marquée en retard qu’après sa date d’échéance." } as const;
  }

  return { invoice: parsed.data, amounts, status } as const;
}

async function getCounterparty(
  access: { supabase: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"]; user: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["user"] },
  companyId: string | null,
  customerId: string,
  supplierId: string,
) {
  if (customerId && supplierId) return { error: "Associez une facture à un seul tiers." } as const;
  const table = customerId ? "customers" : supplierId ? "suppliers" : null;
  const id = customerId || supplierId;
  if (!table || !id) return { counterparty: null } as const;
  if (!uuidSchema.safeParse(id).success) return { error: "Le tiers sélectionné n’est pas valide." } as const;

  const query = access.supabase.from(table).select("id, name").eq("id", id);
  const result = companyId
    ? await query.eq("company_id", companyId).is("user_id", null).maybeSingle()
    : await query.eq("user_id", access.user.id).is("company_id", null).maybeSingle();
  if (result.error) {
    console.error("Invoice counterparty check failed", { table, code: result.error.code });
    return { error: "Impossible de vérifier le tiers sélectionné." } as const;
  }
  if (!result.data) return { error: "Ce tiers n’est pas accessible dans l’espace sélectionné." } as const;
  return {
    counterparty: {
      customerId: customerId || null,
      supplierId: supplierId || null,
      name: result.data.name,
    },
  } as const;
}

async function saveInvoiceDirectionOnly(formData: FormData): Promise<InvoiceActionState> {
  const companyIdValue = getOptionalFormValue(formData, "companyId");
  const invoiceId = getOptionalFormValue(formData, "invoiceId");
  const direction = z.enum(["customer", "supplier"]).safeParse(getOptionalFormValue(formData, "invoiceType"));
  const parsedCompanyId = companyIdValue ? uuidSchema.safeParse(companyIdValue) : null;
  if ((parsedCompanyId && !parsedCompanyId.success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture ou l’espace sélectionné n’est pas valide." };
  }
  if (!direction.success) return { error: "Choisissez explicitement une facture client ou fournisseur." };

  const companyId = companyIdValue || null;
  const customerId = getOptionalFormValue(formData, "customerId");
  const supplierId = getOptionalFormValue(formData, "supplierId");
  if (customerId && supplierId) return { error: "Associez une facture à un seul tiers." };
  if ((direction.data === "customer" && supplierId) || (direction.data === "supplier" && customerId)) {
    return { error: "Le sens sélectionné doit correspondre au tiers associé." };
  }

  const access = await getInvoiceAccess(companyId, "/invoices");
  if ("error" in access) return access;

  const currentQuery = access.supabase.from("invoices").select("customer_id, supplier_id").eq("id", invoiceId);
  const scopedCurrentQuery = companyId
    ? currentQuery.eq("company_id", companyId).is("user_id", null)
    : currentQuery.eq("user_id", access.user.id).is("company_id", null);
  const current = await scopedCurrentQuery.maybeSingle();
  if (current.error) {
    console.error("Invoice direction lookup failed", { code: current.error.code });
    return { error: "Impossible de vérifier les tiers déjà associés à cette facture." };
  }
  if (!current.data) return { error: "La facture est introuvable ou vous ne disposez pas des droits nécessaires." };

  const counterparty = await getCounterparty(access, companyId, customerId, supplierId);
  if ("error" in counterparty) return counterparty;
  const customerLink = counterparty.counterparty?.customerId ?? current.data.customer_id ?? null;
  const supplierLink = counterparty.counterparty?.supplierId ?? current.data.supplier_id ?? null;
  if ((direction.data === "customer" && supplierLink) || (direction.data === "supplier" && customerLink)) {
    return { error: "Le sens sélectionné ne correspond pas au tiers actuellement lié. Associez un tiers du type choisi." };
  }

  const payload: Record<string, unknown> = {
    invoice_type: direction.data,
    customer_id: customerLink,
    supplier_id: supplierLink,
  };
  const persistDirection = async (values: Record<string, unknown>) => {
    const update = access.supabase.from("invoices").update(values).eq("id", invoiceId);
    const scoped = companyId
      ? update.eq("company_id", companyId).is("user_id", null)
      : update.eq("user_id", access.user.id).is("company_id", null);
    return scoped.select("id").maybeSingle();
  };

  let usedExplicitType = true;
  let result = await persistDirection(payload);
  const missingInvoiceTypeColumn = ["42703", "PGRST204"].includes(result.error?.code ?? "")
    && `${result.error?.message ?? ""} ${result.error?.details ?? ""}`.toLowerCase().includes("invoice_type");
  if (missingInvoiceTypeColumn) {
    if (!customerLink && !supplierLink) {
      return { error: "Le schéma distant ne contient pas invoice_type. Associez un client/fournisseur vérifié ou appliquez manuellement la migration 017 pour qualifier cette facture libre." };
    }
    usedExplicitType = false;
    result = await persistDirection({ customer_id: customerLink, supplier_id: supplierLink });
  }

  if (result.error) {
    console.error("Invoice direction save failed", { code: result.error.code });
    if (result.error.code === "42501") return { error: "Vous ne disposez pas des droits nécessaires pour qualifier cette facture." };
    if (result.error.code === "23514") return { error: "Le sens choisi est incompatible avec les relations ou paiements existants." };
    if (["42703", "PGRST204"].includes(result.error.code ?? "")) {
      return { error: "Le schéma distant ne permet pas d’enregistrer ce sens. Vérifiez les migrations 008 et 017 selon les champs manquants." };
    }
    return { error: "Le sens financier n’a pas été enregistré. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "La facture est introuvable ou vous ne disposez pas des droits nécessaires." };

  for (const path of ["/invoices", "/due-dates", "/dashboard", "/ai-cfo", "/clients", "/suppliers"]) {
    revalidatePath(path);
  }
  return {
    success: usedExplicitType
      ? "Le sens financier a été enregistré sans modifier le montant ni la devise."
      : "Le sens financier est confirmé par le tiers associé; le montant et la devise n’ont pas été modifiés.",
  };
}

export async function saveInvoice(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  if (getOptionalFormValue(formData, "saveMode") === "direction_only") {
    return saveInvoiceDirectionOnly(formData);
  }

  const companyId = getOptionalFormValue(formData, "companyId");
  if (companyId && !uuidSchema.safeParse(companyId).success) {
    return { error: "Sélectionnez une entreprise valide." };
  }
  const ownerCompanyId = companyId || null;

  const values = getInvoiceValues(formData);
  if ("error" in values) return values;

  const invoiceId = getOptionalFormValue(formData, "invoiceId");
  const parsedInvoiceId = invoiceId ? uuidSchema.safeParse(invoiceId) : null;
  if (parsedInvoiceId && !parsedInvoiceId.success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }

  const access = await getInvoiceAccess(ownerCompanyId, "/invoices");
  if ("error" in access) return access;

  const customerId = getOptionalFormValue(formData, "customerId");
  const supplierId = getOptionalFormValue(formData, "supplierId");
  if ((values.invoice.invoiceType === "customer" && supplierId)
    || (values.invoice.invoiceType === "supplier" && customerId)) {
    return { error: "Le type de facture doit correspondre au tiers associé." };
  }
  const counterparty = await getCounterparty(access, ownerCompanyId, customerId, supplierId);
  if ("error" in counterparty) return counterparty;

  const sourceDocumentId = getOptionalFormValue(formData, "documentId");
  let sourceDocument: { id: string; category: string } | null = null;
  if (sourceDocumentId) {
    if (!uuidSchema.safeParse(sourceDocumentId).success || !ownerCompanyId) {
      return { error: "Un document source valide appartenant à une entreprise est requis." };
    }
    const documentResult = await access.supabase.from("documents")
      .select("id, company_id, category, deleted_at")
      .eq("id", sourceDocumentId)
      .eq("company_id", ownerCompanyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (documentResult.error) {
      console.error("Invoice source document check failed", { code: documentResult.error.code });
      return { error: "Impossible de vérifier le document source. Vérifiez que le registre Documents est installé et réessayez." };
    }
    if (!documentResult.data) {
      return { error: "Le document source est introuvable, archivé ou inaccessible dans cette entreprise." };
    }
    if (documentResult.data.category !== "customer_invoice" && documentResult.data.category !== "supplier_invoice") {
      return { error: "Seuls les documents classés comme facture peuvent être liés à une facture." };
    }
    if ((documentResult.data.category === "customer_invoice" && (!customerId || supplierId))
      || (documentResult.data.category === "supplier_invoice" && (!supplierId || customerId))) {
      return { error: "Associez un client ou un fournisseur correspondant à la catégorie du document." };
    }

    const duplicateQuery = access.supabase.from("invoices")
      .select("id")
      .eq("document_id", sourceDocumentId);
    if (parsedInvoiceId) duplicateQuery.neq("id", parsedInvoiceId.data);
    const duplicate = await duplicateQuery.maybeSingle();
    if (duplicate.error) {
      console.error("Invoice source duplicate check failed", { code: duplicate.error.code });
      return { error: "Impossible de vérifier si une facture existe déjà pour ce document. Aucune facture n’a été enregistrée." };
    }
    if (duplicate.data) {
      return { error: "Une facture est déjà liée à ce document. Ouvrez-la depuis le registre des factures pour la modifier." };
    }
    sourceDocument = { id: sourceDocumentId, category: documentResult.data.category };
  }

  let currency = getOptionalFormValue(formData, "currency").trim().toUpperCase();
  if (ownerCompanyId) {
    const { data: company, error: companyError } = await access.supabase
      .from("companies")
      .select("currency")
      .eq("id", ownerCompanyId)
      .maybeSingle();
    if (companyError) {
      console.error("Invoice company currency query failed", { code: companyError.code });
      return { error: "Impossible de charger la devise de l’entreprise." };
    }
    if (!company) return { error: "Cette entreprise n’est pas accessible avec votre compte." };
    currency = company.currency;
  }
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Sélectionnez une devise valide." };

  const invoiceData = {
    company_id: ownerCompanyId,
    user_id: ownerCompanyId ? null : access.user.id,
    invoice_type: values.invoice.invoiceType,
    invoice_number: values.invoice.invoiceNumber,
    client_name: counterparty.counterparty?.name ?? values.invoice.clientName,
    description: values.invoice.description,
    issue_date: values.invoice.issueDate,
    due_date: values.invoice.dueDate,
    subtotal_ht: values.amounts.subtotal,
    vat_rate: values.amounts.vatRate,
    vat_amount: values.amounts.vatAmount,
    total_ttc: values.amounts.total,
    currency,
    status: values.status,
  };
  if (counterparty.counterparty) {
    Object.assign(invoiceData, {
      customer_id: counterparty.counterparty.customerId,
      supplier_id: counterparty.counterparty.supplierId,
    });
  } else if (getOptionalFormValue(formData, "counterpartyUpdate") === "true") {
    Object.assign(invoiceData, { customer_id: null, supplier_id: null });
  }

  const persistInvoice = async (payload: Record<string, unknown>) => {
    if (parsedInvoiceId) {
      const invoiceUpdate = access.supabase.from("invoices").update(payload).eq("id", parsedInvoiceId.data);
      return ownerCompanyId
        ? await invoiceUpdate.eq("company_id", ownerCompanyId).is("user_id", null).select("id").maybeSingle()
        : await invoiceUpdate.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
    }
    return access.supabase.from("invoices")
      .insert({ ...payload, document_id: sourceDocument?.id ?? null, document_type: "invoice" })
      .select("id")
      .maybeSingle();
  };
  let result = await persistInvoice(invoiceData);
  const missingInvoiceTypeColumn = ["42703", "PGRST204"].includes(result.error?.code ?? "")
    && `${result.error?.message ?? ""} ${result.error?.details ?? ""}`.toLowerCase().includes("invoice_type");
  if (missingInvoiceTypeColumn) {
    if (!counterparty.counterparty && !sourceDocument) {
      return { error: "Le schéma distant ne peut pas enregistrer le sens de cette facture libre. Appliquez la migration 017 ou associez explicitement un client/fournisseur appartenant au même espace." };
    }
    const legacyPayload = Object.fromEntries(Object.entries(invoiceData).filter(([column]) => column !== "invoice_type"));
    result = await persistInvoice(legacyPayload);
  }
  const { data, error } = result;

  if (error) {
    console.error("Invoice save failed", { code: error.code });
    if (error.code === "23505") {
      return { error: "Une facture est déjà liée à ce document ou porte déjà une valeur unique. Vérifiez le registre avant de réessayer." };
    }
    if (error.code === "23503") {
      return { error: "Le document source ou le tiers associé n’existe plus ou n’appartient pas à cette entreprise." };
    }
    if (error.code === "23514") {
      return { error: "Le type de facture ou son montant est incompatible avec les paiements ou relations déjà enregistrés." };
    }
    if (error.code === "42703" || error.code === "PGRST204" || error.code === "23502" || error.code === "22P02") {
      return { error: "Le schéma Supabase des factures ou des documents n’est pas à jour. Vérifiez les migrations 004 à 008, 010 à 012 et 017 selon les champs manquants." };
    }
    return { error: "L’enregistrement de la facture a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La facture n’a pas été trouvée dans cette entreprise." };

  revalidatePath("/invoices");
  revalidatePath("/due-dates");
  revalidatePath("/dashboard");
  if (sourceDocument) revalidatePath("/documents");
  return { success: "La facture a été enregistrée." };
}

export async function deleteInvoice(companyId: string | null, invoiceId: string): Promise<InvoiceActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }

  const access = await getInvoiceAccess(companyId, "/invoices");
  if ("error" in access) return access;

  const deletion = access.supabase.from("invoices").delete().eq("id", invoiceId);
  const result = companyId
    ? await deletion.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await deletion.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
  const { data, error } = result;

  if (error) {
    console.error("Invoice delete failed", { code: error.code });
    return { error: "La suppression a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La facture n’a pas été trouvée dans cette entreprise." };

  revalidatePath("/invoices");
  revalidatePath("/due-dates");
  revalidatePath("/dashboard");
  return { success: "La facture a été supprimée." };
}

export async function updateInvoicePaymentStatus(
  companyId: string | null,
  invoiceId: string,
  targetStatus: InvoicePaymentStatus,
): Promise<InvoiceActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }
  if (targetStatus === "paid") {
    return { error: "Le statut Payée exige un paiement daté. Utilisez le formulaire de paiement de la facture." };
  }

  const access = await getInvoiceAccess(companyId, "/invoices");
  if ("error" in access) return access;

  const currentQuery = access.supabase.from("invoices")
    .select("status, due_date")
    .eq("id", invoiceId);
  const scopedCurrentQuery = companyId
    ? currentQuery.eq("company_id", companyId).is("user_id", null)
    : currentQuery.eq("user_id", access.user.id).is("company_id", null);
  const currentResult = await scopedCurrentQuery.maybeSingle();
  if (currentResult.error) {
    console.error("Invoice status lookup failed", { code: currentResult.error.code });
    return { error: "Impossible de vérifier le statut actuel de cette facture." };
  }
  if (!currentResult.data) return { error: "La facture est introuvable ou vous ne disposez pas des droits nécessaires." };

  const currentStatus = currentResult.data.status as string;
  const editableStatuses = ["pending", "overdue", "receivable", "paid"];
  if (!editableStatuses.includes(currentStatus)) {
    return { error: "Cette facture ne peut pas changer de statut de paiement." };
  }

  const newStatus = getPersistedInvoiceStatus(targetStatus, currentResult.data.due_date);
  if (!newStatus) {
    return { error: "Une facture ne peut être marquée en retard qu’avec une date d’échéance valide déjà passée." };
  }
  if (newStatus === currentStatus) {
    return { success: "Le statut de la facture a été mis à jour." };
  }
  const update = access.supabase
    .from("invoices")
    .update({ status: newStatus })
    .eq("id", invoiceId)
    .eq("status", currentStatus);
  const scopedUpdate = companyId
    ? update.eq("company_id", companyId).is("user_id", null)
    : update.eq("user_id", access.user.id).is("company_id", null);
  const result = await scopedUpdate.select("id").maybeSingle();
  const { data, error } = result;

  if (error) {
    console.error("Invoice status update failed", { code: error.code });
    return { error: "La mise à jour du statut a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La facture est introuvable ou vous ne disposez pas des droits nécessaires." };

  revalidatePath("/invoices");
  revalidatePath("/due-dates");
  revalidatePath("/dashboard");
  return { success: "Le statut de la facture a été mis à jour." };
}

export async function recordInvoicePayment(
  companyId: string | null,
  invoiceId: string,
  paymentDate: string,
  amount: string,
  reference: string,
  note: string,
): Promise<InvoiceActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }
  const parsedDate = z.iso.date().safeParse(paymentDate);
  const parsedAmount = z.string().trim().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/).safeParse(amount);
  const parsedReference = z.string().trim().max(160).safeParse(reference);
  const parsedNote = z.string().trim().max(2000).safeParse(note);
  if (!parsedDate.success || !parsedAmount.success || Number(parsedAmount.data.replace(",", ".")) <= 0
    || !parsedReference.success || !parsedNote.success) {
    return { error: "Saisissez une date, un montant et une référence valides." };
  }

  const access = await getInvoiceAccess(companyId, "/invoices");
  if ("error" in access) return access;
  const { error } = await access.supabase.rpc("record_invoice_payment", {
    target_invoice_id: invoiceId,
    target_payment_date: parsedDate.data,
    target_amount: Number(parsedAmount.data.replace(",", ".")),
    target_reference: parsedReference.data || null,
    target_note: parsedNote.data || null,
  });
  if (error) {
    console.error("Invoice payment recording failed", { code: error.code });
    if (error.code === "P0002") return { error: "La facture client est réglée, annulée, en brouillon ou inaccessible." };
    if (error.code === "22003") return { error: "Le paiement dépasse le solde restant de la facture." };
    if (error.code === "22007") return { error: "La date de paiement ne peut pas être future." };
    if (error.code === "22023") return { error: "Le montant ou les informations du paiement sont invalides." };
    if (["42883", "PGRST202"].includes(error.code ?? "")) {
      return { error: "Les paiements clients ne sont pas activés. Appliquez manuellement la migration 017_invoice_directions_and_customer_payments.sql." };
    }
    if (error.code === "42501") return { error: "Vous ne disposez pas des droits nécessaires pour enregistrer ce paiement." };
    return { error: "Le paiement n’a pas pu être enregistré. Vérifiez vos droits et réessayez." };
  }

  revalidatePath("/invoices");
  revalidatePath("/due-dates");
  revalidatePath("/dashboard");
  return { success: "Le paiement client a été enregistré." };
}

export async function recordSupplierInvoicePayment(
  companyId: string | null,
  invoiceId: string,
  paymentDate: string,
  amount: string,
  requestId: string,
): Promise<InvoiceActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }
  const parsedDate = z.iso.date().safeParse(paymentDate);
  const parsedAmount = z.string().trim().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/).safeParse(amount);
  const parsedRequestId = uuidSchema.safeParse(requestId);
  if (!parsedDate.success || !parsedAmount.success || Number(parsedAmount.data.replace(",", ".")) <= 0
    || !parsedRequestId.success) {
    return { error: "Saisissez une date de paiement et un montant valides." };
  }

  const access = await getInvoiceAccess(companyId, "/invoices");
  if ("error" in access) return access;
  const { error } = await access.supabase.rpc("record_supplier_invoice_payment_idempotent", {
    target_invoice_id: invoiceId,
    target_payment_date: parsedDate.data,
    target_amount: Number(parsedAmount.data.replace(",", ".")),
    target_request_id: parsedRequestId.data,
  });
  if (error) {
    console.error("Supplier invoice payment recording failed", { code: error.code });
    if (error.code === "P0002") return { error: "La facture fournisseur est réglée, annulée, en brouillon ou inaccessible." };
    if (error.code === "22003") return { error: "Le paiement dépasse le solde restant de la facture." };
    if (error.code === "22007") return { error: "La date de paiement ne peut pas être future." };
    if (error.code === "22023") return { error: "Le montant du paiement est invalide." };
    if (error.code === "23514") return { error: "Associez un fournisseur vérifié et vérifiez que la dépense liée correspond à la facture." };
    if (error.code === "42501") return { error: "Vous ne disposez pas des droits nécessaires pour payer cette facture fournisseur." };
    if (["42883", "PGRST202"].includes(error.code ?? "")) {
      return { error: "Le paiement fournisseur nécessite l’application manuelle des migrations 018_record_supplier_invoice_payment.sql puis 019_treasury_opening_balance_and_supplier_payment_idempotency.sql sur Supabase. Aucune modification n’a été effectuée. Si elles sont déjà appliquées, actualisez le cache du schéma API Supabase." };
    }
    return { error: "Le paiement fournisseur n’a pas été enregistré. Vérifiez vos droits et réessayez." };
  }

  for (const path of ["/invoices", "/expenses", "/due-dates", "/dashboard", "/ai-cfo", "/suppliers"]) {
    revalidatePath(path);
  }
  return { success: "Le paiement fournisseur daté a été enregistré." };
}

export async function markInvoiceSettled(companyId: string | null, invoiceId: string): Promise<InvoiceActionState> {
  return updateInvoicePaymentStatus(companyId, invoiceId, "paid");
}
