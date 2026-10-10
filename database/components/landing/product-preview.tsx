import { ArrowUpRight, Check, FileText, ScanSearch } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { Card } from "@/database/components/ui/card";

export function ProductPreview() {
  return (
    <Card className="relative overflow-hidden p-2 shadow-[0_24px_80px_rgba(24,33,29,0.10)]">
      <div className="rounded-[14px] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <div>
            <p className="eyebrow">Aperçu du produit</p>
            <p className="mt-1 text-lg font-semibold">Votre espace financier</p>
          </div>
          <Badge tone="success">Prêt à analyser</Badge>
        </div>
        <div className="grid gap-3 py-5 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 sm:col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Première facture</p>
              <FileText className="size-4 text-[var(--muted)]" strokeWidth={1.7} />
            </div>
            <div className="mt-8 flex items-end justify-between">
              <div><p className="text-xs text-[var(--muted)]">Données extraites</p><p className="mt-1 text-2xl font-semibold tracking-tight">À vérifier</p></div>
              <span className="grid size-9 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Check className="size-4" /></span>
            </div>
          </div>
          <div className="rounded-xl bg-[var(--ink)] p-4 text-white">
            <ScanSearch className="size-5 text-[#9ed1b6]" strokeWidth={1.7} />
            <p className="mt-8 text-sm font-semibold">Analyse structurée</p>
            <p className="mt-1 text-xs leading-5 text-[#b5c6bd]">Dates, montants et informations manquantes.</p>
          </div>
        </div>
        <div className="rounded-xl bg-white p-4">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Prochaine action</p><ArrowUpRight className="size-4 text-[var(--muted)]" /></div>
          <p className="mt-2 text-sm text-[var(--muted)]">Importez un document pour commencer. Aucun chiffre n’est affiché avant votre première analyse.</p>
        </div>
      </div>
    </Card>
  );
}
