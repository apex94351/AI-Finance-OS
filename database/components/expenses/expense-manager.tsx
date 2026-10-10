"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, FileText, Plus, Search } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { filterExpenses, sumExpensesByCurrency } from "@/services/expenses";
import type { ExpenseRecord, ExpenseStatus, ExpenseSupplierRow } from "@/services/expenses";
import { ExpenseForm } from "./expense-form";

export interface ExpenseCompany {
  id: string;
  name: string;
  currency: string;
}

type ExpenseSupplier = Pick<ExpenseSupplierRow, "id" | "user_id" | "company_id" | "name">;
type StatusFilter = "all" | ExpenseStatus;

const statusLabel: Record<ExpenseStatus, string> = {
  pending: "À payer",
  paid: "Payée",
  cancelled: "Annulée",
};
const statusTone: Record<ExpenseStatus, "warning" | "success" | "neutral"> = {
  pending: "warning",
  paid: "success",
  cancelled: "neutral",
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

function dateLabel(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function ExpenseManager({
  companies,
  suppliers,
  expenses,
  loadError,
  supplierWarning,
  today = new Date().toISOString().slice(0, 10),
}: {
  companies: ExpenseCompany[];
  suppliers: ExpenseSupplier[];
  expenses: ExpenseRecord[];
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
  const [sort, setSort] = useState<"date-desc" | "date-asc" | "amount-desc" | "amount-asc">("date-desc");
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [showForm, setShowForm] = useState(false);

  const categories = useMemo(() => [...new Set(expenses.map(({ category }) => category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "fr")), [expenses]);
  const filtered = useMemo(() => filterExpenses(expenses, {
    query, category, status, period, ownerId, sort, today,
  }), [category, expenses, ownerId, period, query, sort, status, today]);
  const totals = useMemo(() => sumExpensesByCurrency(expenses), [expenses]);
  const canUseExpenses = !loadError;

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };
  const handleSaved = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Gestion financière</span></div>
          <h1>Dépenses</h1>
          <p>Consultez et suivez les dépenses enregistrées dans vos espaces.</p>
        </div>
        <button className="primary-button" type="button" onClick={openCreate} disabled={!canUseExpenses}>
          <Plus size={17} /> Ajouter une dépense
        </button>
      </div>

      {loadError ? (
        <div className="expense-error-state" role="alert">
          <p>{loadError}</p><button className="text-button" type="button" onClick={() => router.refresh()}>Réessayer</button>
        </div>
      ) : null}
      {supplierWarning ? <p className="auth-message is-error expense-message" role="status">{supplierWarning}</p> : null}

      {canUseExpenses ? (
        <>
          <section className="invoice-summary-grid expense-summary-grid" aria-label="Résumé des dépenses">
            <article className="surface-panel invoice-summary-card">
              <span>Dépenses actives</span><strong>{expenses.filter(({ status: itemStatus }) => itemStatus !== "cancelled").length}</strong>
            </article>
            {[...totals].map(([currency, total]) => (
              <article className="surface-panel invoice-summary-card" key={currency}>
                <span>Total enregistré · {currency}</span><strong>{money(total, currency)}</strong>
              </article>
            ))}
          </section>

          {showForm ? (
            <section className="surface-panel invoice-form-panel expense-form-panel" aria-labelledby="expense-form-heading">
              <ExpenseForm
                companies={companies}
                suppliers={suppliers}
                expense={editing}
                initialCompanyId={ownerId !== "all" && ownerId !== "personal" ? ownerId : ""}
                today={today}
                onCancel={() => setShowForm(false)}
                onSaved={handleSaved}
              />
            </section>
          ) : null}

          <section className="surface-panel invoice-list-panel expense-list-panel" aria-labelledby="expense-list-heading">
            <div className="invoice-list-heading">
              <div><span className="panel-kicker">Registre</span><h2 id="expense-list-heading">Dépenses enregistrées</h2></div>
              <span className="coming-soon-pill">{filtered.length} résultat{filtered.length === 1 ? "" : "s"}</span>
            </div>
            <div className="invoice-filters expense-filters">
              <label className="invoice-search">
                <Search size={16} />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher libellé ou fournisseur" aria-label="Rechercher une dépense" />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrer par catégorie">
                <option value="all">Toutes les catégories</option>
                {categories.map((item) => <option value={item} key={item}>{item}</option>)}
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filtrer par statut">
                <option value="all">Tous les statuts</option>
                {Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} aria-label="Filtrer par période">
                <option value="all">Toutes les périodes</option><option value="month">Ce mois</option><option value="year">Cette année</option>
              </select>
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} aria-label="Filtrer par espace">
                <option value="all">Tous les espaces</option><option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Trier les dépenses">
                <option value="date-desc">Date · plus récente</option><option value="date-asc">Date · plus ancienne</option>
                <option value="amount-desc">Montant · décroissant</option><option value="amount-asc">Montant · croissant</option>
              </select>
            </div>

            {filtered.length ? (
              <div className="invoice-table-scroll">
                <table className="invoice-table expense-table">
                  <thead><tr><th>Libellé</th><th>Fournisseur</th><th>Date</th><th>Catégorie</th><th>Statut</th><th>Montant</th><th><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>{filtered.map((expense) => (
                    <tr key={expense.id}>
                      <td><strong>{expense.label}</strong>{expense.notes ? <small className="expense-row-note">{expense.notes}</small> : null}</td>
                      <td>{expense.supplierName ?? "—"}</td>
                      <td>{dateLabel(expense.expenseDate)}</td>
                      <td>{expense.category ?? "—"}</td>
                      <td><Badge tone={statusTone[expense.status]}>{statusLabel[expense.status]}</Badge></td>
                      <td className="invoice-amount-cell">{money(expense.amount, expense.currency)}</td>
                      <td><button className="text-button" type="button" onClick={() => { setEditing(expense); setShowForm(true); }}>Modifier</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={filtered.length === 0 && expenses.length ? <Search size={22} /> : <FileText size={22} />}
                title={!expenses.length ? "Aucune dépense enregistrée" : "Aucun résultat"}
                description={!expenses.length
                  ? "Ajoutez une dépense pour commencer. Aucune donnée fictive n’est affichée."
                  : "Modifiez la recherche ou les filtres pour retrouver une dépense."}
                action={!expenses.length ? <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} />Ajouter une dépense</button> : undefined}
              />
            )}
            {filtered.length > 0 ? <p className="expense-sort-hint"><ArrowDownWideNarrow size={14} /> Tri appliqué aux résultats affichés.</p> : null}
          </section>
        </>
      ) : null}
    </>
  );
}
