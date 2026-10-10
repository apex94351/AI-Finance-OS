import { z } from "zod";
import SettingsClient from "@/database/components/settings/settings-client";
import { getUserProfileSettings } from "@/lib/auth/user-profile";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import type { CompanyProfile } from "@/types/company";

const membershipListSchema = z.array(z.object({
  company_id: z.uuid(),
  role: z.string().min(1),
}));
const companyListSchema = z.array(z.object({
  id: z.uuid(),
  name: z.string(),
  trade_name: z.string().nullable(),
  legal_form: z.string().nullable(),
  siret: z.string().nullable(),
  siren: z.string().nullable(),
  vat_number: z.string().nullable(),
  industry: z.string().nullable(),
  country: z.string(),
  address: z.string().nullable(),
  address_complement: z.string().nullable(),
  postal_code: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  currency: z.string(),
  registration_number: z.string().nullable(),
}));

function getProfile(company: z.infer<typeof companyListSchema>[number]): CompanyProfile {
  return {
    id: company.id,
    legalName: company.name,
    tradeName: company.trade_name ?? "",
    legalForm: company.legal_form ?? "",
    siret: company.siret ?? "",
    siren: company.siren ?? "",
    vatNumber: company.vat_number ?? "",
    industry: company.industry ?? "",
    country: company.country,
    address: company.address ?? "",
    addressComplement: company.address_complement ?? "",
    postalCode: company.postal_code ?? "",
    city: company.city ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    currency: company.currency,
    registrationNumber: company.registration_number ?? "",
  };
}

export default async function SettingsPage() {
  const { supabase, user } = await getAuthenticatedSupabase("/settings");
  const { profile, preferences: savedPreferences } = getUserProfileSettings(user);
  const membershipsResult = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", user.id);

  if (membershipsResult.error) {
    console.error("Settings company membership query failed", { code: membershipsResult.error.code });
    return <SettingsClient companies={[]} companyLoadError="Impossible de charger les entreprises associées à votre compte." profile={profile} savedPreferences={savedPreferences} />;
  }

  const memberships = membershipListSchema.safeParse(membershipsResult.data);
  if (!memberships.success) {
    console.error("Settings company membership query returned an unexpected result");
    return <SettingsClient companies={[]} companyLoadError="La liste des entreprises reçue est invalide." profile={profile} savedPreferences={savedPreferences} />;
  }

  const companyIds = memberships.data.map(({ company_id }) => company_id);
  const editableCompanyIds = memberships.data
    .filter(({ role }) => role === "owner")
    .map(({ company_id }) => company_id);
  if (companyIds.length === 0) {
    return <SettingsClient companies={[]} editableCompanyIds={[]} companyLoadError={null} profile={profile} savedPreferences={savedPreferences} />;
  }

  const companiesResult = await supabase
    .from("companies")
    .select("id, name, trade_name, legal_form, siret, siren, vat_number, industry, country, address, address_complement, postal_code, city, phone, email, currency, registration_number")
    .in("id", companyIds);

  if (companiesResult.error) {
    console.error("Settings company profile query failed", { code: companiesResult.error.code });
    const migrationMissing = companiesResult.error.code === "42703" || companiesResult.error.code === "PGRST204";
    const message = migrationMissing
      ? "Le schéma Supabase doit être complété par la migration locale 003 avant de charger les informations d’entreprise."
      : "Impossible de charger les informations des entreprises associées à votre compte.";
    return <SettingsClient companies={[]} editableCompanyIds={[]} companyLoadError={message} profile={profile} savedPreferences={savedPreferences} />;
  }

  const parsedCompanies = companyListSchema.safeParse(companiesResult.data);
  if (!parsedCompanies.success) {
    console.error("Settings company profile query returned an unexpected result");
    return <SettingsClient companies={[]} editableCompanyIds={[]} companyLoadError="Les informations d’entreprise reçues sont invalides." profile={profile} savedPreferences={savedPreferences} />;
  }

  return <SettingsClient companies={parsedCompanies.data.map(getProfile)} editableCompanyIds={editableCompanyIds} companyLoadError={null} profile={profile} savedPreferences={savedPreferences} />;
}
