"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, BellRing, Clock3, FileCheck2, ShieldAlert } from "lucide-react";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import { buildDashboardSummary, type DashboardAction } from "@/services/dashboard";
import { getInvoiceStatusLabel } from "@/services/manual-invoice";
import type { InvoiceCompany, InvoiceRecord } from "@/types/invoice";

function alertTitle(alert: DashboardAction) {
  switch (alert.kind) {
    case "overdue": return "Facture en retard";
    case "upcoming": return "Échéance dans les 7 jours";
    case "verify": return "Vérification requise";
    case "draft": return "Brouillon à finaliser";
  }
}

function alertPriority(alert: DashboardAction) {
  if (alert.kind === "overdue" || alert.kind === "verify") return { label: "Prioritaire", tone: "danger" as const };
  if (alert.kind === "upcoming") return { label: "À suivre", tone: "warning" as const };
  return { label: "À traiter", tone: "neutral" as const };
}

function alertIcon(alert: DashboardAction) {
  switch (alert.kind) {
    case "overdue": return AlertTriangle;
    case "upcoming": return Clock3;
    case "verify": return ShieldAlert;
    case "draft": return FileCheck2;
  }
}

function formatDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatAmount(invoice: InvoiceRecord) {
  if (invoice.total === null || !Number.isFinite(invoice.total) || !invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)) {
    return "Montant/devise à vérifier";
  }
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: invoice.currency }).format(invoice.total);
  } catch {
    return "Montant/devise à vérifier";
  }
}

function daysDescription(alert: DashboardAction) {
  if (alert.daysUntilDue === null) return "Date d’échéance absente ou invalide.";
  if (alert.daysUntilDue < 0) {
    const late = Math.abs(alert.daysUntilDue);
    return `En retard de ${late} jour${late === 1 ? "" : "s"}.`;
  }
  if (alert.daysUntilDue === 0) return "Échéance aujourd’hui.";
  return `Échéance dans ${alert.daysUntilDue} jour${alert.daysUntilDue === 1 ? "" : "s"}.`;
}

export function AlertsManager({
  invoices,
  companies = [],
  loadError,
  asOfDate,
}: {
  invoices: InvoiceRecord[];
  companies?: Pick<InvoiceCompany, "id" | "name">[];
  loadError: string | null;
  asOfDate: string;
}) {
  const [companyId, setCompanyId] = useState<string | "personal" | "all">("all");
  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => companyId === "all"
      || (companyId === "personal" ? invoice.companyId === null : invoice.companyId === companyId)),
    [companyId, invoices],
  );
  const alerts = useMemo(
    () => buildDashboardSummary(visibleInvoices, asOfDate).alerts,
    [asOfDate, visibleInvoices],
  );

  return (
    <>
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Suivi opérationnel</span></div>
          <h1>Alertes</h1>
          <p>Les factures et informations qui nécessitent votre attention.</p>
        </div>
        <div className="alerts-header-actions">
          <Link className="text-button" href="/due-dates"><Clock3 size={16} />Voir les échéances</Link>
          {companies.length ? (
            <label className="dashboard-company-filter">
              <span className="sr-only">Filtrer les alertes par espace</span>
              <select aria-label="Filtrer les alertes par espace" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
                <option value="all">Tous les espaces</option>
                <option value="personal">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {loadError ? <p className="auth-message is-error invoice-message" role="alert">{loadError}</p> : null}

      {!loadError ? (
        <section className="surface-panel alerts-list-panel" aria-labelledby="alerts-list-heading">
          <div className="invoice-list-heading">
            <div><span className="panel-kicker">Priorités</span><h2 id="alerts-list-heading">À traiter</h2></div>
            <span className="coming-soon-pill">{alerts.length} alerte{alerts.length === 1 ? "" : "s"}</span>
          </div>
          {alerts.length ? (
            <div className="alerts-list">
              {alerts.map((alert) => {
                const Icon = alertIcon(alert);
                const priority = alertPriority(alert);
                const dueDate = formatDate(alert.invoice.dueDate);
                const counterparty = alert.invoice.clientName || "Tiers non renseigné";
                return (
                  <article className={`operational-alert alert-${alert.kind}`} key={alert.invoice.id}>
                    <span className={`dashboard-priority-icon ${priority.tone}`}><Icon size={17} /></span>
                    <div className="operational-alert-copy">
                      <div className="operational-alert-heading">
                        <strong>{alertTitle(alert)}</strong>
                        <Badge tone={priority.tone}>{priority.label}</Badge>
                      </div>
                      <span>{counterparty} · {alert.invoice.invoiceNumber || "Facture sans numéro"}</span>
                      <small>{alert.reason} · {daysDescription(alert)}</small>
                      {dueDate ? <small>Échéance : {dueDate}</small> : null}
                    </div>
                    <div className="operational-alert-trailing">
                      <strong>{formatAmount(alert.invoice)}</strong>
                      <small>Statut : {getInvoiceStatusLabel(alert.invoice.status)}</small>
                      <Link href={`/invoices#invoice-${alert.invoice.id}`} className="text-button">Ouvrir la facture</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<BellRing size={22} />}
              title="Aucune alerte à traiter"
              description="Aucune facture accessible ne présente actuellement d’échéance dépassée, proche, de brouillon à finaliser ou d’information nécessitant une vérification."
            />
          )}
        </section>
      ) : null}
    </>
  );
}
