import Link from "next/link";
import { AuthLayout } from "@/database/components/auth/auth-layout";
import { LoginForm } from "@/database/components/auth/login-form";
import { getSafeRedirectPath } from "@/lib/auth/redirects";

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[]; passwordUpdated?: string; authError?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, passwordUpdated, authError } = await searchParams;
  const nextPath = getSafeRedirectPath(Array.isArray(next) ? next[0] : next);

  return (
    <AuthLayout
      description="Accédez à votre espace financier."
      footer={<p>Nouveau sur AI Finance OS ? <Link href="/register">Créer un compte</Link></p>}
      title="Connectez-vous"
    >
      {passwordUpdated === "1" ? <p className="auth-message is-success" role="status">Votre mot de passe a été modifié. Vous pouvez vous connecter.</p> : null}
      {authError === "callback" ? <p className="auth-message is-error" role="alert">Le lien de confirmation ou de récupération est invalide ou a expiré. Demandez un nouveau lien puis réessayez.</p> : null}
      <LoginForm nextPath={nextPath} />
      <Link className="auth-back-link" href="/">Retour à l’accueil</Link>
    </AuthLayout>
  );
}