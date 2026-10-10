import { z } from "zod";

export const emailSchema = z.string().trim().pipe(
  z.email({ error: "Saisissez une adresse e-mail valide." }),
);
export const passwordSchema = z.string().min(8, {
  error: "Le mot de passe doit contenir au moins 8 caractères.",
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Saisissez votre mot de passe." }),
});

export const registrationSchema = z.object({
  firstName: z.string().trim().min(1, { error: "Saisissez votre prénom." }),
  lastName: z.string().trim().min(1, { error: "Saisissez votre nom." }),
  email: emailSchema,
  password: passwordSchema,
  passwordConfirmation: z.string(),
  acceptedTerms: z.boolean().refine(Boolean, { error: "Vous devez accepter les conditions d’utilisation." }),
}).superRefine((values, context) => {
  if (values.password !== values.passwordConfirmation) {
    context.addIssue({
      code: "custom",
      path: ["passwordConfirmation"],
      message: "Les mots de passe ne correspondent pas.",
    });
  }
});

export const passwordResetSchema = z.object({
  password: passwordSchema,
  passwordConfirmation: z.string(),
}).superRefine((values, context) => {
  if (values.password !== values.passwordConfirmation) {
    context.addIssue({
      code: "custom",
      path: ["passwordConfirmation"],
      message: "Les mots de passe ne correspondent pas.",
    });
  }
});

export type RegistrationInput = z.infer<typeof registrationSchema>;