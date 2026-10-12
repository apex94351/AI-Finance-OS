import { AppShell } from "@/database/components/app-shell";

export default function TreasuryLoading() {
  return (
    <AppShell pageTitle="treasury">
      <div aria-label="Chargement de la trésorerie" aria-busy="true">
        <div className="invoice-loading-line medium" />
        <div className="deadline-loading-summary">
          <div className="invoice-loading-card" />
          <div className="invoice-loading-card" />
          <div className="invoice-loading-card" />
        </div>
        <div className="invoice-loading-list deadline-loading-list">
          <span /><span /><span /><span />
        </div>
      </div>
    </AppShell>
  );
}
