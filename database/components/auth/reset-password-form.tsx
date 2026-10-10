"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthPasswordField } from "@/database/components/auth/auth-fields";
import { Button } from "@/database/components/ui/button";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { passwordResetSchema } from "@/lib/auth/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const isSubmitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    setErrorMessage("");
    const formData = new FormData(event.currentTarget);
    const parsed = passwordResetSchema.safeParse({
      password: formData.get("password"),
      passwordConfirmation: formData.get("passwordConfirmation"),
    });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Vérifiez les champs saisis.");
      return;
    }

    isSubmitting.current = true;
    setIsPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error.message));
      } else {
        router.replace(`/login?passwordUpdated=1&next=${encodeURIComponent(nextPath)}`);
        router.refresh();
      }
    } catch {
      setErrorMessage("La modification est indisponible. Ouvrez le lien de récupération reçu puis réessayez.");
    } finally {
      isSubmitting.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <AuthPasswordField autoComplete="new-password" id="newPassword" label="Nouveau mot de passe (8 caractères minimum)" minLength={8} name="password" required />
      <AuthPasswordField autoComplete="new-password" id="newPasswordConfirmation" label="Confirmer le mot de passe" minLength={8} name="passwordConfirmation" required />
      {errorMessage ? <p className="auth-message is-error" role="alert">{errorMessage}</p> : null}
      <Button className="auth-submit" disabled={isPending} type="submit">{isPending ? "Modification…" : "Modifier le mot de passe"}</Button>
    </form>
  );
}