import { AppShell } from "@/database/components/app-shell";

export default function InvoicesLoading() {
  return (
    <AppShell pageTitle="invoices">
      <div className="page-intro invoice-page-intro">
        <div><span className="invoice-loading-line short" /><span className="invoice-loading-line" /><span className="invoice-loading-line medium" /></div>
        <span className="invoice-loading-button" />
      </div>
      <div className="invoice-summary-grid">
        {Array.from({ length: 4 }, (_, index) => <span className="invoice-loading-card" key={index} />)}
      </div>
      <div className="invoice-loading-list">
        {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
      </div>
    </AppShell>
  );
}
