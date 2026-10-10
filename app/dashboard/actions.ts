"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedSupabase } from "@/lib/supabase/server";
import { companyNameSchema } from "@/lib/companies/validation";

const createdCompanySchema = z.array(z.object({
  company_id: z.uuid(),
  company_name: z.string(),
})).length(1);

export type CreateCompanyState = {
  error?: string;
  createdCompanyName?: string;
};

export async function createCompany(
  _previousState: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const parsedName = companyNameSchema.safeParse(formData.get("name"));
  if (!parsedName.success) {
    return { error: parsedName.error.issues[0]?.message ?? "Vérifiez le nom saisi." };
  }

  const { supabase } = await getAuthenticatedSupabase("/dashboard");
  const { data, error } = await supabase.rpc("create_company_for_current_user", {
    p_name: parsedName.data,
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return {
        error: "La création d’entreprise n’est pas encore configurée. Appliquez la migration Supabase prévue pour cette fonctionnalité.",
      };
    }

    console.error("Company creation RPC failed", { code: error.code });
    return { error: "La création de l’entreprise a échoué. Réessayez ou contactez le support." };
  }

  const createdCompany = createdCompanySchema.safeParse(data);
  if (!createdCompany.success) {
    console.error("Company creation RPC returned an unexpected result");
    return { error: "La réponse de Supabase est invalide. Vérifiez si l’entreprise apparaît avant de réessayer." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { createdCompanyName: createdCompany.data[0].company_name };
}
