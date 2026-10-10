import { AppShell } from "@/database/components/app-shell";

export default function DueDatesLoading() {
  return (
    <AppShell pageTitle="dueDates">
      <div aria-label="Chargement des échéances" aria-busy="true">
        <div className="invoice-loading-line medium" />
        <div className="deadline-loading-summary">
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
