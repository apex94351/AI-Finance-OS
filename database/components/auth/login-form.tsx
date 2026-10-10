"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/database/components/ui/button";
import { AuthPasswordField, AuthTextField } from "@/database/components/auth/auth-fields";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loginSchema } from "@/lib/auth/validation";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const isSubmitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    setErrorMessage("");
    setSuccessMessage("");

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Vérifiez les champs saisis.");
      return;
    }

    isSubmitting.current = true;
    setIsPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await signInWithPassword(
        (credentials) => supabase.auth.signInWithPassword(credentials),
        parsed.data,
        nextPath,
      );
      if ("error" in result) {
        setErrorMessage(getAuthErrorMessage(result.error));
      } else {
        setSuccessMessage("Connexion réussie. Ouverture de votre espace…");
        router.replace(result.redirectTo);
        router.refresh();
      }
    } catch {
      setErrorMessage("La connexion est indisponible. Vérifiez la configuration et réessayez.");
    } finally {
      isSubmitting.current = false;
      setIsPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <AuthTextField autoComplete="email" id="email" label="Adresse e-mail" name="email" required type="email" />
      <AuthPasswordField autoComplete="current-password" id="password" label="Mot de passe" name="password" required />
      <div className="auth-form-aside"><Link href="/forgot-password">Mot de passe oublié ?</Link></div>
        <div className="auth-form-aside"><Link href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>Mot de passe oublié ?</Link></div>
      {errorMessage ? <p className="auth-message is-error" role="alert">{errorMessage}</p> : null}
      {successMessage ? <p className="auth-message is-success" role="status">{successMessage}</p> : null}
      <Button className="auth-submit" disabled={isPending} type="submit">{isPending ? "Connexion…" : "Se connecter"}</Button>
    </form>
  );
}