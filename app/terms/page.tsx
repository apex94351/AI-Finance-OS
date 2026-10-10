import Link from "next/link";
import { AuthLayout } from "@/database/components/auth/auth-layout";

export default function TermsPage() {
  return (
    <AuthLayout
      description="Conditions d’utilisation"
      footer={<p>Besoin d’un compte ? <Link href="/register">Créer un compte</Link></p>}
      title="Conditions non publiées"
    >
      <div className="auth-policy-copy">
        <p><strong>Le texte des conditions d’utilisation n’est pas encore disponible.</strong></p>
        <p>Aucune clause légale n’est présentée ici comme existante. Les conditions devront être rédigées et validées avant toute mise en production.</p>
      </div>
      <Link className="auth-back-link" href="/register">Retour à l’inscription</Link>
    </AuthLayout>
  );
}