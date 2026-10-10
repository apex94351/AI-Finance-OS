import { ArrowLeft, Clock3, Construction } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/database/components/app-shell";
import { messages } from "@/i18n/messages";

const sectionKeys = ["finance", "invoices", "expenses", "revenue", "due-dates", "documents", "customers", "suppliers", "team", "analytics", "ai", "automations"] as const;
type SectionKey = (typeof sectionKeys)[number];
const navKeyBySection: Record<SectionKey, keyof typeof messages.fr.nav> = { finance: "finance", invoices: "invoices", expenses: "expenses", revenue: "revenue", "due-dates": "dueDates", documents: "documents", customers: "customers", suppliers: "suppliers", team: "team", analytics: "analytics", ai: "assistant", automations: "automations" };

export default async function PlaceholderPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const key = section as SectionKey;
  const label = sectionKeys.includes(key) ? messages.fr.nav[navKeyBySection[key]] : "Espace de travail";
  return <AppShell><div className="placeholder-page"><span className="placeholder-icon"><Construction size={24} /></span><span className="panel-kicker">{label}</span><h1>{messages.fr.common.soon}</h1><p>Cette section est préparée dans l’interface. Les données et actions réelles seront connectées dans une prochaine phase.</p><div className="placeholder-actions"><span className="coming-soon-pill"><Clock3 size={14} />Bientôt disponible</span><Link href="/dashboard" className="text-button"><ArrowLeft size={15} />{messages.fr.common.back}</Link></div></div></AppShell>;
}