import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApprovedDeviation, DeviationGroup, Role } from "./api/client";

const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;

export default function Deviations({ role = "admin" }: { role?: Role }) {
  const [groups, setGroups] = useState<DeviationGroup[]>();
  const [approved, setApproved] = useState<ApprovedDeviation[]>([]);
  const [actions, setActions] = useState<Record<number, "accept" | "reject">>({});
  const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    try { setGroups((await api.deviations.list()).groups); }
    catch (next) { setError(failure("No se pudo cargar la cola de desviaciones.", next)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (role === "admin") api.approvedDeviations.listActive().then(setApproved)
      .catch((next) => setError(failure("No se pudo cargar el catálogo de desviaciones aprobadas.", next)));
  }, [role]);

  async function resolve(event: FormEvent<HTMLFormElement>, deviationId: number, inspectionId: number) {
    event.preventDefault(); setError(""); setFeedback("");
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action")) as "accept" | "reject";
    const approvedDeviationId = Number(data.get("approved_deviation_id"));
    const rejectionReason = String(data.get("rejection_reason") || "").trim();
    if (action === "accept" && !approvedDeviationId) { setError("Selecciona una desviación aprobada."); return; }
    if (action === "reject" && !rejectionReason) { setError("Escribe el motivo de rechazo."); return; }
    try {
      await api.deviations.resolve(deviationId, action === "accept"
        ? { action, approved_deviation_id: approvedDeviationId }
        : { action, rejection_reason: rejectionReason });
      const current = await api.inspections.detail(inspectionId); await load();
      setFeedback(`Disposición guardada. Estado de inspección: ${current.status}`);
    } catch (next) { setError(failure("No se pudo guardar la disposición.", next)); }
  }

  async function annul(event: FormEvent<HTMLFormElement>, inspectionId: number) {
    event.preventDefault(); setError(""); setFeedback("");
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    if (!reason) { setError("Escribe el motivo de anulación."); return; }
    try { await api.inspections.annul(inspectionId, reason); await load(); setFeedback("Inspección anulada."); }
    catch (next) { setError(failure("No se pudo anular la inspección.", next)); }
  }

  return <section><h2>Desviaciones</h2>
    {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {!groups ? <p>Cargando desviaciones…</p> : groups.length === 0 ? <p>No hay desviaciones pendientes.</p> :
      <div className="deviation-list">{groups.map(({ inspection, measurements, deviations }) => <article className="card" key={inspection.id} aria-labelledby={`inspection-${inspection.id}`}>
        <header className="queue-heading"><div><h3 id={`inspection-${inspection.id}`}>{inspection.part_number} · Inspección {inspection.id}</h3><p>Inspector: {inspection.inspector} · Estado: {inspection.status}</p>{inspection.annulled_at && <p>Anulada: {inspection.annulled_at}</p>}</div></header>
        <ul className="list">{deviations.map((deviation) => { const measurement = measurements.find((item) => item.id === deviation.measurement_id); const action = actions[deviation.id] || "accept"; return <li className={deviation.status === "PENDING" ? "deviation-pending" : undefined} key={deviation.id}><div>
          <strong>{deviation.origin === "AUTO" ? "Automática" : "Manual"} · Medición {deviation.measurement_id}</strong>
          {deviation.status === "PENDING" && <p><strong>Pendiente</strong></p>}
          {deviation.description && <p>Descripción: {deviation.description}</p>}
          {measurement && <p>Valor real: {measurement.actual_value} · Desviación: {measurement.deviation ?? "—"} · Estado: {measurement.status}</p>}
          {role === "admin" && deviation.status === "PENDING" && <form aria-label={`Resolver desviación ${deviation.id}`} noValidate onSubmit={(event) => resolve(event, deviation.id, inspection.id)} className="row">
            <label>Decisión para desviación {deviation.id}<select name="action" value={action} onChange={(event) => setActions((current) => ({ ...current, [deviation.id]: event.target.value as "accept" | "reject" }))}><option value="accept">Aceptar con desviación</option><option value="reject">Rechazar</option></select></label>
            {action === "accept" ? <label>Desviación aprobada para desviación {deviation.id}<select name="approved_deviation_id" defaultValue=""><option value="">Selecciona</option>{approved.map((entry) => <option key={entry.id} value={entry.id}>{entry.code} — {entry.description}</option>)}</select></label>
              : <label>Motivo de rechazo para desviación {deviation.id}<textarea name="rejection_reason" maxLength={500} /></label>}
            <button>Resolver desviación {deviation.id}</button>
          </form>}
        </div></li>; })}</ul>
        {role === "admin" && !inspection.annulled_at && <form aria-label={`Anular inspección ${inspection.id}`} noValidate onSubmit={(event) => annul(event, inspection.id)} className="row annul-form">
          <label>Motivo de anulación de inspección {inspection.id}<textarea name="reason" required maxLength={500} /></label>
          <button>Anular inspección {inspection.id}</button>
        </form>}
      </article>)}</div>}
  </section>;
}
