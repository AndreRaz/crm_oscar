import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApprovedDeviation, DeviationGroup, Role } from "./api/client";
import StatusBadge from "./StatusBadge";

const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;
const formatDate = (value: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function Deviations({ role = "inspector" }: { role?: Role }) {
  const [groups, setGroups] = useState<DeviationGroup[]>();
  const [approved, setApproved] = useState<ApprovedDeviation[]>([]);
  const [actions, setActions] = useState<Record<number, "accept" | "reject">>({});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [inspector, setInspector] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [confirmation, setConfirmation] = useState<{ inspectionId: number; reason: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const load = useCallback(async (fallback = "No se pudo cargar la cola de desviaciones.") => {
    try {
      const next = (await api.deviations.list(true)).groups;
      setGroups(next); return next;
    } catch (next) {
      setGroups(undefined); setError(failure(fallback, next));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (role === "admin") api.approvedDeviations.listActive().then(setApproved)
      .catch((next) => setError(failure("No se pudo cargar el catálogo de desviaciones aprobadas.", next)));
  }, [role]);
  useEffect(() => {
    if (confirmation) { dialog.current?.showModal(); cancelButton.current?.focus(); }
  }, [confirmation]);

  const allGroups = groups || [];
  const invalidRange = Boolean(from && to && from > to);
  const start = from ? new Date(`${from}T00:00:00`) : undefined;
  const end = to ? new Date(`${to}T00:00:00`) : undefined;
  if (end) end.setDate(end.getDate() + 1);
  const pendingCount = allGroups.reduce((count, group) => count + group.deviations.filter((item) => item.status === "PENDING").length, 0);
  const pendingInspections = allGroups.filter((group) => group.deviations.some((item) => item.status === "PENDING")).length;
  const visibleGroups = allGroups.filter(({ inspection }) => `${inspection.part_number} ${inspection.id}`.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es"))
    && (role !== "admin" || !inspector || inspection.inspector === inspector))
    .map((group) => ({ ...group, deviations: group.deviations.filter((item) => {
      const date = new Date(item.created_at);
      return !invalidRange && (!start || date >= start) && (!end || date < end)
        && (status === "all" || (status === "history" ? item.status !== "PENDING" : item.status === status));
    }) }))
    .filter((group) => group.deviations.length);

  async function resolve(event: FormEvent<HTMLFormElement>, deviationId: number, inspectionId: number) {
    event.preventDefault();
    if (role !== "admin" || busy.current) return;
    setError(""); setFeedback("");
    const data = new FormData(event.currentTarget);
    const action = String(data.get("action")) as "accept" | "reject";
    const approvedDeviationId = Number(data.get("approved_deviation_id"));
    const rejectionReason = String(data.get("rejection_reason") || "").trim();
    if (action === "accept" && !approvedDeviationId) { setError("Selecciona una desviación aprobada."); return; }
    if (action === "reject" && !rejectionReason) { setError("Escribe el motivo de rechazo."); return; }
    busy.current = true; setSaving(true);
    try {
      await api.deviations.resolve(deviationId, action === "accept"
        ? { action, approved_deviation_id: approvedDeviationId }
        : { action, rejection_reason: rejectionReason });
      setFeedback("Disposición guardada.");
      const refreshed = await load("La disposición se guardó, pero no se pudieron actualizar las desviaciones.");
      const current = refreshed?.find((group) => group.inspection.id === inspectionId)?.inspection;
      if (current) setFeedback(`Disposición guardada. Estado de inspección: ${current.status}`);
    } catch (next) { setError(failure("No se pudo guardar la disposición.", next)); }
    finally { busy.current = false; setSaving(false); }
  }

  function requestAnnul(event: FormEvent<HTMLFormElement>, inspectionId: number) {
    event.preventDefault();
    if (role !== "admin" || busy.current) return;
    setError(""); setFeedback("");
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    if (!reason) { setError("Escribe el motivo de anulación."); return; }
    trigger.current = document.activeElement as HTMLElement;
    setConfirmation({ inspectionId, reason });
  }

  function closeConfirmation() {
    if (busy.current) return;
    dialog.current?.close(); setConfirmation(undefined); trigger.current?.focus();
  }

  async function annul() {
    if (role !== "admin" || busy.current || !confirmation) return;
    busy.current = true; setSaving(true); setError("");
    try {
      await api.inspections.annul(confirmation.inspectionId, confirmation.reason);
      setFeedback("Inspección anulada.");
      await load("La inspección se anuló, pero no se pudieron actualizar las desviaciones.");
      busy.current = false; closeConfirmation();
    } catch (next) { setError(failure("No se pudo anular la inspección.", next)); }
    finally { busy.current = false; setSaving(false); }
  }

  return <section className="deviations-page"><h2>Desviaciones</h2>
    {error && !confirmation && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    <div className="filter-bar card deviation-filters">
      <label>Buscar parte o inspección<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label>Estado de desviación<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="PENDING">Pendientes</option><option value="all">Todas</option><option value="history">Historial resuelto</option><option value="ACCEPTED">Aceptadas</option><option value="REJECTED">Rechazadas</option></select></label>
      <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      {role === "admin" && <label>Inspector<select value={inspector} onChange={(event) => setInspector(event.target.value)}><option value="">Todos</option>{[...new Set(allGroups.map((group) => group.inspection.inspector))].sort().map((name) => <option key={name}>{name}</option>)}</select></label>}
    </div>
    <p className="field-help">Fechas de creación de la desviación, en hora local; ambos días incluidos.</p>
    {invalidRange && <p role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>}
    {groups && <p className="summary-count">Desviaciones pendientes: {pendingCount} · Inspecciones con pendientes: {pendingInspections}</p>}
    {status !== "PENDING" && <p className="field-help">Historial guardado en el servidor. Las desviaciones automáticas de inspecciones anuladas no se muestran.</p>}
    {!groups && error && <button onClick={() => { setError(""); void load(); }}>Reintentar carga de desviaciones</button>}
    {!groups ? !error && <p>Cargando desviaciones…</p> : visibleGroups.length === 0 ? <p>No hay desviaciones que coincidan con los filtros.</p> :
      <div className="deviation-list" aria-busy={saving}>{visibleGroups.map(({ inspection, measurements, deviations }) => <article className="card" key={inspection.id} aria-labelledby={`inspection-${inspection.id}`}>
        <header className="queue-heading"><div><h3 id={`inspection-${inspection.id}`}>{inspection.part_number} · Inspección {inspection.id}</h3><p>Inspector: {inspection.inspector} · <StatusBadge status={inspection.status} /></p>{inspection.annulled_at && <p><StatusBadge status="ANNULLED" /> · Anulada: {formatDate(inspection.annulled_at)}</p>}</div></header>
        <ul className="list">{deviations.map((deviation) => { const measurement = measurements.find((item) => item.id === deviation.measurement_id); const action = actions[deviation.id] || "accept"; return <li className={deviation.status === "PENDING" ? "deviation-pending" : undefined} key={deviation.id}><div>
          <strong>{deviation.origin === "AUTO" ? "Automática" : "Manual"} · Medición {deviation.measurement_id}</strong>
          <p><StatusBadge status={deviation.status} /></p>
          <p>Creada: <time dateTime={deviation.created_at}>{formatDate(deviation.created_at)}</time></p>
          {deviation.description && <p>Descripción: {deviation.description}</p>}
          {measurement && <p>Valor real: {measurement.actual_value} · Desviación: {measurement.deviation ?? "—"} · <StatusBadge status={measurement.status} /></p>}
          {deviation.status === "ACCEPTED" && <p className="disposition-evidence">Catálogo aprobado: {deviation.approved_deviation_code_snapshot || "—"} — {deviation.approved_deviation_description_snapshot || "—"}</p>}
          {deviation.status === "REJECTED" && <p className="disposition-evidence">Motivo de rechazo: {deviation.rejection_reason || "—"}</p>}
          {deviation.resolved_at && <p>Resuelta: <time dateTime={deviation.resolved_at}>{formatDate(deviation.resolved_at)}</time></p>}
          {role === "admin" && deviation.status === "PENDING" && <form aria-label={`Resolver desviación ${deviation.id}`} noValidate onSubmit={(event) => resolve(event, deviation.id, inspection.id)}>
            <fieldset className="row disposition-fields" disabled={saving}><legend>Resolver desviación {deviation.id}</legend>
              <label>Decisión para desviación {deviation.id}<select name="action" value={action} onChange={(event) => setActions((current) => ({ ...current, [deviation.id]: event.target.value as "accept" | "reject" }))}><option value="accept">Aceptar con desviación</option><option value="reject">Rechazar</option></select></label>
              {action === "accept" ? <label>Desviación aprobada para desviación {deviation.id}<select name="approved_deviation_id" defaultValue=""><option value="">Selecciona</option>{approved.map((entry) => <option key={entry.id} value={entry.id}>{entry.code} — {entry.description}</option>)}</select></label>
                : <label>Motivo de rechazo para desviación {deviation.id}<textarea name="rejection_reason" maxLength={500} /></label>}
              <button>Resolver desviación {deviation.id}</button>
            </fieldset>
          </form>}
        </div></li>; })}</ul>
        {role === "admin" && inspection.completed_at && !inspection.annulled_at && <form aria-label={`Anular inspección ${inspection.id}`} noValidate onSubmit={(event) => requestAnnul(event, inspection.id)} className="annul-form">
          <fieldset className="row" disabled={saving}><legend>Anulación de inspección</legend>
            <label>Motivo de anulación de inspección {inspection.id}<textarea name="reason" required maxLength={500} /></label>
            <button className="button-danger">Anular inspección {inspection.id}</button>
          </fieldset>
        </form>}
      </article>)}</div>}
    {confirmation && <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="annul-title" aria-describedby="annul-consequence" onCancel={(event) => { event.preventDefault(); closeConfirmation(); }}>
      <h3 id="annul-title">¿Anular inspección {confirmation.inspectionId}?</h3>
      <p id="annul-consequence">La inspección quedará anulada y se excluirá del análisis de estabilidad. Sus mediciones y evidencias se conservarán. Las desviaciones manuales pendientes seguirán requiriendo resolución. Esta acción no se puede deshacer desde esta aplicación.</p>
      <p>Motivo: {confirmation.reason}</p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button ref={cancelButton} disabled={saving} onClick={closeConfirmation}>Cancelar</button><button className="button-danger" disabled={saving} onClick={annul}>{saving ? "Anulando…" : "Confirmar anulación"}</button></div>
    </dialog>}
  </section>;
}
