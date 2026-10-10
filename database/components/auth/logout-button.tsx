"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton({ className = "danger-action" }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function signOut() {
    setError(null);
    startTransition(async () => {
      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut();
      if (signOutError) {
        console.error("User sign out failed", { name: signOutError.name });
        setError("La déconnexion a échoué. Réessayez.");
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={className} onClick={signOut} disabled={pending}>
        {pending ? "Déconnexion…" : "Déconnexion"}
      </button>
      {error ? <span className="auth-message is-error" role="alert">{error}</span> : null}
    </>
  );
}
