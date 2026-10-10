import { z } from "zod";

export const companyNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Saisissez le nom de votre entreprise." })
  .max(160, { error: "Le nom de l’entreprise ne peut pas dépasser 160 caractères." });
