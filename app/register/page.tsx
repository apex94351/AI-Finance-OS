import Link from "next/link";
import { AuthLayout } from "@/database/components/auth/auth-layout";
import { RegisterForm } from "@/database/components/auth/register-form";

export default function RegisterPage() {
  return (
    <AuthLayout
      description="Créez votre espace professionnel en quelques instants."
      footer={<p>Vous avez déjà un compte ? <Link href="/login">Se connecter</Link></p>}
      title="Créer votre compte"
    >
      <RegisterForm />
      <Link className="auth-back-link" href="/">Retour à l’accueil</Link>
    </AuthLayout>
  );
}