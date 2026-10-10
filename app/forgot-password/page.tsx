import Link from "next/link";
import { AuthLayout } from "@/database/components/auth/auth-layout";
import { ForgotPasswordForm } from "@/database/components/auth/forgot-password-form";
import { getSafeRedirectPath } from "@/lib/auth/redirects";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = getSafeRedirectPath(Array.isArray(next) ? next[0] : next);

  return (
    <AuthLayout
      description="Nous vous enverrons un lien pour choisir un nouveau mot de passe."
      footer={<p>Vous vous souvenez de votre mot de passe ? <Link href="/login">Se connecter</Link></p>}
      title="Réinitialiser le mot de passe"
    >
      <ForgotPasswordForm nextPath={nextPath} />
      <Link className="auth-back-link" href="/login">Retour à la connexion</Link>
    </AuthLayout>
  );
}