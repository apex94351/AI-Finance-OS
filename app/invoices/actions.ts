"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import {
  calculateInvoiceAmounts,
  getPersistedInvoiceStatus,
  manualInvoiceSchema,
} from "@/services/manual-invoice";

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

export async function saveInvoice(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
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

  let result;
  if (parsedInvoiceId) {
    const invoiceUpdate = access.supabase.from("invoices").update(invoiceData).eq("id", parsedInvoiceId.data);
    result = ownerCompanyId
      ? await invoiceUpdate.eq("company_id", ownerCompanyId).is("user_id", null).select("id").maybeSingle()
      : await invoiceUpdate.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
  } else {
    result = await access.supabase
      .from("invoices")
      .insert({ ...invoiceData, document_id: sourceDocument?.id ?? null, document_type: "invoice" })
      .select("id")
      .maybeSingle();
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
    if (error.code === "42703" || error.code === "PGRST204" || error.code === "23502" || error.code === "22P02") {
      return { error: "Le schéma Supabase des factures ou des documents n’est pas à jour. Vérifiez les migrations 004 à 008 puis 010 à 012 selon les champs manquants." };
    }
    return { error: "L’enregistrement de la facture a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La facture n’a pas été trouvée dans cette entreprise." };

  revalidatePath("/invoices");
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
  return { success: "La facture a été supprimée." };
}

export async function markInvoiceSettled(companyId: string | null, invoiceId: string): Promise<InvoiceActionState> {
  if ((companyId && !uuidSchema.safeParse(companyId).success) || !uuidSchema.safeParse(invoiceId).success) {
    return { error: "La facture sélectionnée n’est pas valide." };
  }

  const access = await getInvoiceAccess(companyId, "/due-dates");
  if ("error" in access) return access;

  const update = access.supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("id", invoiceId)
    .in("status", ["pending", "overdue", "receivable"]);
  const result = companyId
    ? await update.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await update.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();
  const { data, error } = result;

  if (error) {
    console.error("Invoice settlement failed", { code: error.code });
    return { error: "La mise à jour du statut a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!data) return { error: "La facture est introuvable ou vous ne disposez pas des droits nécessaires." };

  revalidatePath("/invoices");
  revalidatePath("/due-dates");
  revalidatePath("/dashboard");
  return { success: "Le statut de la facture a été mis à jour." };
}
