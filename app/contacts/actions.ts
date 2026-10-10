"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { contactInputSchema, contactKindSchema } from "@/services/contacts";
import type { ContactKind } from "@/types/invoice";

export interface ContactActionState {
  error?: string;
  success?: string;
  contact?: {
    id: string;
    name: string;
    userId: string | null;
    companyId: string | null;
    kind: ContactKind;
  };
}

const uuidSchema = z.uuid();

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parsedContact(formData: FormData) {
  return contactInputSchema.safeParse({
    name: formValue(formData, "name"),
    email: formValue(formData, "email"),
    phone: formValue(formData, "phone"),
    address: formValue(formData, "address"),
    notes: formValue(formData, "notes"),
  });
}

async function getContactAccess(companyId: string | null, pathname: string) {
  const { supabase, user } = await getAuthenticatedSupabase(pathname);
  if (!companyId) return { supabase, user } as const;

  if (!uuidSchema.safeParse(companyId).success) {
    return { error: "Sélectionnez un espace d’entreprise valide." } as const;
  }
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Contact company membership check failed", { code: error.code });
    return { error: "Impossible de vérifier votre accès à cette entreprise." } as const;
  }
  if (!data) return { error: "Cette entreprise n’est pas associée à votre compte." } as const;
  return { supabase, user } as const;
}

function invalidateContactPaths(kind: ContactKind) {
  revalidatePath(`/${kind}`);
  if (kind === "customers") revalidatePath("/clients");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/due-dates");
}

export async function createContact(
  kindValue: ContactKind,
  companyId: string | null,
  formData: FormData,
): Promise<ContactActionState> {
  const kind = contactKindSchema.safeParse(kindValue);
  if (!kind.success) return { error: "Le type de tiers sélectionné est invalide." };
  const contact = parsedContact(formData);
  if (!contact.success) return { error: contact.error.issues[0]?.message ?? "Vérifiez les informations saisies." };

  const access = await getContactAccess(companyId, `/${kind.data}`);
  if ("error" in access) return access;
  const result = await access.supabase
    .from(kind.data)
    .insert({
      user_id: companyId ? null : access.user.id,
      company_id: companyId,
      ...contact.data,
    })
    .select("id, name, user_id, company_id")
    .maybeSingle();

  if (result.error) {
    console.error("Contact creation failed", { kind: kind.data, code: result.error.code });
    return { error: "La création a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "Le tiers n’a pas pu être créé." };

  invalidateContactPaths(kind.data);
  return {
    success: "Le tiers a été créé.",
    contact: {
      id: result.data.id,
      name: result.data.name,
      userId: result.data.user_id,
      companyId: result.data.company_id,
      kind: kind.data,
    },
  };
}

export async function updateContact(
  kindValue: ContactKind,
  companyId: string | null,
  contactId: string,
  formData: FormData,
): Promise<ContactActionState> {
  const kind = contactKindSchema.safeParse(kindValue);
  if (!kind.success || !uuidSchema.safeParse(contactId).success) {
    return { error: "Le tiers sélectionné n’est pas valide." };
  }
  const contact = parsedContact(formData);
  if (!contact.success) return { error: contact.error.issues[0]?.message ?? "Vérifiez les informations saisies." };

  const access = await getContactAccess(companyId, `/${kind.data}`);
  if ("error" in access) return access;
  const update = access.supabase
    .from(kind.data)
    .update(contact.data)
    .eq("id", contactId);
  const result = companyId
    ? await update.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await update.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();

  if (result.error) {
    console.error("Contact update failed", { kind: kind.data, code: result.error.code });
    return { error: "La modification a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "Le tiers est introuvable ou vous ne disposez pas des droits nécessaires." };

  invalidateContactPaths(kind.data);
  return { success: "Le tiers a été modifié." };
}

export async function deleteContact(
  kindValue: ContactKind,
  companyId: string | null,
  contactId: string,
): Promise<ContactActionState> {
  const kind = contactKindSchema.safeParse(kindValue);
  if (!kind.success || !uuidSchema.safeParse(contactId).success) {
    return { error: "Le tiers sélectionné n’est pas valide." };
  }
  const access = await getContactAccess(companyId, `/${kind.data}`);
  if ("error" in access) return access;

  const deletion = access.supabase.from(kind.data).delete().eq("id", contactId);
  const result = companyId
    ? await deletion.eq("company_id", companyId).is("user_id", null).select("id").maybeSingle()
    : await deletion.eq("user_id", access.user.id).is("company_id", null).select("id").maybeSingle();

  if (result.error) {
    console.error("Contact deletion failed", { kind: kind.data, code: result.error.code });
    return { error: "La suppression a échoué. Vérifiez vos droits et réessayez." };
  }
  if (!result.data) return { error: "Le tiers est introuvable ou vous ne disposez pas des droits nécessaires." };

  invalidateContactPaths(kind.data);
  return { success: "Le tiers a été supprimé. Les factures associées ont été conservées sans relation." };
}
