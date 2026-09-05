const statuses: Record<string, [string, string]> = {
  CONFORMING: ["Conforme", "ok"],
  IN_TOLERANCE: ["En tolerancia", "ok"],
  PENDING: ["Pendiente", "warning"],
  ACCEPTED: ["Aceptada", "accepted"],
  DEVIATION_ACCEPTED: ["Desviación aceptada", "accepted"],
  ACCEPTED_WITH_DEVIATIONS: ["Aceptada con desviaciones", "accepted"],
  REJECTED: ["Rechazado", "danger"],
  ANNULLED: ["Anulado", "muted"],
};

export default function StatusBadge({ status }: { status: string }) {
  const [label, tone] = statuses[status] ?? [status, "muted"];
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}
