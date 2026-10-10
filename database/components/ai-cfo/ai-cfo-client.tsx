"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, CircleDollarSign, FileText, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { buildCFOAnalysis, filterCFOData, type CFOCurrencySummary, type CFORecommendation } from "@/services/ai-cfo";
import type { ExpenseRecord } from "@/services/expenses";
import type { InvoiceCompany, InvoiceRecord } from "@/types/invoice";

interface AiCfoClientProps {
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  companies: Pick<InvoiceCompany, "id" | "name">[];
  invoiceError: string | null;
  expenseError: string | null;
  companyWarning?: string | null;
  asOfDate: string;
}

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function totalsText(totals: CFOCurrencySummary[]) {
  return totals.length ? totals.map(({ amount, currency }) => formatCurrency(amount, currency)).join(" · ") : "Aucun montant vérifiable";
}

function priorityTone(priority: CFORecommendation["priority"]) {
  if (priority === "urgent") return "danger";
  if (priority === "soon") return "warning";
  return "neutral";
}

export function AiCfoClient({
  invoices,
  expenses,
  companies,
  invoiceError,
  expenseError,
  companyWarning = null,
  asOfDate,
}: AiCfoClientProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [owner, setOwner] = useState<"all" | "personal" | string>("all");
  const visibleInvoices = useMemo(() => filterCFOData(invoices, owner), [invoices, owner]);
  const visibleExpenses = useMemo(() => filterCFOData(expenses, owner), [expenses, owner]);
  const analysis = useMemo(
    () => buildCFOAnalysis(visibleInvoices, visibleExpenses, asOfDate),
    [asOfDate, visibleExpenses, visibleInvoices],
  );

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Analyse financière déterministe</span></div>
          <h1>AI CFO</h1>
          <p>Une synthèse explicable des factures, dépenses et prochaines actions à partir des données chargées.</p>
        </div>
        <div className="alerts-header-actions">
          {companies.length ? (
            <label className="dashboard-company-filter">
              <span className="sr-only">Filtrer AI CFO par espace</span>
              <select aria-label="Filtrer AI CFO par espace" value={owner} onChange={(event) => setOwner(event.target.value)}>
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="text-button" type="button" disabled={isRefreshing} onClick={() => startRefresh(() => router.refresh())}>
            <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
            {isRefreshing ? "Actualisation…" : "Actualiser"}
          </button>
        </div>
      </div>

      <p className="mb-5 text-sm text-[var(--muted)]">
        Analyse calculée à partir des données accessibles au {asOfDate}. Il s’agit de règles métier explicites, pas d’une prédiction ni d’une réponse générée par un modèle IA.
      </p>

      {invoiceError ? <p className="auth-message is-error invoice-message" role="alert">{invoiceError}</p> : null}
      {expenseError ? <p className="auth-message is-error invoice-message" role="alert">{expenseError}</p> : null}
      {companyWarning ? <p className="auth-message invoice-message" role="status">{companyWarning}</p> : null}

      {!invoiceError ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Synthèse financière">
            <article className="surface-panel p-5">
              <div className="mb-3 flex items-center justify-between text-sm text-[var(--muted)]"><span>Factures en retard</span><AlertTriangle size={18} /></div>
              <strong className="block text-2xl text-[var(--ink)]">{analysis.overdue.length}</strong>
              <span className="mt-2 block text-sm">{totalsText(analysis.overdueTotals)}</span>
            </article>
            <article className="surface-panel p-5">
              <div className="mb-3 flex items-center justify-between text-sm text-[var(--muted)]"><span>Échéances sous 7 jours</span><CalendarClock size={18} /></div>
              <strong className="block text-2xl text-[var(--ink)]">{analysis.upcoming.length}</strong>
              <span className="mt-2 block text-sm">{analysis.unpaidCount} facture(s) active(s), toutes échéances confondues</span>
            </article>
            <article className="surface-panel p-5">
              <div className="mb-3 flex items-center justify-between text-sm text-[var(--muted)]"><span>À payer (statut explicite)</span><CircleDollarSign size={18} /></div>
              <strong className="block text-base text-[var(--ink)]">{totalsText(analysis.pendingTotals)}</strong>
              <span className="mt-2 block text-sm">Factures au statut « à payer » uniquement</span>
            </article>
            <article className="surface-panel p-5">
              <div className="mb-3 flex items-center justify-between text-sm text-[var(--muted)]"><span>À recevoir (statut explicite)</span><CircleDollarSign size={18} /></div>
              <strong className="block text-base text-[var(--ink)]">{totalsText(analysis.receivableTotals)}</strong>
              <span className="mt-2 block text-sm">{analysis.paidCount} facture(s) payée(s) exclue(s) des restants dus</span>
            </article>
          </section>

          <section className="mt-6 grid gap-5 xl:grid-cols-2">
            <div className="surface-panel p-5">
              <div className="invoice-list-heading">
                <div><span className="panel-kicker">Données de facturation</span><h2>Factures à surveiller</h2></div>
                <Link className="text-button" href="/due-dates">Voir les échéances <ArrowRight size={15} /></Link>
              </div>
              {analysis.overdue.length || analysis.upcoming.length ? (
                <div className="mt-4 divide-y divide-[var(--line)]">
                  {[...analysis.overdue, ...analysis.upcoming].map((action) => (
                    <article className="flex flex-wrap items-center justify-between gap-3 py-4" key={action.invoice.id}>
                      <div>
                        <strong className="block text-sm text-[var(--ink)]">{action.invoice.invoiceNumber || "Facture sans numéro"}</strong>
                        <span className="text-sm text-[var(--muted)]">{action.invoice.clientName || "Tiers non renseigné"} · {action.invoice.dueDate}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={action.kind === "overdue" ? "danger" : "warning"}>{action.kind === "overdue" ? "En retard" : "Sous 7 jours"}</Badge>
                        {action.invoice.total !== null && action.invoice.currency
                          ? <strong className="text-sm">{formatCurrency(action.invoice.total, action.invoice.currency)}</strong>
                          : <span className="text-sm text-[var(--muted)]">Montant incomplet</span>}
                        <Link aria-label={`Ouvrir ${action.invoice.invoiceNumber || "la facture"}`} href={`/invoices#invoice-${action.invoice.id}`} className="text-button">Ouvrir</Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<ShieldCheck size={22} />} title="Aucune échéance prioritaire" description="Aucune facture active n’est échue ou prévue dans les sept prochains jours pour cet espace." />
              )}
            </div>

            <div className="surface-panel p-5">
              <div className="invoice-list-heading">
                <div><span className="panel-kicker">Données chargées</span><h2>Dépenses par devise</h2></div>
                <Link className="text-button" href="/expenses">Voir les dépenses <ArrowRight size={15} /></Link>
              </div>
              {expenseError ? (
                <EmptyState icon={<CircleDollarSign size={22} />} title="Analyse des dépenses indisponible" description="Les montants de dépenses ne sont pas considérés comme nuls. Consultez le message d’erreur ci-dessus." />
              ) : analysis.expenseSummaries.length ? (
                <div className="mt-4 divide-y divide-[var(--line)]">
                  {analysis.expenseSummaries.map((expense) => (
                    <article className="flex flex-wrap justify-between gap-3 py-4" key={expense.currency}>
                      <strong>{expense.currency}</strong>
                      <div className="text-right text-sm">
                        <p>Total actif : {formatCurrency(expense.total, expense.currency)}</p>
                        <p className="text-[var(--muted)]">À régler : {formatCurrency(expense.pending, expense.currency)} · Réglé : {formatCurrency(expense.paid, expense.currency)}</p>
                      </div>
                    </article>
                  ))}
                  <p className="pt-3 text-xs text-[var(--muted)]">Les dépenses annulées sont exclues. Aucune comparaison historique n’est disponible.</p>
                </div>
              ) : (
                <EmptyState icon={<CircleDollarSign size={22} />} title="Aucune dépense enregistrée" description="Aucune dépense active n’a été trouvée dans les espaces accessibles." />
              )}
            </div>
          </section>

          <section className="surface-panel mt-6 p-5">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Priorités justifiées</span><h2>Plan d’action</h2></div>
              <span className="coming-soon-pill">{analysis.recommendations.length} action(s)</span>
            </div>
            {analysis.recommendations.length ? (
              <div className="mt-3 divide-y divide-[var(--line)]">
                {analysis.recommendations.map((recommendation) => (
                  <article className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between" key={recommendation.id}>
                    <div className="flex gap-3">
                      <Sparkles className="mt-1 shrink-0 text-[var(--muted)]" size={17} />
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-[var(--ink)]">{recommendation.title}</h3>
                          <Badge tone={priorityTone(recommendation.priority)}>{recommendation.priority === "urgent" ? "Urgent" : recommendation.priority === "soon" ? "À venir" : recommendation.priority === "review" ? "À vérifier" : "À traiter"}</Badge>
                        </div>
                        <p className="text-sm text-[var(--muted)]">{recommendation.explanation}</p>
                        <p className="mt-1 text-xs">{recommendation.evidence}</p>
                      </div>
                    </div>
                    <Link className="text-button shrink-0" href={recommendation.href}>Consulter <ArrowRight size={15} /></Link>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<ShieldCheck size={22} />} title="Aucune action prioritaire" description="Aucun brouillon, retard, échéance proche ou point de vérification n’a été identifié dans les factures chargées." />
            )}
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="surface-panel p-5">
              <h2 className="mb-2 font-semibold text-[var(--ink)]"><FileText className="mr-2 inline" size={17} />Vue des factures</h2>
              <p className="text-sm text-[var(--muted)]">{analysis.unpaidCount} facture(s) active(s) · {analysis.paidCount} facture(s) payée(s).</p>
              <p className="mt-2 text-sm">Montants réglés : {totalsText(analysis.paidTotals)}. Les brouillons et annulations sont exclus des restants dus.</p>
            </article>
            <article className="surface-panel p-5">
              <h2 className="mb-2 font-semibold text-[var(--ink)]"><ShieldCheck className="mr-2 inline" size={17} />Points de vigilance</h2>
              {analysis.risks.length ? (
                <ul className="space-y-2 text-sm">
                  {analysis.risks.map((risk) => <li key={`${risk.invoice.id}-${risk.kind}`}><Link className="text-button" href={`/invoices#invoice-${risk.invoice.id}`}>{risk.invoice.invoiceNumber || "Facture"} : {risk.reason}</Link></li>)}
                </ul>
              ) : <p className="text-sm text-[var(--muted)]">Aucune incohérence ni donnée de facture à vérifier n’a été détectée.</p>}
            </article>
          </section>
        </>
      ) : (
        <>
          <section className="surface-panel">
            <EmptyState icon={<AlertTriangle size={22} />} title="Analyse des factures indisponible" description="La synthèse des factures est masquée tant que les données ne sont pas chargées correctement." />
          </section>
          <section className="surface-panel mt-6 p-5">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Données chargées indépendamment</span><h2>Dépenses par devise</h2></div>
              <Link className="text-button" href="/expenses">Voir les dépenses <ArrowRight size={15} /></Link>
            </div>
            {expenseError ? (
              <p className="mt-4 text-sm text-[var(--muted)]">L’analyse des dépenses est également indisponible ; aucun total n’est supposé.</p>
            ) : analysis.expenseSummaries.length ? (
              <div className="mt-4 divide-y divide-[var(--line)]">
                {analysis.expenseSummaries.map((expense) => (
                  <article className="flex flex-wrap justify-between gap-3 py-4" key={expense.currency}>
                    <strong>{expense.currency}</strong>
                    <div className="text-right text-sm">
                      <p>Total actif : {formatCurrency(expense.total, expense.currency)}</p>
                      <p className="text-[var(--muted)]">À régler : {formatCurrency(expense.pending, expense.currency)} · Réglé : {formatCurrency(expense.paid, expense.currency)}</p>
                    </div>
                  </article>
                ))}
                <p className="pt-3 text-xs text-[var(--muted)]">Les dépenses annulées sont exclues. Aucune comparaison historique n’est disponible.</p>
              </div>
            ) : (
              <EmptyState icon={<CircleDollarSign size={22} />} title="Aucune dépense enregistrée" description="Aucune dépense active n’a été trouvée dans les espaces accessibles." />
            )}
          </section>
        </>
      )}
    </>
  );
}
