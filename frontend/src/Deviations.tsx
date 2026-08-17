import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, DeviationGroup } from "./api/client";
import ReportDownload from "./ReportDownload";

const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;

export default function Deviations() {
  const [groups, setGroups] = useState<DeviationGroup[]>();
  const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    try { setGroups((await api.deviations.list()).groups); }
    catch (next) { setError(failure("No se pudo cargar la cola de desviaciones.", next)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function dispose(event: FormEvent<HTMLFormElement>, measurementId: number, inspectionId: number) {
    event.preventDefault(); setError(""); setFeedback("");
    const data = new FormData(event.currentTarget); const text = String(data.get("text") || "").trim();
    if (!text) { setError("Escribe una nota o motivo para guardar la disposición."); return; }
    try {
      await api.deviations.dispose(measurementId, { action: String(data.get("action")) as "accept" | "reject", text });
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
      <div className="deviation-list">{groups.map(({ inspection, measurements }) => <article className="card" key={inspection.id} aria-labelledby={`inspection-${inspection.id}`}>
        <header className="queue-heading"><div><h3 id={`inspection-${inspection.id}`}>{inspection.part_type_code} · {inspection.serial}</h3><p>Inspector: {inspection.inspector} · Estado: {inspection.status}</p></div>
          <ReportDownload inspectionId={inspection.id} label={`Descargar informe de ${inspection.serial}`} onError={setError} /></header>
        <ul className="list">{measurements.map((measurement) => <li key={measurement.id}><div>
          <strong>Medición {measurement.id}</strong><p>Valor real: {measurement.actual_value} · Desviación: {measurement.deviation ?? "—"} · Estado: {measurement.status}</p>
          <form aria-label={`Disponer medición ${measurement.id}`} onSubmit={(event) => dispose(event, measurement.id, inspection.id)} className="row">
            <label>Decisión para medición {measurement.id}<select name="action"><option value="accept">Aceptar con desviación</option><option value="reject">Rechazar</option></select></label>
            <label>Nota o motivo de la medición {measurement.id}<textarea name="text" required maxLength={500} /></label>
            <button>Guardar disposición de medición {measurement.id}</button>
          </form>
        </div></li>)}</ul>
        <form aria-label={`Anular inspección ${inspection.serial}`} onSubmit={(event) => annul(event, inspection.id)} className="row annul-form">
          <label>Motivo de anulación de {inspection.serial}<textarea name="reason" required maxLength={500} /></label>
          <button>Anular inspección {inspection.serial}</button>
        </form>
      </article>)}</div>}
  </section>;
}
