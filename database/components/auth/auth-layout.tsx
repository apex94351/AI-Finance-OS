import type { ReactNode } from "react";
import { Logo } from "@/database/components/ui/logo";

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-brand"><Logo /></div>
        <section className="auth-panel" aria-labelledby="auth-title">
          <p className="eyebrow">Espace sécurisé</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </section>
        <div className="auth-footer">{footer}</div>
      </div>
    </main>
  );
}