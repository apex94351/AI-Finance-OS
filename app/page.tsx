import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  FileCheck2,
  LockKeyhole,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ProductPreview } from "@/database/components/landing/product-preview";
import { SectionHeading } from "@/database/components/landing/section-heading";
import { Badge } from "@/database/components/ui/badge";
import { Button } from "@/database/components/ui/button";
import { Logo } from "@/database/components/ui/logo";

const workflow = [
  ["01", "Importez", "Déposez un PDF ou une image. Le document reste privé et associé à votre entreprise."],
  ["02", "Comprenez", "Les informations visibles sont structurées, contrôlées et présentées clairement."],
  ["03", "Gardez le contrôle", "Vous vérifiez, modifiez et validez avant toute décision importante."],
];

const capabilities: [LucideIcon, string, string][] = [
  [FileCheck2, "Extraction structurée", "Dates, montants, parties et modalités réunis au même endroit."],
  [CircleAlert, "Échéances lisibles", "Les informations importantes ressortent sans vous faire parcourir chaque document."],
  [Search, "Recherche instantanée", "Retrouvez rapidement un document dès que votre espace sera connecté."],
  [LockKeyhole, "Données privées", "Un espace conçu autour de l’authentification et de l’isolation par entreprise."],
];

const faqs = [
  ["Est-ce un outil de comptabilité ?", "Non. Le MVP se concentre sur la compréhension et le suivi des documents financiers. Il ne remplace pas votre comptabilité."],
  ["L’IA invente-t-elle les informations absentes ?", "Non. Une donnée absente doit rester vide et les informations ambiguës doivent être signalées pour vérification."],
  ["Mes documents sont-ils publics ?", "Non. Le produit est conçu pour utiliser un stockage privé et des accès authentifiés. La configuration Supabase est encore en cours d’implémentation."],
  ["Puis-je essayer gratuitement ?", "Le plan gratuit est prévu pour le lancement. Les limites et l’abonnement payant ne sont pas encore connectés à un système de paiement."],
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden">
      <header className="site-container flex items-center justify-between py-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-[var(--muted)] md:flex" aria-label="Navigation principale">
          <a className="nav-link" href="#fonctionnement">Fonctionnement</a>
          <a className="nav-link" href="#securite">Sécurité</a>
          <a className="nav-link" href="#faq">FAQ</a>
        </nav>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link href="/login" className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--line)] bg-white px-1.5 text-[11px] font-semibold text-[var(--ink)] transition duration-200 ease-out hover:border-[var(--ink)] sm:h-10 sm:px-3.5 sm:text-sm">Se connecter</Link>
          <Link href="/register" className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-[var(--accent)] px-1.5 text-[11px] font-semibold text-white transition duration-200 ease-out hover:bg-[var(--accent-strong)] sm:h-10 sm:px-3.5 sm:text-sm">S&apos;inscrire</Link>
        </div>
      </header>

      <main>
        <section className="site-container hero-section">
          <div className="hero-copy">
            <Badge tone="success"><span className="size-1.5 rounded-full bg-current" /> Financial operations, enfin lisibles</Badge>
            <h1>Votre finance d’entreprise, enfin organisée.</h1>
            <p>AI Finance OS transforme automatiquement vos factures et documents financiers en informations claires, échéances et actions.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--accent-strong)]" href="/dashboard">Voir la maquette de l’espace <ArrowRight className="size-4" /></Link>
              <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]" href="#produit">Découvrir AI Finance OS</a>
            </div>
            <p className="mt-5 text-xs text-[var(--muted)]">Le produit est en construction. Aucune donnée réelle n’est affichée sans connexion à votre espace.</p>
          </div>
          <div id="produit" className="hero-preview"><ProductPreview /></div>
        </section>

        <section className="site-container border-t border-[var(--line)] py-24 sm:py-32">
          <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-20">
            <SectionHeading eyebrow="Le problème" title="Les documents financiers ne devraient pas demander une enquête." description="Une facture arrive par email, une autre dans un dossier partagé. Les échéances se dispersent et les informations importantes restent difficiles à comparer." />
            <div className="grid gap-3 sm:grid-cols-2">
              {["Factures dispersées", "Échéances oubliées", "Informations difficiles à retrouver", "Temps perdu à vérifier"].map((item, index) => <div className="flex min-h-28 flex-col justify-between rounded-2xl border border-[var(--line)] bg-white p-5" key={item}><span className="text-xs font-mono text-[var(--muted)]">0{index + 1}</span><p className="text-sm font-semibold">{item}</p></div>)}
            </div>
          </div>
        </section>

        <section id="fonctionnement" className="section-wash border-y border-[var(--line)]">
          <div className="site-container py-24 sm:py-32">
            <SectionHeading eyebrow="Fonctionnement" title="Du document brut à la décision claire." description="Une expérience courte, vérifiable et pensée pour vous laisser la main sur chaque donnée importante." />
            <div className="mt-14 grid gap-8 sm:grid-cols-3">{workflow.map(([number, title, copy]) => <div className="border-t-2 border-[var(--ink)] pt-4" key={number}><span className="font-mono text-xs text-[var(--muted)]">{number}</span><h3 className="mt-12 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy}</p></div>)}</div>
          </div>
        </section>

        <section className="site-container py-24 sm:py-32">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end"><SectionHeading eyebrow="Ce qui compte" title="Une lecture plus nette de vos opérations financières." /><p className="max-w-sm text-sm leading-6 text-[var(--muted)]">Les fonctions avancées arriveront progressivement. Chaque élément visible doit correspondre à une capacité réelle du produit.</p></div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">{capabilities.map(([Icon, title, copy]) => <div className="bg-white p-7 sm:p-8" key={title}><Icon className="size-5 text-[var(--accent-strong)]" strokeWidth={1.7} /><h3 className="mt-12 text-lg font-semibold">{title}</h3><p className="mt-3 max-w-xs text-sm leading-6 text-[var(--muted)]">{copy}</p></div>)}</div>
        </section>

        <section id="securite" className="section-dark"><div className="site-container grid gap-12 py-24 sm:py-32 lg:grid-cols-[.9fr_1.1fr] lg:items-end"><SectionHeading eyebrow="Sécurité par conception" title="La clarté financière ne doit pas coûter votre confidentialité." description="Authentification, séparation des entreprises et stockage privé font partie de la cible technique. La conformité juridique devra être vérifiée séparément." /><div className="grid gap-3 sm:grid-cols-2"><div className="dark-panel"><LockKeyhole className="size-5 text-[#9ed1b6]" strokeWidth={1.7} /><p className="mt-12 font-semibold">Accès contrôlés</p><p className="mt-2 text-sm leading-6 text-[#b5c6bd]">Les données métier seront protégées côté serveur et côté base.</p></div><div className="dark-panel"><Sparkles className="size-5 text-[#9ed1b6]" strokeWidth={1.7} /><p className="mt-12 font-semibold">IA responsable</p><p className="mt-2 text-sm leading-6 text-[#b5c6bd]">Les informations absentes restent absentes. Les ambiguïtés restent visibles.</p></div></div></div></section>

        <section id="faq" className="site-container py-24 sm:py-32"><SectionHeading eyebrow="Questions fréquentes" title="Les réponses essentielles, sans promesse excessive." /><div className="mt-12 max-w-3xl divide-y divide-[var(--line)] border-y border-[var(--line)]">{faqs.map(([question, answer]) => <details className="group py-5" key={question}><summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-sm font-semibold marker:hidden">{question}<ChevronDown className="size-4 shrink-0 text-[var(--muted)] transition group-open:rotate-180" /></summary><p className="max-w-2xl pt-3 text-sm leading-6 text-[var(--muted)]">{answer}</p></details>)}</div></section>

        <section className="site-container pb-24 sm:pb-32"><div className="rounded-[1.75rem] bg-[var(--surface-dark)] px-7 py-12 text-white sm:px-12 sm:py-16"><div className="flex flex-col justify-between gap-10 lg:flex-row lg:items-end"><div><p className="eyebrow text-[#9ed1b6]">Pour commencer</p><h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Une première lecture de vos finances, sans friction.</h2></div><Button variant="secondary" className="h-12 shrink-0 border-transparent bg-white px-5">Commencer gratuitement <ArrowRight className="size-4" /></Button></div><div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#b5c6bd]"><span className="inline-flex items-center gap-2"><Check className="size-4 text-[#9ed1b6]" /> Données absentes non inventées</span><span className="inline-flex items-center gap-2"><Check className="size-4 text-[#9ed1b6]" /> Validation humaine</span><span className="inline-flex items-center gap-2"><Check className="size-4 text-[#9ed1b6]" /> Stockage privé prévu</span></div></div></section>
      </main>

      <footer className="site-container flex flex-col gap-3 border-t border-[var(--line)] py-8 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between"><p>© 2026 AI Finance OS</p><p>Produit en construction · Les fonctionnalités métier arriveront progressivement.</p></footer>
    </div>
  );
}
