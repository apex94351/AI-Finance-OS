import Link from "next/link";
import { AuthLayout } from "@/database/components/auth/auth-layout";
import { ResetPasswordForm } from "@/database/components/auth/reset-password-form";
import { getSafeRedirectPath } from "@/lib/auth/redirects";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = getSafeRedirectPath(Array.isArray(next) ? next[0] : next);

  return (
    <AuthLayout
      description="Choisissez un nouveau mot de passe pour votre compte."
      footer={<p>Vous avez un problème avec le lien ? <Link href="/forgot-password">Demander un autre lien</Link></p>}
      title="Nouveau mot de passe"
    >
      <ResetPasswordForm nextPath={nextPath} />
    </AuthLayout>
  );
}