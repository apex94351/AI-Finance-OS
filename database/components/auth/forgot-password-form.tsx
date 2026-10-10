"use client";

import { useRef, useState, type FormEvent } from "react";
import { AuthTextField } from "@/database/components/auth/auth-fields";
import { Button } from "@/database/components/ui/button";
import { emailSchema } from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ForgotPasswordForm({ nextPath }: { nextPath: string }) {
  const isSubmitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    setErrorMessage("");
    setSuccessMessage("");
    const formData = new FormData(event.currentTarget);
    const parsed = emailSchema.safeParse(formData.get("email"));
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Saisissez une adresse e-mail valide.");
      return;
    }

    isSubmitting.current = true;
    setIsPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      const resetUrl = new URL("/reset-password", window.location.origin);
      resetUrl.searchParams.set("next", nextPath);
      callbackUrl.searchParams.set("next", `${resetUrl.pathname}${resetUrl.search}`);
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: callbackUrl.toString(),
      });
      if (error) {
        setErrorMessage("La demande n’a pas abouti. Vérifiez l’adresse et réessayez.");
      } else {
        setSuccessMessage("Si un compte correspond à cette adresse, un lien de réinitialisation vient de vous être envoyé.");
      }
    } catch {
      setErrorMessage("La récupération est indisponible. Vérifiez la configuration et réessayez.");
    } finally {
      isSubmitting.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <AuthTextField autoComplete="email" id="recoveryEmail" label="Adresse e-mail" name="email" required type="email" />
      {errorMessage ? <p className="auth-message is-error" role="alert">{errorMessage}</p> : null}
      {successMessage ? <p className="auth-message is-success" role="status">{successMessage}</p> : null}
      <Button className="auth-submit" disabled={isPending} type="submit">{isPending ? "Envoi…" : "Envoyer le lien"}</Button>
    </form>
  );
}