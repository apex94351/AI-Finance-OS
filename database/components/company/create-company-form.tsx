"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createCompany, type CreateCompanyState } from "@/app/dashboard/actions";

const initialState: CreateCompanyState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="primary-button"
      disabled={pending}
      type="submit"
    >
      {pending ? "Création…" : "Créer l’entreprise"}
    </button>
  );
}

export function CreateCompanyForm() {
  const [state, formAction] = useActionState(createCompany, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.createdCompanyName) router.refresh();
  }, [router, state.createdCompanyName]);

  return (
    <form action={formAction} className="mt-6 grid max-w-xl gap-4">
      <div className="settings-field">
        <label htmlFor="company-name">Nom de l’entreprise</label>
        <input
          autoComplete="organization"
          className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
          id="company-name"
          maxLength={160}
          name="name"
          required
        />
        <p className="mt-2 text-sm text-[var(--muted)]">
          Vous pourrez compléter les autres informations de l’entreprise plus tard.
        </p>
      </div>
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      {state.createdCompanyName ? (
        <p className="auth-message is-success" role="status">
          L’entreprise « {state.createdCompanyName} » a été créée et vous en êtes propriétaire.
        </p>
      ) : null}
      <div><SubmitButton /></div>
    </form>
  );
}
