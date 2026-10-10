"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";

export type SaveCompanyProfileState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
};

export type SaveSettingsState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
  profile?: { firstName: string; lastName: string; phone: string; country: string; locale: "fr" | "en" | "es" | "pt" | "it" | "de" | "zh" };
  preferences?: { locale: "fr" | "en" | "es" | "pt" | "it" | "de" | "zh"; theme: "light" | "dark" | "system" };
};

const userProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Saisissez votre prénom.").max(80),
  lastName: z.string().trim().min(1, "Saisissez votre nom.").max(80),
  phone: z.string().trim().max(40, "Le téléphone ne peut pas dépasser 40 caractères."),
  country: z.string().trim().max(100, "Le pays ne peut pas dépasser 100 caractères."),
  locale: z.enum(["fr", "en", "es", "pt", "it", "de", "zh"]),
});

const userPreferencesSchema = z.object({
  locale: z.enum(["fr", "en", "es", "pt", "it", "de", "zh"]),
  theme: z.enum(["light", "dark", "system"]),
});
const themeSchema = z.enum(["light", "dark", "system"]);

const optionalText = (maximum: number) => z.string().trim().max(maximum).transform((value) => value || null);
const optionalIdentifier = (maximum: number) => optionalText(maximum);
const optionalEmail = z.string().trim().max(254).refine(
  (value) => value === "" || z.email().safeParse(value).success,
  "Saisissez une adresse e-mail valide.",
).transform((value) => value || null);

const companyProfileSchema = z.object({
  companyId: z.uuid(),
  legalName: z.string().trim().min(1).max(160),
  tradeName: optionalText(160),
  legalForm: optionalText(80),
  siret: optionalIdentifier(32),
  siren: optionalIdentifier(32),
  vatNumber: optionalText(32),
  industry: optionalText(120),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Saisissez le code pays ISO à 2 lettres."),
  address: optionalText(200),
  addressComplement: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(120),
  phone: optionalText(40),
  email: optionalEmail,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Saisissez le code devise ISO à 3 lettres."),
  registrationNumber: optionalText(80),
}).superRefine((profile, context) => {
  if (profile.country !== "FR") return;
  for (const [field, value, length, label] of [
    ["siret", profile.siret, 14, "SIRET"],
    ["siren", profile.siren, 9, "SIREN"],
  ] as const) {
    if (value && !new RegExp(`^\\d{${length}}$`).test(value)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `Pour une entreprise française, saisissez ${length} chiffres pour le ${label}.`,
      });
    }
  }
});

function fieldErrors(issues: readonly z.ZodIssue[]): Record<string, string> {
  return Object.fromEntries(issues.flatMap((issue) => {
    const field = issue.path[0];
    return typeof field === "string" ? [[field, issue.message]] : [];
  }));
}

export async function saveCompanyProfile(
  _previousState: SaveCompanyProfileState,
  formData: FormData,
): Promise<SaveCompanyProfileState> {
  const parsed = companyProfileSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return {
      error: "Certains champs doivent être corrigés.",
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }

  const { supabase, user } = await getAuthenticatedSupabase("/settings");
  const { data: membership, error: membershipError } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("Company membership check failed", { code: membershipError.code });
    return { error: "Impossible de vérifier votre accès à cette entreprise." };
  }
  if (!membership) {
    return { error: "Cette entreprise n’est pas associée à votre compte." };
  }
  if (membership.role !== "owner") {
    return { error: "Seul le propriétaire de l’entreprise peut modifier ses informations." };
  }

  const { data, error } = await supabase
    .from("companies")
    .update({
      name: parsed.data.legalName,
      trade_name: parsed.data.tradeName,
      legal_form: parsed.data.legalForm,
      siret: parsed.data.siret,
      siren: parsed.data.siren,
      vat_number: parsed.data.vatNumber,
      industry: parsed.data.industry,
      country: parsed.data.country,
      address: parsed.data.address,
      address_complement: parsed.data.addressComplement,
      postal_code: parsed.data.postalCode,
      city: parsed.data.city,
      phone: parsed.data.phone,
      email: parsed.data.email,
      currency: parsed.data.currency,
      registration_number: parsed.data.registrationNumber,
    })
    .eq("id", parsed.data.companyId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Company profile update failed", { code: error.code });
    if (error.code === "42703" || error.code === "PGRST204") {
      return { error: "Le schéma Supabase ne contient pas encore les champs du profil d’entreprise. La migration 003 doit être appliquée par un administrateur." };
    }
    return { error: "L’enregistrement a échoué. Vérifiez vos droits sur cette entreprise et réessayez." };
  }
  if (!data) {
    return { error: "Aucune entreprise n’a été mise à jour. Vérifiez vos droits sur cette entreprise." };
  }

  revalidatePath("/settings");
  return { success: "Les informations de l’entreprise ont été enregistrées." };
}

export async function saveUserProfile(
  _previousState: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  const parsed = userProfileSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return {
      error: "Certains champs doivent être corrigés.",
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }

  const { supabase, user } = await getAuthenticatedSupabase("/settings");
  const firstName = parsed.data.firstName;
  const lastName = parsed.data.lastName;
  const storedPreferences = metadataObject(user.user_metadata.ai_finance_preferences);
  const storedTheme = themeSchema.safeParse(storedPreferences.theme);
  const theme = storedTheme.success ? storedTheme.data : "light";
  const { error } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      phone: parsed.data.phone,
      country_of_residence: parsed.data.country,
      ai_finance_preferences: { ...storedPreferences, locale: parsed.data.locale },
    },
  });
  if (error) {
    console.error("User profile update failed", { code: error.name });
    return { error: "Le profil n’a pas pu être enregistré. Vérifiez la connexion et réessayez." };
  }
  revalidatePath("/settings");
  return {
    success: "Votre profil a été enregistré.",
    profile: {
      firstName,
      lastName,
      phone: parsed.data.phone,
      country: parsed.data.country,
      locale: parsed.data.locale,
    },
    preferences: { locale: parsed.data.locale, theme },
  };
}

export async function saveUserPreferences(
  locale: string,
  theme: string,
): Promise<SaveSettingsState> {
  const parsed = userPreferencesSchema.safeParse({ locale, theme });
  if (!parsed.success) return { error: "La langue ou le thème sélectionné n’est pas valide." };

  const { supabase, user } = await getAuthenticatedSupabase("/settings");
  const preferences = preferencesValue(user.user_metadata.ai_finance_preferences);
  const { error } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      ai_finance_preferences: { ...preferences, ...parsed.data },
    },
  });
  if (error) {
    console.error("User preferences update failed", { code: error.name });
    return { error: "La préférence reste appliquée sur cet appareil, mais n’a pas pu être enregistrée sur votre compte." };
  }
  revalidatePath("/settings");
  return { success: "Préférence enregistrée sur votre compte." };
}

function preferencesValue(value: unknown): { locale: "fr" | "en" | "es" | "pt" | "it" | "de" | "zh"; theme: "light" | "dark" | "system" } {
  const parsed = userPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : { locale: "fr", theme: "light" };
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
