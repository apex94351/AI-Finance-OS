export default function DashboardLoading() {
  return (
    <div className="dashboard-loading" role="status" aria-label="Chargement du tableau de bord" aria-busy="true">
      <div className="dashboard-loading-kpis" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div className="dashboard-loading-card" key={index} />)}
      </div>
      <div className="dashboard-loading-main" aria-hidden="true">
        <div className="dashboard-loading-panel">
          <div className="dashboard-loading-line" />
          <div className="dashboard-loading-line" />
          <div className="dashboard-loading-line" />
        </div>
        <div className="dashboard-loading-panel">
          <div className="dashboard-loading-line" />
          <div className="dashboard-loading-line" />
          <div className="dashboard-loading-line" />
        </div>
      </div>
      <span className="sr-only">Chargement du tableau de bord financier…</span>
    </div>
  );
}
