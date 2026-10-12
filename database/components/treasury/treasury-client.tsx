"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  Landmark,
  WalletCards,
} from "lucide-react";
import { DashboardCashflowChart } from "@/database/components/dashboard/dashboard-cashflow-chart";
import { saveTreasuryOpeningBalance, type TreasuryActionState } from "@/app/treasury/actions";
import {
  buildDashboardCockpit,
  resolveDashboardDateRange,
  type DashboardExpensePayment,
  type DashboardInvoicePayment,
  type DashboardPeriod,
} from "@/services/dashboard";
import {
  addTreasuryBalanceToSeries,
  type TreasuryMovement,
  type TreasuryOpeningBalance,
  type TreasuryScope,
} from "@/services/treasury";
import type { ExpenseRecord } from "@/services/expenses";
import { getInvoiceDirection, getInvoiceDisplayStatus } from "@/services/invoice-validation";
import type { InvoiceRecord } from "@/types/invoice";
import { locales, type Locale } from "@/i18n/messages";
import { getTreasuryMessages } from "@/i18n/treasury-messages";

const periodKeys: Array<Exclude<DashboardPeriod, "custom">> = ["7d", "1m", "3m", "6m", "1y"];
const fallbackCurrencies = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"];
type SeriesKey = "inflows" | "outflows" | "balance";

function currencyFormat(value: number, currency: string, locale: Locale) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function formatTotals(totals: Array<{ currency: string; amount: number }>, locale: Locale) {
  return totals.length
    ? totals.map(({ amount, currency }) => currencyFormat(amount, currency, locale)).join(" · ")
    : "—";
}

function formatDate(value: string | null, locale: Locale) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function toggleSeries(current: Set<SeriesKey>, key: SeriesKey) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className="surface-panel treasury-metric-card">
      <span className={`kpi-icon ${tone}`}><Icon size={18} /></span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

export function TreasuryClient({
  asOfDate,
  scopes,
  invoices,
  expenses,
  customerPayments,
  expensePayments,
  movements,
  historyAvailability,
  openingBalances,
  balanceSchemaAvailable,
  counterpartyNames,
  loadError,
  warning,
}: {
  asOfDate: string;
  scopes: TreasuryScope[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  customerPayments: DashboardInvoicePayment[];
  expensePayments: DashboardExpensePayment[];
  movements: TreasuryMovement[];
  historyAvailability: { customer: boolean; expenses: boolean };
  openingBalances: TreasuryOpeningBalance[];
  balanceSchemaAvailable: boolean;
  counterpartyNames: Record<string, string>;
  loadError: string | null;
  warning: string | null;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>("fr");
  const [period, setPeriod] = useState<Exclude<DashboardPeriod, "custom">>("1m");
  const [scopeKey, setScopeKey] = useState("personal");
  const [hiddenSeries, setHiddenSeries] = useState<Set<SeriesKey>>(() => new Set());
  const [showOpeningBalanceForm, setShowOpeningBalanceForm] = useState(false);
  const [state, action, pending] = useActionState(
    saveTreasuryOpeningBalance,
    {} as TreasuryActionState,
  );
  const copy = getTreasuryMessages(locale);

  useEffect(() => {
    const stored = localStorage.getItem("ai-finance-locale");
    if (stored && locales.includes(stored as Locale)) setLocale(stored as Locale);
    const updateLocale = (event: Event) => {
      const nextLocale = (event as CustomEvent<Locale>).detail;
      if (locales.includes(nextLocale)) setLocale(nextLocale);
    };
    window.addEventListener("ai-finance-locale-change", updateLocale);
    return () => window.removeEventListener("ai-finance-locale-change", updateLocale);
  }, []);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  const activeScopeId = scopeKey === "personal" ? null : scopeKey;
  const activeScope = scopes.find((scope) => scope.id === activeScopeId) ?? scopes[0] ?? {
    id: null,
    label: "Personnel",
    currency: null,
  };
  const scopeInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.companyId === activeScope.id),
    [activeScope.id, invoices],
  );
  const scopeExpenses = useMemo(
    () => expenses.filter((expense) => expense.companyId === activeScope.id),
    [activeScope.id, expenses],
  );
  const scopeInvoiceIds = useMemo(() => new Set(scopeInvoices.map(({ id }) => id)), [scopeInvoices]);
  const scopeExpenseIds = useMemo(() => new Set(scopeExpenses.map(({ id }) => id)), [scopeExpenses]);
  const scopeCustomerPayments = useMemo(
    () => customerPayments.filter((payment) => scopeInvoiceIds.has(payment.invoiceId)),
    [customerPayments, scopeInvoiceIds],
  );
  const scopeExpensePayments = useMemo(
    () => expensePayments.filter((payment) => scopeExpenseIds.has(payment.expenseId)),
    [expensePayments, scopeExpenseIds],
  );
  const scopeMovements = useMemo(
    () => movements.filter((movement) => movement.companyId === activeScope.id),
    [activeScope.id, movements],
  );
  const scopeOpeningBalances = useMemo(
    () => openingBalances.filter((balance) => balance.companyId === activeScope.id),
    [activeScope.id, openingBalances],
  );
  const range = useMemo(() => resolveDashboardDateRange(period, asOfDate), [asOfDate, period]);
  const currencies = useMemo(() => [...new Set([
    activeScope.currency,
    ...scopeInvoices.map(({ currency }) => currency),
    ...scopeExpenses.map(({ currency }) => currency),
    ...scopeOpeningBalances.map(({ currency }) => currency),
  ].filter((currency): currency is string => Boolean(currency && /^[A-Z]{3}$/.test(currency))))].sort(), [
    activeScope.currency,
    scopeExpenses,
    scopeInvoices,
    scopeOpeningBalances,
  ]);
  const availableCurrencies = currencies.length ? currencies : fallbackCurrencies;
  const cockpit = useMemo(() => buildDashboardCockpit(
    scopeInvoices,
    scopeExpenses,
    range,
    asOfDate,
    scopeCustomerPayments,
    scopeExpensePayments,
    historyAvailability,
    currencies,
  ), [
    asOfDate,
    currencies,
    historyAvailability,
    range,
    scopeCustomerPayments,
    scopeExpensePayments,
    scopeExpenses,
    scopeInvoices,
  ]);
  const actualMovements = useMemo(
    () => scopeMovements.filter((movement) => range.valid
      && movement.date >= range.startDate && movement.date <= range.endDate),
    [range, scopeMovements],
  );
  const chartSeries = useMemo(() => cockpit.cashflowSeries.map((series) => {
    const opening = scopeOpeningBalances.find(({ currency }) => currency === series.currency) ?? null;
    return addTreasuryBalanceToSeries(
      series,
      opening,
      scopeMovements,
      asOfDate,
      historyAvailability.customer && historyAvailability.expenses,
    );
  }), [asOfDate, cockpit.cashflowSeries, historyAvailability, scopeMovements, scopeOpeningBalances]);

  const balanceSummary = currencies.map((currency) => {
    const opening = scopeOpeningBalances.find((balance) => balance.currency === currency);
    const finalBalance = chartSeries
      .find((series) => series.currency === currency)
      ?.buckets.slice().reverse().find((bucket) => bucket.balance !== null && bucket.balance !== undefined)?.balance;
    const value = !historyAvailability.customer || !historyAvailability.expenses
      ? copy.historyUnavailable
      : !opening ? copy.notConfigured
        : finalBalance === null || finalBalance === undefined ? copy.notConfigured
          : currencyFormat(finalBalance, currency, locale);
    return { currency, value };
  });
  const flowCurrencies = currencies.map((currency) => ({
    currency,
    amount: 0,
  }));
  const incomingTotals = historyAvailability.customer
    ? flowCurrencies.map(({ currency }) => ({
      currency,
      amount: cockpit.customerPaymentTotals.find((total) => total.currency === currency)?.amount ?? 0,
    }))
    : [];
  const outgoingTotals = historyAvailability.expenses
    ? flowCurrencies.map(({ currency }) => ({
      currency,
      amount: cockpit.expensePaymentTotals.find((total) => total.currency === currency)?.amount ?? 0,
    }))
    : [];
  const expectedInvoices = cockpit.upcomingInvoices.filter((invoice) => {
    const direction = getInvoiceDirection(invoice);
    return direction === "customer"
      ? historyAvailability.customer
      : direction === "supplier" && historyAvailability.expenses;
  });
  const hasOpeningForEveryCurrency = currencies.length > 0
    && currencies.every((currency) => scopeOpeningBalances.some((balance) => balance.currency === currency));
  const balanceAvailable = historyAvailability.customer && historyAvailability.expenses
    && chartSeries.some((series) => series.buckets.some((bucket) => bucket.balance !== null && bucket.balance !== undefined));
  const selectedCurrency = currencies[0] ?? activeScope.currency ?? "EUR";
  const incompleteSetup = !balanceSchemaAvailable || !hasOpeningForEveryCurrency
    || !historyAvailability.customer || !historyAvailability.expenses;

  function statusName(invoice: InvoiceRecord) {
    const status = getInvoiceDisplayStatus(invoice);
    return copy.statusLabels[status] ?? status;
  }

  return (
    <div className="treasury-page">
      <div className="page-intro treasury-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Finance</span></div>
          <h1>Trésorerie</h1>
          <p>{copy.subtitle}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowOpeningBalanceForm((shown) => !shown)}>
          <Landmark size={16} />{showOpeningBalanceForm ? copy.close : copy.configure}
        </button>
      </div>

      <div className="treasury-controls">
        <label>
          <span>{copy.scope}</span>
          <select value={scopeKey} onChange={(event) => setScopeKey(event.target.value)}>
            <option value="personal">Personnel</option>
            {scopes.filter(({ id }) => id !== null).map((scope) => (
              <option key={scope.id} value={scope.id!}>{scope.label}</option>
            ))}
          </select>
        </label>
        <div className="treasury-period-controls" aria-label={copy.period}>
          <span>{copy.period}</span>
          {periodKeys.map((key, index) => (
            <button
              key={key}
              type="button"
              className={`deadline-filter-button ${period === key ? "is-active" : ""}`}
              aria-pressed={period === key}
              onClick={() => setPeriod(key)}
            >{copy.periodLabels[index]}</button>
          ))}
        </div>
      </div>

      {incompleteSetup && !loadError ? (
        <p className="treasury-setup-notice" role="status"><CircleAlert size={16} />{copy.setupNotice}</p>
      ) : null}
      {warning && !loadError ? <p className="dashboard-partial-warning" role="status">{warning} {copy.paymentWarning}</p> : null}
      {!balanceSchemaAvailable && !loadError ? <p className="dashboard-partial-warning" role="alert">{copy.balanceSchemaWarning}</p> : null}
      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{copy.loadError} {loadError}</p> : null}

      {showOpeningBalanceForm ? (
        <section className="surface-panel treasury-opening-panel" aria-labelledby="treasury-opening-heading">
          <div className="dashboard-section-heading">
            <div><span className="panel-kicker">{copy.setupRequired}</span><h2 id="treasury-opening-heading">{copy.openingHeading}</h2></div>
            <button className="text-button" type="button" onClick={() => setShowOpeningBalanceForm(false)}>{copy.close}</button>
          </div>
          <p>{copy.openingHelp}</p>
          <form action={action} className="treasury-opening-form">
            <input type="hidden" name="companyId" value={activeScope.id ?? ""} />
            <label className="invoice-field">
              <span>{copy.openingAmount}</span>
              <input name="amount" type="text" inputMode="decimal" pattern="-?\\d{1,12}([.,]\\d{1,2})?" required />
            </label>
            <label className="invoice-field">
              <span>{copy.openingDate}</span>
              <input name="date" type="date" max={asOfDate} defaultValue={asOfDate} required />
            </label>
            <label className="invoice-field">
              <span>{copy.currency}</span>
              <select name="currency" defaultValue={currencies[0] ?? ""} required>
                <option value="" disabled>{copy.currency}</option>
                {[...new Set([...availableCurrencies, ...fallbackCurrencies])].map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={pending || !balanceSchemaAvailable}>
              {pending ? copy.saving : copy.save}
            </button>
          </form>
          {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
          {state.success ? <p className="auth-message is-success" role="status">{state.success}</p> : null}
        </section>
      ) : null}

      {!loadError ? (
        <>
          <section className="treasury-metric-grid" aria-label={copy.subtitle}>
            <MetricCard
              icon={WalletCards}
              label={copy.balance}
              value={balanceSummary.length
                ? balanceSummary.map(({ currency, value }) => `${currency}: ${value}`).join(" · ")
                : copy.notConfigured}
              hint={balanceAvailable ? copy.balanceDefinition : copy.setupNotice}
              tone="purple"
            />
            <MetricCard icon={ArrowDownLeft} label={copy.inflows} value={formatTotals(incomingTotals, locale)} hint={`${copy.periodDefinition} · ${copy.periodLabels[periodKeys.indexOf(period)]}`} tone="green" />
            <MetricCard icon={ArrowUpRight} label={copy.outflows} value={formatTotals(outgoingTotals, locale)} hint={`${copy.periodDefinition} · ${copy.periodLabels[periodKeys.indexOf(period)]}`} tone="blue" />
            <MetricCard
              icon={CalendarClock}
              label={copy.receivable}
              value={historyAvailability.customer ? formatTotals(cockpit.receivableTotals, locale) : copy.historyUnavailable}
              hint={copy.statusLabels.unpaid}
              tone="green"
            />
            <MetricCard
              icon={CalendarClock}
              label={copy.payable}
              value={historyAvailability.expenses ? formatTotals(cockpit.payableTotals, locale) : copy.historyUnavailable}
              hint={copy.statusLabels.pending}
              tone="orange"
            />
          </section>

          <section className="surface-panel dashboard-section-panel treasury-chart-panel" aria-labelledby="treasury-chart-heading">
            <div className="dashboard-section-heading">
              <div><span className="panel-kicker">{copy.calculated}</span><h2 id="treasury-chart-heading">{copy.chartTitle}</h2></div>
              <span className="coming-soon-pill">{copy.periodLabels[periodKeys.indexOf(period)]}</span>
            </div>
            <div className="dashboard-chart-legend" aria-label={copy.chartTitle}>
              {([
                { key: "inflows" as const, label: copy.inflows, className: "inflows", available: historyAvailability.customer },
                { key: "outflows" as const, label: copy.outflows, className: "outflows", available: historyAvailability.expenses },
                { key: "balance" as const, label: copy.balance, className: "balance", available: balanceAvailable },
              ]).filter(({ key }) => key !== "balance" || balanceAvailable).map(({ key, label, className, available }) => (
                <button
                  key={key}
                  type="button"
                  className={`dashboard-chart-legend-item ${hiddenSeries.has(key) ? "is-hidden" : ""}`}
                  aria-pressed={!hiddenSeries.has(key)}
                  disabled={!available}
                  onClick={() => setHiddenSeries((current) => toggleSeries(current, key))}
                >
                  <span className={`dashboard-chart-legend-mark ${className}`} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {chartSeries.length ? (
              <div className="dashboard-chart-wrap">
                {chartSeries.map((series) => (
                  <div className="dashboard-chart-series" key={series.currency}>
                    <h3>{series.currency}</h3>
                    <DashboardCashflowChart series={series} hiddenSeries={hiddenSeries} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty-message">{copy.emptyPayments}</p>
            )}
            <p className="dashboard-note">{copy.chartNote}</p>
          </section>

          <section className="surface-panel treasury-list-panel" aria-labelledby="treasury-expected-heading">
            <div className="dashboard-section-heading">
              <div><span className="panel-kicker">{copy.setupRequired}</span><h2 id="treasury-expected-heading">{copy.expectedTitle}</h2></div>
            </div>
            <p className="treasury-section-note">{copy.expectedNote}</p>
            {expectedInvoices.length ? (
              <div className="treasury-table-scroll">
                <table className="treasury-table">
                  <thead><tr>
                    <th>{copy.type}</th><th>{copy.reference}</th><th>{copy.counterparty}</th>
                    <th>{copy.dueDate}</th><th>{copy.amount}</th><th>{copy.status}</th>
                  </tr></thead>
                  <tbody>
                    {expectedInvoices.map((invoice) => {
                      const direction = getInvoiceDirection(invoice);
                      const incoming = direction === "customer";
                      return (
                        <tr key={invoice.id}>
                          <td><span className={`treasury-movement-kind ${incoming ? "inflow" : "outflow"}`}>
                            {incoming ? copy.incoming : copy.outgoing}
                          </span></td>
                          <td><Link href={`/invoices#invoice-${invoice.id}`}>{invoice.invoiceNumber || invoice.description || copy.reference}</Link></td>
                          <td>{invoice.customerId || invoice.supplierId
                            ? counterpartyNames[invoice.customerId ?? invoice.supplierId!] ?? "—"
                            : invoice.clientName || "—"}</td>
                          <td>{formatDate(invoice.dueDate, locale) ?? copy.noDate}</td>
                          <td>{invoice.remainingAmount !== null && invoice.remainingAmount !== undefined && invoice.currency
                            ? currencyFormat(invoice.remainingAmount, invoice.currency, locale)
                            : "—"}</td>
                          <td>{statusName(invoice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="dashboard-empty-message">{copy.emptyExpected}</p>}
          </section>

          <section className="surface-panel treasury-list-panel" aria-labelledby="treasury-history-heading">
            <div className="dashboard-section-heading">
              <div><span className="panel-kicker">{copy.periodDefinition}</span><h2 id="treasury-history-heading">{copy.historyTitle}</h2></div>
            </div>
            {actualMovements.length ? (
              <div className="treasury-table-scroll">
                <table className="treasury-table">
                  <thead><tr>
                    <th>{copy.date}</th><th>{copy.reference}</th><th>{copy.type}</th>
                    <th>{copy.counterparty}</th><th>{copy.amount}</th><th>{copy.document}</th>
                  </tr></thead>
                  <tbody>
                    {actualMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{formatDate(movement.date, locale) ?? copy.noDate}</td>
                        <td><Link href={movement.href}>{movement.description}</Link></td>
                        <td><span className={`treasury-movement-kind ${movement.direction}`}>
                          {movement.direction === "inflow" ? copy.clientPayment : copy.expensePayment}
                        </span></td>
                        <td>{movement.counterparty}</td>
                        <td className={movement.direction === "inflow" ? "treasury-amount-in" : "treasury-amount-out"}>
                          {movement.direction === "inflow" ? "+" : "−"}{currencyFormat(movement.amount, movement.currency, locale)}
                        </td>
                        <td>{movement.href.startsWith("/invoices#") ? copy.seeInvoice : copy.seeExpense}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="dashboard-empty-message">
                {historyAvailability.customer && historyAvailability.expenses
                  ? copy.emptyPayments
                  : copy.historyUnavailable}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
