export default function AlertsLoading() {
  return (
    <div className="surface-panel alerts-list-panel" role="status" aria-label="Chargement des alertes" aria-busy="true">
      <span className="panel-kicker">Suivi opérationnel</span>
      <h1 className="sr-only">Chargement des alertes</h1>
      <div className="alerts-loading-list" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
      </div>
      <span className="sr-only">Chargement des alertes opérationnelles…</span>
    </div>
  );
}
