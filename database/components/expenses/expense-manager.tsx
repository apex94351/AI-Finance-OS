"use client";

import { Fragment, useCallback, useMemo, useState, useTransition, type FocusEvent, type PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ArrowLeft, ArrowRight, FileText, Plus, Search } from "lucide-react";
import { deleteExpense, setRecurringExpenseStatus } from "@/app/expenses/actions";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import {
  buildAnnualExpenseSeries,
  buildCurrentMonthRecurringExpenseTotals,
  buildMonthlyExpenseSeries,
  buildExpenseFinancialSummary,
  filterExpenses,
  normalizeRecurringMonthlyCost,
  type ExpensePaymentRecord,
  type ExpenseRecord,
  type ExpenseStatus,
  type ExpenseSupplierRow,
  type RecurringExpenseRecord,
  type RecurringExpenseStatus,
} from "@/services/expenses";
import { ExpenseForm } from "./expense-form";
import { ExpensePaymentForm } from "./expense-payment-form";
import { RecurringExpenseForm } from "./recurring-expense-form";
import { SupplierInvoicePaymentForm } from "@/database/components/invoices/supplier-invoice-payment-form";

export interface ExpenseCompany {
  id: string;
  name: string;
  currency: string;
}

type ExpenseSupplier = Pick<ExpenseSupplierRow, "id" | "user_id" | "company_id" | "name">;
type ExpenseDocument = { id: string; user_id: string | null; company_id: string | null; file_name: string };
type StatusFilter = "all" | ExpenseStatus;
type ExpenseSort = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
type ChartMode = "month" | "year";

const statusLabel: Record<ExpenseStatus, string> = {
  pending: "À payer",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
};
const statusTone: Record<ExpenseStatus, "warning" | "success" | "neutral" | "danger"> = {
  pending: "warning",
  paid: "success",
  overdue: "danger",
  cancelled: "neutral",
};
const recurringStatusLabel: Record<RecurringExpenseStatus, string> = {
  active: "Active",
  paused: "En pause",
  stopped: "Arrêtée",
};
const frequencyLabel = {
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  yearly: "Annuelle",
} as const;

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function dateLabel(date: string) {
  if (!date) return "Date non renseignée";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function CurrencyTotals({ totals }: { totals: Map<string, number> }) {
  if (!totals.size) return <strong>—</strong>;
  return <strong>{[...totals].map(([currency, amount]) => money(amount, currency)).join(" · ")}</strong>;
}

export function ExpenseManager({
  companies,
  suppliers,
  documents,
  expenses,
  payments,
  recurringExpenses,
  loadError,
  supplierWarning,
  today = new Date().toISOString().slice(0, 10),
}: {
  companies: ExpenseCompany[];
  suppliers: ExpenseSupplier[];
  documents: ExpenseDocument[];
  expenses: ExpenseRecord[];
  payments: ExpensePaymentRecord[];
  recurringExpenses: RecurringExpenseRecord[];
  loadError: string | null;
  supplierWarning: string | null;
  today?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<"all" | "month" | "year">("all");
  const [ownerId, setOwnerId] = useState("all");
  const [sort, setSort] = useState<ExpenseSort>("date-desc");
  const [chartMode, setChartMode] = useState<ChartMode>("month");
  const [selectedYear, setSelectedYear] = useState(Number(today.slice(0, 4)));
  const [selectedMonth, setSelectedMonth] = useState(Number(today.slice(5, 7)));
  const [showForm, setShowForm] = useState(false);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringExpenseRecord | null>(null);
  const [paying, setPaying] = useState<ExpenseRecord | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const canUseExpenses = !loadError;
  const maxYear = Number(today.slice(0, 4));

  const categories = useMemo(
    () => [...new Set(expenses.map(({ category: item }) => item).filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, "fr")),
    [expenses],
  );
  const filtered = useMemo(() => filterExpenses(expenses, {
    query,
    category,
    status,
    period,
    ownerId,
    sort,
    selectedYear,
    selectedMonth,
    today,
  }), [category, expenses, ownerId, period, query, selectedMonth, selectedYear, sort, status, today]);
  const summary = useMemo(
    () => buildExpenseFinancialSummary(expenses, payments, selectedYear, selectedMonth, today),
    [expenses, payments, selectedMonth, selectedYear, today],
  );
  const chartData = useMemo(
    () => chartMode === "month"
      ? buildMonthlyExpenseSeries(expenses, selectedYear, today)
      : buildAnnualExpenseSeries(expenses, maxYear, today),
    [chartMode, expenses, maxYear, selectedYear, today],
  );
  const recurringChartTotals = useMemo(
    () => buildCurrentMonthRecurringExpenseTotals(recurringExpenses, expenses, today),
    [expenses, recurringExpenses, today],
  );
  const chartIncludesCurrentMonth = chartMode === "year" || selectedYear === maxYear;
  const chartCurrencies = useMemo(() => [...new Set([
    ...expenses.filter((expense) => expense.status !== "cancelled").map(({ currency }) => currency),
    ...(chartIncludesCurrentMonth ? [...recurringChartTotals.keys()] : []),
  ])].sort((left, right) => left.localeCompare(right)), [chartIncludesCurrentMonth, expenses, recurringChartTotals]);
  const recentExpenses = useMemo(
    () => [...expenses].sort((left, right) => right.expenseDate.localeCompare(left.expenseDate)).slice(0, 5),
    [expenses],
  );
  const activeRecurringTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of recurringExpenses) {
      if (item.status !== "active") continue;
      totals.set(item.currency, (totals.get(item.currency) ?? 0) + normalizeRecurringMonthlyCost(item.amount, item.frequency));
    }
    return totals;
  }, [recurringExpenses]);
  const linkedInvoices = useMemo(
    () => expenses.filter((item) => item.invoiceId && (item.sourceType === "supplier_invoice" || item.id === editing?.id)),
    [editing?.id, expenses],
  );

  const closeExpenseForm = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    router.refresh();
  }, [router]);
  const closeRecurringForm = useCallback(() => {
    setShowRecurringForm(false);
    setEditingRecurring(null);
    router.refresh();
  }, [router]);
  const handlePaymentSaved = useCallback(() => {
    setPaying(null);
    router.refresh();
  }, [router]);
  const handleDelete = (expense: ExpenseRecord) => {
    const label = expense.invoiceNumber ? `la facture ${expense.invoiceNumber}` : `« ${expense.label} »`;
    if (!window.confirm(`Supprimer ${label} de Dépenses ?${expense.invoiceId ? " La facture source restera dans Factures." : ""}`)) return;
    setActionError(null);
    startTransition(async () => {
      const result = await deleteExpense(expense.companyId, expense.id);
      if (result.error) setActionError(result.error);
      else router.refresh();
    });
  };
  const changeRecurringStatus = (recurring: RecurringExpenseRecord, nextStatus: "active" | "paused" | "stopped") => {
    if (nextStatus === "stopped" && !window.confirm(`Arrêter définitivement « ${recurring.label} » ?`)) return;
    setActionError(null);
    startTransition(async () => {
      const result = await setRecurringExpenseStatus(recurring.companyId, recurring.id, nextStatus);
      if (result.error) setActionError(result.error);
      else router.refresh();
    });
  };
  const openExpenseForm = (expense: ExpenseRecord | null) => {
    setEditing(expense);
    setShowForm(true);
    setShowRecurringForm(false);
    setPaying(null);
  };
  const openRecurringForm = (recurring: RecurringExpenseRecord | null) => {
    setEditingRecurring(recurring);
    setShowRecurringForm(true);
    setShowForm(false);
    setPaying(null);
  };

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Gestion financière</span></div>
          <h1>Dépenses</h1>
          <p>Suivez les dépenses, les paiements fournisseurs et vos charges récurrentes.</p>
        </div>
        <div className="expense-header-actions">
          <button className="text-button" type="button" onClick={() => openRecurringForm(null)} disabled={!canUseExpenses}><Plus size={16} />Ajouter une récurrence</button>
          <button className="primary-button" type="button" onClick={() => openExpenseForm(null)} disabled={!canUseExpenses}><Plus size={17} />Ajouter une dépense</button>
        </div>
      </div>

      {loadError ? (
        <div className="expense-error-state" role="alert"><p>{loadError}</p><button className="text-button" type="button" onClick={() => router.refresh()}>Réessayer</button></div>
      ) : null}
      {supplierWarning ? <p className="auth-message is-error expense-message" role="status">{supplierWarning}</p> : null}
      {actionError ? <p className="auth-message is-error expense-message" role="alert">{actionError}</p> : null}

      {canUseExpenses ? (
        <>
          <div className="expense-period-controls">
            <label htmlFor="expense-summary-month">Période des indicateurs</label>
            <input id="expense-summary-month" type="month" value={`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`} max={today.slice(0, 7)} onChange={(event) => {
              const [year, month] = event.target.value.split("-").map(Number);
              if (year && month) { setSelectedYear(year); setSelectedMonth(month); }
            }} />
          </div>
          <section className="invoice-summary-grid expense-summary-grid" aria-label="Résumé des dépenses">
            <article className="surface-panel invoice-summary-card"><span>Dépenses du mois</span><CurrencyTotals totals={summary.monthSpend} /></article>
            <article className="surface-panel invoice-summary-card"><span>À payer · solde non échu</span><CurrencyTotals totals={summary.payable} /></article>
            <article className="surface-panel invoice-summary-card"><span>Payé ce mois-ci</span><CurrencyTotals totals={summary.paidThisMonth} /></article>
            <article className="surface-panel invoice-summary-card"><span>En retard · solde restant</span><CurrencyTotals totals={summary.overdue} /></article>
          </section>
          {summary.incompleteBalanceCount > 0 ? <p className="dashboard-partial-warning" role="status">
            Le solde restant de {summary.incompleteBalanceCount} dépense{summary.incompleteBalanceCount === 1 ? "" : "s"} n’est pas inclus dans les totaux : l’historique des paiements doit être vérifié.
          </p> : null}
          <p className="dashboard-note expense-payment-note">« Payé ce mois-ci » ne compte que les paiements enregistrés avec une date. Les factures fournisseurs déjà marquées payées sans historique daté ne sont pas ajoutées à cet indicateur.</p>

          <section className="surface-panel expense-chart-panel" aria-labelledby="expense-chart-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Dépenses engagées</span><h2 id="expense-chart-heading">Évolution des dépenses</h2></div>
              <div className="expense-chart-controls">
                <div className="dashboard-period-controls" role="group" aria-label="Période du graphique">
                  <button type="button" className={chartMode === "month" ? "active" : ""} aria-pressed={chartMode === "month"} onClick={() => setChartMode("month")}>Par mois</button>
                  <button type="button" className={chartMode === "year" ? "active" : ""} aria-pressed={chartMode === "year"} onClick={() => setChartMode("year")}>Par année</button>
                </div>
                {chartMode === "month" ? <div className="expense-year-selector">
                  <button type="button" className="icon-button" aria-label="Année précédente" onClick={() => setSelectedYear((year) => Math.max(year - 1, firstAvailableYear()))} disabled={selectedYear <= firstAvailableYear()}><ArrowLeft size={16} /></button>
                  <strong>{selectedYear}</strong>
                  <button type="button" className="icon-button" aria-label="Année suivante" onClick={() => setSelectedYear((year) => Math.min(year + 1, maxYear))} disabled={selectedYear >= maxYear}><ArrowRight size={16} /></button>
                </div> : null}
              </div>
            </div>
            {chartData.length && chartCurrencies.length ? (
              chartCurrencies.map((currency) => {
                const sourceData = chartMode === "month"
                  ? buildMonthlyExpenseSeries(expenses.filter((expense) => expense.currency === currency), selectedYear, today)
                  : buildAnnualExpenseSeries(expenses.filter((expense) => expense.currency === currency), maxYear, today);
                const scheduledAmount = chartIncludesCurrentMonth ? recurringChartTotals.get(currency) ?? 0 : 0;
                const currentPeriod = chartMode === "month" ? today.slice(0, 7) : String(maxYear);
                const currencyData = sourceData.map((bucket) => {
                  const recurringAmount = bucket.period === currentPeriod ? scheduledAmount : 0;
                  const actualAmount = bucket.amount ?? 0;
                  return {
                    ...bucket,
                    actualAmount,
                    recurringAmount,
                    amount: bucket.amount === null ? null : actualAmount + recurringAmount,
                  };
                });
                const maximum = Math.max(0, ...currencyData.flatMap(({ amount }) => amount === null ? [] : [amount]));
                return <ExpenseChart key={currency} data={currencyData} max={maximum} currency={currency} />;
              })
            ) : <EmptyState icon={<FileText size={22} />} title="Aucune dépense à représenter" description="Les séries apparaîtront dès qu’une dépense réelle sera enregistrée." />}
            <p className="expense-chart-legend"><span className="expense-chart-legend-actual" />Dépenses enregistrées{chartIncludesCurrentMonth && [...recurringChartTotals.values()].some((amount) => amount > 0) ? <><span className="expense-chart-legend-recurring" />Échéances récurrentes prévues dans le mois courant</> : null}</p>
            <p className="dashboard-note">Les occurrences récurrentes prévues ne couvrent que le mois courant et sont dédupliquées avec celles déjà enregistrées. Les mois futurs restent non valorisés.</p>
          </section>

          {showForm ? <section className="surface-panel invoice-form-panel expense-form-panel" aria-labelledby="expense-form-heading">
            <ExpenseForm
              companies={companies}
              suppliers={suppliers}
              documents={documents}
              invoices={linkedInvoices}
              expense={editing}
              initialCompanyId={ownerId !== "all" && ownerId !== "personal" ? ownerId : ""}
              today={today}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSaved={closeExpenseForm}
            />
          </section> : null}
          {showRecurringForm ? <section className="surface-panel invoice-form-panel expense-form-panel">
            <RecurringExpenseForm
              companies={companies}
              suppliers={suppliers}
              documents={documents}
              recurringExpense={editingRecurring}
              initialCompanyId={ownerId !== "all" && ownerId !== "personal" ? ownerId : ""}
              today={today}
              onCancel={() => { setShowRecurringForm(false); setEditingRecurring(null); }}
              onSaved={closeRecurringForm}
            />
          </section> : null}

          {paying ? <section className="surface-panel invoice-form-panel expense-form-panel">
            <div className="invoice-form-title"><div><span className="panel-kicker">Paiement partiel ou total</span><h2>Enregistrer un paiement · {paying.label}</h2></div><button className="text-button" type="button" onClick={() => setPaying(null)}>Fermer</button></div>
            {paying.sourceType === "supplier_invoice" && paying.invoiceId ? (
              <SupplierInvoicePaymentForm
                companyId={paying.companyId}
                invoiceId={paying.invoiceId}
                balance={Math.max(0, paying.amount - (paying.paidAmount ?? 0))}
                today={today}
                onSaved={handlePaymentSaved}
              />
            ) : (
              <ExpensePaymentForm
                companyId={paying.companyId}
                expenseId={paying.id}
                balance={paying.status === "paid" ? 0 : Math.max(0, paying.amount - (paying.paidAmount ?? 0))}
                today={today}
                onSaved={handlePaymentSaved}
              />
            )}
          </section> : null}

          <section className="surface-panel expense-recurrence-panel" aria-labelledby="expense-recurring-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Charges régulières</span><h2 id="expense-recurring-heading">Dépenses récurrentes</h2></div>
              <div className="expense-recurring-summary"><span>Coût mensuel estimé</span><CurrencyTotals totals={activeRecurringTotals} /></div>
            </div>
            <p className="dashboard-note">Estimation normalisée (hebdomadaire × 52 / 12, trimestrielle / 3, annuelle / 12), et non le montant réellement débité ce mois-ci.</p>
            {recurringExpenses.length ? <div className="invoice-table-scroll"><table className="invoice-table expense-table">
              <thead><tr><th>Nom</th><th>Fournisseur</th><th>Montant / fréquence</th><th>Coût mensuel</th><th>Prochaine échéance</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>{recurringExpenses.map((item) => {
                const occurrences = expenses.filter((expense) => expense.recurrenceId === item.id)
                  .sort((left, right) => right.expenseDate.localeCompare(left.expenseDate));
                return <Fragment key={item.id}>
                <tr>
                  <td><strong>{item.label}</strong>{item.documentName ? <small className="expense-row-note">{item.documentName}</small> : null}</td>
                  <td>{item.supplierName ?? "—"}</td>
                  <td>{money(item.amount, item.currency)} · {frequencyLabel[item.frequency]}</td>
                  <td>{money(normalizeRecurringMonthlyCost(item.amount, item.frequency), item.currency)}</td>
                  <td>{dateLabel(item.nextDueDate)}</td>
                  <td><Badge tone={item.status === "active" ? "success" : item.status === "paused" ? "warning" : "neutral"}>{recurringStatusLabel[item.status]}</Badge></td>
                  <td className="expense-row-actions">
                    <button className="text-button" type="button" onClick={() => openRecurringForm(item)} disabled={item.status === "stopped"}>Modifier</button>
                    <button className="text-button" type="button" aria-expanded={expanded === `rec-${item.id}`} onClick={() => setExpanded((current) => current === `rec-${item.id}` ? null : `rec-${item.id}`)}>Occurrences</button>
                    {item.status === "active" ? <button className="text-button" type="button" disabled={isPending} onClick={() => changeRecurringStatus(item, "paused")}>Mettre en pause</button> : null}
                    {item.status === "paused" ? <button className="text-button" type="button" disabled={isPending} onClick={() => changeRecurringStatus(item, "active")}>Reprendre</button> : null}
                    {item.status !== "stopped" ? <button className="text-button expense-danger-button" type="button" disabled={isPending} onClick={() => changeRecurringStatus(item, "stopped")}>Arrêter</button> : null}
                    {item.documentId ? <Link className="text-button" href={`/documents#document-${encodeURIComponent(item.documentId)}`}>Justificatif</Link> : null}
                  </td>
                </tr>
                {expanded === `rec-${item.id}` ? <tr className="expense-detail-row"><td colSpan={7}>
                  <strong>Prochaine échéance : {dateLabel(item.nextDueDate)}</strong>
                  {occurrences.length ? <ul className="expense-occurrence-list">{occurrences.map((occurrence) => <li key={occurrence.id}>{dateLabel(occurrence.expenseDate)} · {occurrence.label} · {money(occurrence.amount, occurrence.currency)} · {statusLabel[occurrence.status]}</li>)}</ul> : <p className="dashboard-note">Aucune occurrence enregistrée pour le moment.</p>}
                </td></tr> : null}
                </Fragment>;
              })}</tbody>
            </table></div> : <EmptyState icon={<FileText size={22} />} title="Aucune récurrence" description="Ajoutez vos abonnements et échéances régulières pour suivre leur coût mensuel estimé." action={<button className="primary-button" type="button" onClick={() => openRecurringForm(null)}><Plus size={16} />Ajouter une récurrence</button>} />}
          </section>

          <section className="surface-panel expense-recent-panel" aria-labelledby="expense-recent-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Activité récente</span><h2 id="expense-recent-heading">Dernières dépenses</h2></div>
              <button className="text-button" type="button" onClick={() => { setShowAll((value) => !value); if (!showAll) setQuery(""); }}>{showAll ? "Masquer la liste complète" : "Tout voir"} <ArrowRight size={14} /></button>
            </div>
            {recentExpenses.length ? <div className="invoice-table-scroll"><table className="invoice-table expense-table">
              <thead><tr><th>Libellé</th><th>Fournisseur</th><th>Date</th><th>Catégorie</th><th>Statut</th><th>Montant</th><th>Accès</th></tr></thead>
              <tbody>{recentExpenses.map((expense) => <ExpenseRow
                key={`${expense.sourceType ?? "expense"}-${expense.id}`}
                expense={expense}
                expanded={expanded === `recent-${expense.id}`}
                onToggle={() => setExpanded((current) => current === `recent-${expense.id}` ? null : `recent-${expense.id}`)}
                onEdit={() => openExpenseForm(expense)}
                onPay={() => setPaying(expense)}
                onDelete={() => handleDelete(expense)}
                isPending={isPending}
              />)}</tbody>
            </table></div> : <EmptyState icon={<FileText size={22} />} title="Aucune dépense enregistrée" description="Ajoutez une dépense ou consultez une facture fournisseur. Les indicateurs n’utilisent aucune donnée fictive." action={<button className="primary-button" type="button" onClick={() => openExpenseForm(null)}><Plus size={16} />Ajouter une dépense</button>} />}
          </section>

          {showAll ? <section className="surface-panel invoice-list-panel expense-list-panel" aria-labelledby="expense-list-heading">
            <div className="invoice-list-heading"><div><span className="panel-kicker">Registre complet</span><h2 id="expense-list-heading">Toutes les dépenses</h2></div><span className="coming-soon-pill">{filtered.length} résultat{filtered.length === 1 ? "" : "s"}</span></div>
            <div className="invoice-filters expense-filters">
              <label className="invoice-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher libellé ou fournisseur" aria-label="Rechercher une dépense" /></label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrer par catégorie"><option value="all">Toutes les catégories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select>
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filtrer par statut"><option value="all">Tous les statuts</option>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} aria-label="Filtrer par période"><option value="all">Toutes les périodes</option><option value="month">Mois sélectionné</option><option value="year">Année sélectionnée</option></select>
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} aria-label="Filtrer par espace"><option value="all">Tous les espaces</option><option value="personal">Espace personnel</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select>
              <select value={sort} onChange={(event) => setSort(event.target.value as ExpenseSort)} aria-label="Trier les dépenses"><option value="date-desc">Date · plus récente</option><option value="date-asc">Date · plus ancienne</option><option value="amount-desc">Montant · décroissant</option><option value="amount-asc">Montant · croissant</option></select>
            </div>
            {filtered.length ? <div className="invoice-table-scroll"><table className="invoice-table expense-table">
              <thead><tr><th>Libellé</th><th>Fournisseur</th><th>Date</th><th>Catégorie</th><th>Statut</th><th>Montant</th><th>Actions</th></tr></thead>
              <tbody>{filtered.map((expense) => <ExpenseRow
                key={`${expense.sourceType ?? "expense"}-${expense.id}`}
                expense={expense}
                expanded={expanded === `all-${expense.id}`}
                onToggle={() => setExpanded((current) => current === `all-${expense.id}` ? null : `all-${expense.id}`)}
                onEdit={() => openExpenseForm(expense)}
                onPay={() => setPaying(expense)}
                onDelete={() => handleDelete(expense)}
                isPending={isPending}
              />)}</tbody>
            </table></div> : <EmptyState icon={<Search size={22} />} title="Aucun résultat" description="Modifiez la recherche ou les filtres pour retrouver une dépense." />}
            {filtered.length > 0 ? <p className="expense-sort-hint"><ArrowDownWideNarrow size={14} /> Tri par date ou montant. Affichage complet des résultats.</p> : null}
          </section> : null}
        </>
      ) : null}
    </>
  );

  function firstAvailableYear() {
    const years = expenses.map(({ expenseDate }) => Number(expenseDate.slice(0, 4))).filter((year) => year > 0);
    return years.length ? Math.min(...years) : maxYear;
  }
}

function ExpenseRow({
  expense,
  expanded,
  onToggle,
  onEdit,
  onPay,
  onDelete,
  isPending,
}: {
  expense: ExpenseRecord;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPay: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const sourceInvoice = expense.sourceType === "supplier_invoice";
  const balance = expense.status === "paid" ? 0
    : expense.paidAmount === null ? null
      : Math.max(0, expense.amount - (expense.paidAmount ?? 0));
  return (
    <>
      <tr>
        <td><strong>{expense.label}</strong>{expense.notes ? <small className="expense-row-note">{expense.notes}</small> : null}</td>
        <td>{expense.supplierName ?? "—"}</td>
        <td>{dateLabel(expense.expenseDate)}</td>
        <td>{expense.category ?? "—"}</td>
        <td><Badge tone={statusTone[expense.status]}>{statusLabel[expense.status]}</Badge></td>
        <td className="invoice-amount-cell">{money(expense.amount, expense.currency)}{balance === null ? <small className="expense-row-note">Solde à vérifier</small> : balance > 0 && expense.paidAmount ? <small className="expense-row-note">Reste {money(balance, expense.currency)}</small> : null}</td>
        <td className="expense-row-actions">
          <button className="text-button" type="button" aria-expanded={expanded} onClick={onToggle}>Détail</button>
          {sourceInvoice ? (
            <>
              <Link className="text-button" href={`/invoices#invoice-${expense.invoiceId}`}>Facture</Link>
              {balance !== null && balance > 0 ? <button className="text-button" type="button" onClick={onPay}>Payer</button> : null}
            </>
          ) : (
            <>
              {expense.invoiceId ? <button className="text-button" type="button" disabled={isPending} onClick={onDelete}>Dissocier la facture</button> : <button className="text-button" type="button" onClick={onEdit}>Modifier</button>}
              {balance !== null && balance > 0 ? <button className="text-button" type="button" onClick={onPay}>Payer</button> : null}
              {!expense.invoiceId && !expense.recurrenceId ? <button className="text-button expense-danger-button" type="button" disabled={isPending} onClick={onDelete}>Supprimer</button> : null}
            </>
          )}
        </td>
      </tr>
      {expanded ? <tr className="expense-detail-row"><td colSpan={7}>
        <dl className="expense-detail-grid">
          <div><dt>Date d’échéance</dt><dd>{expense.dueDate ? dateLabel(expense.dueDate) : "Non renseignée"}</dd></div>
          <div><dt>Montant HT</dt><dd>{expense.subtotalHt === null || expense.subtotalHt === undefined ? "Non renseigné" : money(expense.subtotalHt, expense.currency)}</dd></div>
          <div><dt>TVA</dt><dd>{expense.vatAmount === null || expense.vatAmount === undefined ? "Non renseignée" : money(expense.vatAmount, expense.currency)}</dd></div>
          <div><dt>Payé / restant dû</dt><dd>{balance === null
            ? "Montant payé et solde à vérifier"
            : `${money(expense.status === "paid" ? expense.amount : expense.paidAmount ?? 0, expense.currency)} / ${money(balance, expense.currency)}`}</dd></div>
          {expense.invoiceId ? <div><dt>Facture associée</dt><dd><Link href="/invoices">{expense.invoiceNumber ?? "Ouvrir la facture"}</Link></dd></div> : null}
          {expense.documentId && expense.documentName ? <div><dt>Justificatif</dt><dd><Link href={`/documents#document-${encodeURIComponent(expense.documentId)}`}>{expense.documentName}</Link></dd></div> : null}
          {expense.notes ? <div className="expense-detail-wide"><dt>Notes</dt><dd>{expense.notes}</dd></div> : null}
        </dl>
      </td></tr> : null}
    </>
  );
}

function ExpenseChart({ data, max, currency }: {
  data: Array<{ period: string; label: string; amount: number | null; actualAmount: number; recurringAmount: number }>;
  max: number;
  currency: string;
}) {
  const width = 760;
  const height = 240;
  const top = 16;
  const bottom = 40;
  const plotHeight = height - top - bottom;
  const slot = width / Math.max(data.length, 1);
  const barWidth = Math.min(34, slot * 0.58);
  const [tooltip, setTooltip] = useState<{ label: string; text: string; left: number; top: number } | null>(null);
  const openTooltip = (
    item: (typeof data)[number],
    event: PointerEvent<SVGGElement> | FocusEvent<SVGGElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const label = item.period.length === 7 ? `${item.label} ${item.period.slice(0, 4)}` : item.label;
    const text = item.amount === null
      ? `${label} · période future, aucune valeur comptabilisée.`
      : item.recurringAmount > 0
        ? `${label} · total ${money(item.amount, currency)}, dont ${money(item.actualAmount, currency)} enregistrés et ${money(item.recurringAmount, currency)} d’échéances récurrentes prévues.`
        : `${label} · ${money(item.amount, currency)} enregistrés.`;
    setTooltip({
      label,
      text,
      left: Math.max(120, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 120)),
      top: Math.max(54, bounds.top - 8),
    });
  };
  return (
    <div className="dashboard-chart-scroll">
      <svg className="dashboard-expense-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Évolution des dépenses en ${currency}`}>
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}><line className="dashboard-chart-gridline" x1="0" x2={width} y1={y} y2={y} /><text className="dashboard-chart-axis" x="2" y={y - 3}>{money(max * fraction, currency)}</text></g>;
        })}
        {data.map((item, index) => {
          const x = index * slot + (slot - barWidth) / 2;
          const actualHeight = max > 0 ? item.actualAmount / max * plotHeight : 0;
          const recurringHeight = max > 0 ? item.recurringAmount / max * plotHeight : 0;
          const actualY = top + plotHeight - actualHeight;
          const recurringY = actualY - recurringHeight;
          const label = item.period.length === 7 ? `${item.label} ${item.period.slice(0, 4)}` : item.label;
          const ariaLabel = item.amount === null
            ? `${label} · période future, valeur non disponible`
            : item.recurringAmount > 0
              ? `${label} · total ${money(item.amount, currency)}, ${money(item.actualAmount, currency)} enregistrés, ${money(item.recurringAmount, currency)} récurrents prévus`
              : `${label} · ${money(item.amount, currency)} enregistrés`;
          return <g key={item.period}>
            <g
              className="expense-chart-interactive-bucket"
              data-period={item.period}
              role="img"
              aria-label={ariaLabel}
              tabIndex={0}
              onPointerEnter={(event) => openTooltip(item, event)}
              onPointerDown={(event) => openTooltip(item, event)}
              onPointerLeave={(event) => { if (event.pointerType !== "touch") setTooltip(null); }}
              onFocus={(event) => openTooltip(item, event)}
              onBlur={() => setTooltip(null)}
              onKeyDown={(event) => { if (event.key === "Escape") setTooltip(null); }}
            >
              <title>{ariaLabel}</title>
              <rect className="expense-chart-hit-area" x={index * slot} y={top} width={slot} height={plotHeight} />
              {item.amount === null ? <rect x={x} y={top + plotHeight - 3} width={barWidth} height="3" className="expense-chart-future" /> : null}
              {item.amount !== null && item.actualAmount > 0 ? <rect className="dashboard-chart-bar" x={x} y={actualY} width={barWidth} height={Math.max(actualHeight, 1)} rx="3" /> : null}
              {item.amount !== null && item.recurringAmount > 0 ? <rect className="expense-chart-recurring-bar" x={x} y={recurringY} width={barWidth} height={Math.max(recurringHeight, 1)} rx="3" /> : null}
            </g>
            <text className="dashboard-chart-axis" textAnchor="middle" x={x + barWidth / 2} y={height - 12}>{item.label}</text>
          </g>;
        })}
      </svg>
      {tooltip ? <div className="expense-chart-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
        <strong>{tooltip.label}</strong><span>{tooltip.text}</span>
      </div> : null}
    </div>
  );
}
