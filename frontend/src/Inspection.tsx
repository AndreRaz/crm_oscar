import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Balloon, Characteristic, Inspection as InspectionData, Measurement, PartType, Role } from "./api/client";
import DrawingViewer from "./DrawingViewer";
import StatusBadge from "./StatusBadge";

const withUnit = (value: number | null, unit: string | null) => `${value ?? "—"}${unit ? ` ${unit}` : ""}`;
const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;
const draftKey = (id: number) => `inspection-draft:${id}`;
const firstMissing = (item: InspectionData) => Math.max(0, item.characteristic_ids.findIndex((id) => !item.measurements.some((measurement) => measurement.characteristic_id === id)));

export default function Inspection({ role = "inspector", onNavigate }: { role?: Role; onNavigate?: (page: "reports" | "deviations") => void }) {
  const [tab, setTab] = useState<"workspace" | "history">("workspace");
  const [parts, setParts] = useState<PartType[]>([]);
  const [part, setPart] = useState<PartType>();
  const [characteristics, setCharacteristics] = useState<Characteristic[]>([]);
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [inspection, setInspection] = useState<InspectionData>();
  const [index, setIndex] = useState(0);
  const [actual, setActual] = useState("");
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [reported, setReported] = useState<number[]>([]);
  const [history, setHistory] = useState<InspectionData[]>([]);
  const [sharedHistory, setSharedHistory] = useState<InspectionData[]>([]);
  const [annulId, setAnnulId] = useState<number>();
  const [annulReason, setAnnulReason] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const locked = useRef(false);
  const mounted = useRef(true);
  const measurements = inspection?.measurements ?? [];
  const active = characteristics.find((item) => item.id === selected[index]);
  const measuredIds = new Set(measurements.map((item) => item.characteristic_id));
  const missing = selected.filter((id) => !measuredIds.has(id));
  const allSelected = characteristics.length > 0 && selected.length === characteristics.length;
  const partlySelected = selected.length > 0 && !allSelected;

  useEffect(() => {
    mounted.current = true;
    api.catalog.list().then((items) => { if (mounted.current) setParts(items); }).catch(() => { if (mounted.current) setError("No se pudieron cargar los tipos de pieza."); });
    api.inspections.list().then((items) => { if (mounted.current) setHistory(items); }).catch(() => { if (mounted.current) setError("No se pudieron cargar las inspecciones pendientes. Recarga para reintentar."); });
    return () => { mounted.current = false; requestVersion.current++; };
  }, []);
  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    api.inspections.list("shared").then((items) => { if (!cancelled) setSharedHistory(items); }).catch(() => { if (!cancelled) setError("No se pudieron cargar las mediciones persistidas."); });
    return () => { cancelled = true; };
  }, [tab]);
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = partlySelected; }, [partlySelected, tab, inspection]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (actual || locked.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [actual]);

  function begin(message: string) {
    if (locked.current) return false;
    locked.current = true; setBusy(message); setError(""); setFeedback(""); return true;
  }
  function finish() { locked.current = false; if (mounted.current) setBusy(""); }
  function remember(item: InspectionData) {
    setInspection(item);
    setHistory((rows) => [item, ...rows.filter((row) => row.id !== item.id)]);
  }
  function clearDraft(id: number) {
    try { sessionStorage.removeItem(draftKey(id)); } catch { /* Storage may be unavailable. */ }
    setActual("");
  }
  function editActual(value: string) {
    setActual(value);
    if (!inspection || !active) return;
    try {
      if (value) sessionStorage.setItem(draftKey(inspection.id), JSON.stringify({ characteristicId: active.id, value }));
      else sessionStorage.removeItem(draftKey(inspection.id));
    } catch { setError("El borrador no se puede guardar en este navegador. Guarda el valor antes de salir."); }
  }
  function canNavigate() {
    if (locked.current) return false;
    if (actual) { setError("Hay un valor sin guardar. Regístralo o descarta el valor antes de cambiar de vista o característica."); return false; }
    setError(""); return true;
  }
  async function checkRevision(item: InspectionData) {
    const revisions = await api.catalog.revisions(item.part_type_id);
    const latest = revisions.reduce<(typeof revisions)[number] | undefined>((current, revision) => !current || revision.revision_no > current.revision_no ? revision : current, undefined);
    if (!latest) throw new Error("No se puede verificar la revisión de esta pieza. No se registrarán mediciones.");
    if (latest.id !== item.part_revision_id) throw new Error("La revisión de la pieza cambió desde el inicio. No se puede continuar con las tolerancias actuales. Las mediciones guardadas se conservan; inicia una nueva inspección o consulta al administrador.");
  }
  async function openInspection(item: InspectionData) {
    remember(item); setSelected(item.characteristic_ids); setIndex(firstMissing(item)); setActual("");
    setCharacteristics([]); setBalloons([]); setPart(undefined); setBlocked("");
    if (item.completed_at || item.annulled_at) return;
    try {
      await checkRevision(item);
      const [catalog, features, markers] = await Promise.all([api.catalog.list(), api.catalog.characteristics(item.part_type_id), api.catalog.balloons(item.part_type_id)]);
      await checkRevision(item);
      if (!mounted.current) return;
      const currentPart = catalog.find((candidate) => candidate.id === item.part_type_id);
      if (!currentPart || !currentPart.active) throw new Error("La pieza no está disponible o está inactiva. No se puede continuar esta inspección.");
      const unavailable = item.characteristic_ids.filter((id) => !features.some((feature) => feature.id === id));
      if (unavailable.length) throw new Error(`Características no disponibles o eliminadas: ${unavailable.join(", ")}. No se puede continuar; las mediciones guardadas se conservan.`);
      setParts(catalog); setPart(currentPart); setCharacteristics(features); setBalloons(markers);
      try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey(item.id)) || "null");
        if (draft && typeof draft.value === "string" && item.characteristic_ids.includes(draft.characteristicId) && !item.measurements.some((measurement) => measurement.characteristic_id === draft.characteristicId)) {
          setIndex(item.characteristic_ids.indexOf(draft.characteristicId)); setActual(draft.value);
          setFeedback("Borrador recuperado. Este valor todavía no está registrado.");
        } else sessionStorage.removeItem(draftKey(item.id));
      } catch { /* Server measurements remain authoritative without local storage. */ }
    } catch (next) { if (mounted.current) setBlocked(failure("Inspección bloqueada.", next)); }
  }
  async function choosePart(id: number) {
    if (locked.current) return;
    const version = ++requestVersion.current;
    const next = parts.find((item) => item.id === id);
    setPart(next); setSelected([]); setCharacteristics([]); setBalloons([]); setError(""); setCatalogLoading(Boolean(next));
    if (!next) return;
    try {
      const [features, markers] = await Promise.all([api.catalog.characteristics(id), api.catalog.balloons(id)]);
      if (version !== requestVersion.current || !mounted.current) return;
      setCharacteristics(features); setBalloons(markers);
    } catch { if (version === requestVersion.current && mounted.current) setError("No se pudo cargar la información de inspección. Selecciona la pieza para reintentar."); }
    finally { if (version === requestVersion.current && mounted.current) setCatalogLoading(false); }
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!part || !selected.length || catalogLoading || inspection) { setError("Selecciona al menos una característica disponible."); return; }
    if (!begin("Iniciando inspección…")) return;
    ++requestVersion.current;
    try {
      const item = await api.inspections.start({ part_type_id: part.id, characteristic_ids: selected });
      if (mounted.current) await openInspection(item);
    } catch (next) { if (mounted.current) setError(failure("No se pudo iniciar la inspección.", next)); }
    finally { finish(); }
  }
  async function resume(id: number) {
    if (!canNavigate() || !begin("Recuperando inspección…")) return;
    ++requestVersion.current; setCatalogLoading(false);
    try { const item = await api.inspections.detail(id); if (mounted.current) await openInspection(item); }
    catch (next) { if (mounted.current) setError(failure("No se pudo recuperar la inspección. Reintenta continuar.", next)); }
    finally { finish(); }
  }
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inspection || !active || blocked || inspection.completed_at || inspection.annulled_at || measuredIds.has(active.id)) return;
    const value = Number(actual.trim());
    if (!actual.trim() || !Number.isFinite(value)) { setError(`Ingresa un valor numérico válido${active.unit ? ` en ${active.unit}` : ""}.`); return; }
    if (!begin("Guardando medición…")) return;
    try {
      const current = await api.inspections.detail(inspection.id);
      if (!mounted.current) return;
      remember(current);
      if (current.completed_at || current.annulled_at) throw new Error("Esta inspección ya está cerrada.");
      if (current.measurements.some((item) => item.characteristic_id === active.id)) {
        clearDraft(current.id); setIndex(firstMissing(current)); setError("Esta característica ya fue medida. No se envió el valor ingresado; se recuperó el valor guardado en el servidor."); return;
      }
      try { await checkRevision(current); }
      catch (next) { if (mounted.current) setBlocked(failure("Inspección bloqueada.", next)); return; }
      if (!mounted.current) return;
      const saved = await api.inspections.record(current.id, { characteristic_id: active.id, actual_value: value });
      if (!mounted.current) return;
      const updated = { ...current, measurements: [...current.measurements, saved] };
      remember(updated); clearDraft(current.id); setIndex(firstMissing(updated)); setFeedback("Medición guardada.");
    } catch (next) { if (mounted.current) setError(failure("No se pudo registrar el valor. El dato ingresado se conserva.", next)); }
    finally { finish(); }
  }
  async function complete() {
    if (!inspection || blocked || !selected.length || missing.length || actual || inspection.completed_at || inspection.annulled_at || !begin("Completando inspección…")) return;
    try {
      const current = await api.inspections.detail(inspection.id);
      if (!mounted.current) return;
      remember(current);
      if (current.completed_at || current.annulled_at) return;
      if (current.characteristic_ids.some((id) => !current.measurements.some((item) => item.characteristic_id === id))) throw new Error("Faltan características por medir. Continúa antes de completar.");
      try { await checkRevision(current); }
      catch (next) { if (mounted.current) setBlocked(failure("Inspección bloqueada.", next)); return; }
      if (!mounted.current) return;
      const completed = await api.inspections.complete(current.id);
      if (mounted.current) { remember(completed); clearDraft(current.id); }
    } catch (next) { if (mounted.current) setError(failure("No se pudo completar la inspección.", next)); }
    finally { finish(); }
  }
  async function reportDeviation(event: FormEvent<HTMLFormElement>, inspectionId: number, measurement: Measurement, code: string) {
    event.preventDefault();
    if (role !== "inspector" || reported.includes(measurement.id)) return;
    const description = String(new FormData(event.currentTarget).get("description") || "").trim();
    if (!description) { setError("Describe la desviación manual antes de reportarla."); return; }
    if (!begin("Reportando desviación…")) return;
    try {
      await api.inspections.createDeviation(inspectionId, measurement.id, description);
      if (mounted.current) { setReported((items) => [...items, measurement.id]); setFeedback(`Desviación manual reportada para ${code}.`); }
    } catch (next) { if (mounted.current) setError(failure("No se pudo reportar la desviación manual.", next)); }
    finally { finish(); }
  }
  async function annul(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role !== "admin" || annulId === undefined) return;
    if (!annulReason.trim()) { setError("Indica el motivo de anulación."); return; }
    if (!begin("Anulando inspección…")) return;
    try {
      const item = await api.inspections.annul(annulId, annulReason.trim());
      if (mounted.current) {
        setHistory((rows) => rows.map((row) => row.id === item.id ? item : row));
        setSharedHistory((rows) => rows.map((row) => row.id === item.id ? item : row));
        setAnnulId(undefined); setAnnulReason(""); setFeedback("Inspección anulada. Se conserva la evidencia histórica.");
      }
    } catch (next) { if (mounted.current) setError(failure("No se pudo anular la inspección.", next)); }
    finally { finish(); }
  }
  function reset() {
    if (!canNavigate()) return;
    ++requestVersion.current; setInspection(undefined); setPart(undefined); setCharacteristics([]); setBalloons([]); setSelected([]); setBlocked(""); setFeedback(""); setCatalogLoading(false); setIndex(0);
  }
  function move(next: number) { if (next >= 0 && next < selected.length && next !== index && canNavigate()) setIndex(next); }
  function deviationForm(inspectionId: number, measurement: Measurement, code: string) {
    return role === "inspector" && !reported.includes(measurement.id) && <form aria-label={`Reportar desviación manual de ${code}`} noValidate onSubmit={(event) => reportDeviation(event, inspectionId, measurement, code)} className="row"><label>Descripción de desviación manual para {code}<textarea name="description" maxLength={500} disabled={Boolean(busy)} /></label><button disabled={Boolean(busy)}>Reportar desviación de {code}</button></form>;
  }

  return <section className="inspection-workspace"><h2>Inspección</h2>
    <div className="tabs" role="tablist" aria-label="Vistas de inspección">
      <button role="tab" aria-selected={tab === "workspace"} disabled={Boolean(busy)} onClick={() => { if (canNavigate()) setTab("workspace"); }}>Inspeccionar</button>
      <button role="tab" aria-selected={tab === "history"} disabled={Boolean(busy)} onClick={() => { if (canNavigate()) setTab("history"); }}>Historial</button>
    </div>
    {error && <p role="alert">{error}</p>}{(busy || feedback) && <p role="status">{busy || feedback}</p>}
    {actual && inspection && <div className="inspection-draft"><p>Valor sin guardar. Se conserva como borrador en este navegador, no como medición.</p><button disabled={Boolean(busy)} onClick={() => { clearDraft(inspection.id); setError(""); }}>Descartar valor sin guardar</button></div>}
    {tab === "history" ? <div className="inspection-history">
      <h3>Historial de inspecciones</h3>
      {history.some((item) => item.completed_at) && <ul className="list" aria-label="Inspecciones completadas">{history.filter((item) => item.completed_at).map((item) => <li key={item.id}><span>Inspección {item.id} · <StatusBadge status={item.annulled_at ? "ANNULLED" : item.status} /></span>{role === "admin" && !item.annulled_at && <button disabled={Boolean(busy)} onClick={() => { setAnnulId(item.id); setAnnulReason(""); }}>Anular inspección {item.id}</button>}</li>)}</ul>}
      {annulId !== undefined && role === "admin" && <form className="card form-grid" aria-label="Confirmar anulación" noValidate onSubmit={annul}><h4>Anular inspección {annulId}</h4><p>La anulación conserva las mediciones históricas.</p><label>Motivo de anulación<textarea value={annulReason} onChange={(event) => setAnnulReason(event.target.value)} required maxLength={500} disabled={Boolean(busy)} /></label><div className="row"><button disabled={Boolean(busy) || !annulReason.trim()}>Confirmar anulación</button><button type="button" disabled={Boolean(busy)} onClick={() => setAnnulId(undefined)}>Cancelar anulación</button></div></form>}
      <div aria-label="Mediciones persistidas compartidas"><h3>Mediciones persistidas</h3>{!sharedHistory.some((item) => item.measurements.length) && <p>No hay mediciones históricas disponibles.</p>}{sharedHistory.filter((item) => item.measurements.length).map((item) => <article className="card" key={item.id}>
        <h4>Inspección {item.id} · {item.inspector} · {item.annulled_at ? "Anulada" : "Completada"}</h4>
        <ul className="list">{item.measurements.map((measurement) => { const code = `Medición ${measurement.id}`; return <li key={measurement.id}><div><strong>{code} · <StatusBadge status={measurement.status} /></strong><p>Valor real: {measurement.actual_value} · Método: {measurement.measurement_method_snapshot || "—"}</p>{deviationForm(item.id, measurement, code)}</div></li>; })}</ul>
      </article>)}</div>
    </div> : inspection?.completed_at ? <div className="card inspection-completion"><h3>Inspección completada</h3><p className="final-status">Estado final: <StatusBadge status={inspection.status} /></p><p>Gestiona la generación y descarga desde Informes generados.</p><div className="row"><button onClick={reset}>Nueva inspección</button>{onNavigate && <button onClick={() => { if (canNavigate()) onNavigate("reports"); }}>Ver informes generados</button>}</div></div> : !inspection ? <>
      <div className="inspection-pending"><h3>Inspecciones pendientes</h3>{!history.some((item) => !item.completed_at && !item.annulled_at) && <p>No hay inspecciones pendientes.</p>}<ul className="list" aria-label="Inspecciones pendientes">{history.filter((item) => !item.completed_at && !item.annulled_at).map((item) => <li key={item.id}><span>Inspección {item.id} · {parts.find((candidate) => candidate.id === item.part_type_id)?.part_number || `Pieza ${item.part_type_id}`} · {item.characteristic_ids.filter((id) => item.measurements.some((measurement) => measurement.characteristic_id === id)).length}/{item.characteristic_ids.length} medidas</span><button disabled={Boolean(busy)} aria-label={`Continuar inspección ${item.id}`} onClick={() => resume(item.id)}>Continuar inspección</button></li>)}</ul></div>
      <form onSubmit={start} className="card form-grid" aria-label="Nueva inspección">
        <label>Tipo de pieza activo<select value={part?.id || ""} onChange={(event) => choosePart(Number(event.target.value))} disabled={Boolean(busy)} required><option value="">Selecciona</option>{parts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.part_number}</option>)}</select></label>
        {catalogLoading && <p role="status">Cargando características…</p>}
        <fieldset disabled={Boolean(busy) || catalogLoading}><legend>Características a inspeccionar</legend>{characteristics.length > 0 && <label className="check"><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : characteristics.map((item) => item.id))} />Seleccionar todas las características</label>}{characteristics.map((item) => <label key={item.id} className="check"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} />{item.control_plan} — {item.name || "Sin nombre"}</label>)}</fieldset>
        <button disabled={Boolean(busy) || catalogLoading || !selected.length}>Iniciar inspección</button>
      </form>
    </> : <>
      <div className="inspection-progress"><h3>Inspección {inspection.id}{part ? ` · ${part.part_number}` : ""}</h3><p>{selected.length - missing.length}/{selected.length} características medidas</p><progress aria-label="Progreso de inspección" value={selected.length - missing.length} max={selected.length || 1} /><p>{missing.length ? `Faltan por medir: ${missing.map((id) => characteristics.find((item) => item.id === id)?.control_plan || `Característica ${id}`).join(", ")}` : "Todas las características seleccionadas están medidas."}</p></div>
      {blocked && <p role="alert">{blocked}</p>}{inspection.annulled_at && <p role="alert">Esta inspección está anulada y no admite mediciones.</p>}
      {!blocked && !inspection.annulled_at && !busy.includes("Recuperando") && !busy.includes("Iniciando") && <div className="inspection-grid">
        <article className="card inspection-drawing"><h3>Plano</h3>{part?.image_path ? <DrawingViewer src={api.catalog.imageUrl(part.id)} alt={`Plano de ${part.part_number}`} balloons={balloons.filter((item) => selected.includes(item.characteristic_id))} characteristics={characteristics} activeId={active?.id} onSelect={(id) => move(selected.indexOf(id))} /> : <p>No hay plano disponible.</p>}</article>
        <aside className="card inspection-panel"><label>Característica seleccionada<select value={selected[index] ?? ""} disabled={Boolean(busy)} onChange={(event) => move(selected.indexOf(Number(event.target.value)))}>{selected.map((id) => <option key={id} value={id}>{characteristics.find((item) => item.id === id)?.control_plan || `Característica ${id}`} · {measuredIds.has(id) ? "Medida" : "Pendiente"}</option>)}</select></label>
          {active && <><h3>{active.control_plan} — {active.name || "Sin nombre"}</h3><p>Nominal: {withUnit(active.nominal, active.unit)}</p><p>Límites: {withUnit(active.min_limit, active.unit)} — {withUnit(active.max_limit, active.unit)}</p><p>Método: {active.measurement_method}</p>
            {measuredIds.has(active.id) ? <p>Valor ya registrado: {measurements.find((item) => item.characteristic_id === active.id)?.actual_value}. No se puede volver a medir esta característica.</p> : <form onSubmit={record} aria-label="Registrar medición" noValidate><h3>Medición real</h3><label>Valor real{active.unit ? ` (${active.unit})` : ""}<input name="actual" type="number" step="any" inputMode="decimal" value={actual} onChange={(event) => editActual(event.target.value)} disabled={Boolean(busy)} /></label><button disabled={Boolean(busy)}>Registrar valor</button></form>}
          </>}
        </aside>
      </div>}
      <div className="row inspection-nav"><button disabled={Boolean(busy) || Boolean(blocked) || index === 0} onClick={() => move(index - 1)}>Anterior</button><span>Característica {index + 1} de {selected.length}</span><button disabled={Boolean(busy) || Boolean(blocked) || index >= selected.length - 1} onClick={() => move(index + 1)}>Siguiente</button><button disabled={Boolean(busy) || Boolean(blocked) || Boolean(inspection.annulled_at) || !selected.length || Boolean(missing.length) || Boolean(actual)} onClick={complete}>Completar inspección</button><button disabled={Boolean(busy)} onClick={reset}>Volver a pendientes</button></div>
      {measurements.length > 0 && <details className="inspection-results"><summary>Resultados registrados ({measurements.length})</summary><ul className="list" aria-label="Resultados registrados">{measurements.map((item) => { const feature = characteristics.find((candidate) => candidate.id === item.characteristic_id); const code = feature?.control_plan || `Medición ${item.id}`; return <li key={item.id}><div><strong>{code}: <StatusBadge status={item.status} /></strong><p>Valor real registrado: {item.actual_value}</p><p>Método registrado: {item.measurement_method_snapshot || "—"} · Nominal: {withUnit(item.nominal_snapshot ?? null, feature?.unit || null)} · Límites: {withUnit(item.min_limit_snapshot ?? null, feature?.unit || null)} — {withUnit(item.max_limit_snapshot ?? null, feature?.unit || null)}</p>{deviationForm(inspection.id, item, code)}</div></li>; })}</ul></details>}
    </>}
  </section>;
}
