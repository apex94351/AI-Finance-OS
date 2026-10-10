"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthPasswordField, AuthTextField } from "@/database/components/auth/auth-fields";
import { Button } from "@/database/components/ui/button";
import { registerWithPassword } from "@/lib/auth/register";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { registrationSchema } from "@/lib/auth/validation";

export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    setErrorMessage("");
    setSuccessMessage("");

    const formData = new FormData(event.currentTarget);
    const parsed = registrationSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      email: formData.get("email"),
      password: formData.get("password"),
      passwordConfirmation: formData.get("passwordConfirmation"),
      acceptedTerms: formData.get("acceptedTerms") === "on",
    });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Vérifiez les champs saisis.");
      return;
    }

    isSubmitting.current = true;
    setIsPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", "/dashboard");
      const result = await registerWithPassword(
        (request) => supabase.auth.signUp(request),
        parsed.data,
        callbackUrl.toString(),
      );

      if ("error" in result) {
        setErrorMessage(result.error);
      } else if (result.confirmationRequired) {
        setConfirmationRequired(true);
        setSuccessMessage("Votre compte est créé. Consultez votre boîte mail pour confirmer votre adresse avant de vous connecter.");
        formRef.current?.reset();
      } else {
        setSuccessMessage("Votre compte est créé. Ouverture de votre espace…");
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (error) {
      if (error instanceof SupabaseConfigurationError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Impossible de joindre Supabase. Vérifiez votre connexion réseau et réessayez.");
      }
    } finally {
      isSubmitting.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} ref={formRef}>
      <div className="auth-name-grid">
        <AuthTextField autoComplete="given-name" id="firstName" label="Prénom" maxLength={80} name="firstName" required />
        <AuthTextField autoComplete="family-name" id="lastName" label="Nom" maxLength={80} name="lastName" required />
      </div>
      <AuthTextField autoComplete="email" id="registerEmail" label="Adresse e-mail" name="email" required type="email" />
      <AuthPasswordField autoComplete="new-password" id="registerPassword" label="Mot de passe (8 caractères minimum)" maxLength={128} minLength={8} name="password" required />
      <AuthPasswordField autoComplete="new-password" id="passwordConfirmation" label="Confirmer le mot de passe" maxLength={128} minLength={8} name="passwordConfirmation" required />
      <p className="auth-legal-note">Les conditions d’utilisation ne sont pas encore publiées. Consultez <Link className="auth-terms-link" href="/terms">la page des conditions</Link> avant de poursuivre.</p>
      <div className="auth-checkbox-row">
        <input id="acceptedTerms" name="acceptedTerms" required type="checkbox" />
        <label htmlFor="acceptedTerms">J’accepte les <Link className="auth-terms-link" href="/terms">conditions d’utilisation</Link>.</label>
      </div>
      {errorMessage ? <p className="auth-message is-error" role="alert">{errorMessage}</p> : null}
      {successMessage ? <p className="auth-message is-success" role="status">{successMessage}</p> : null}
      <Button className="auth-submit" disabled={isPending || confirmationRequired} type="submit">{isPending ? "Création du compte…" : "Créer mon compte"}</Button>
    </form>
  );
}