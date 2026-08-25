import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Balloon, Characteristic, Inspection as InspectionData, Measurement, PartType, Role } from "./api/client";

const withUnit = (value: number | null, unit: string | null) => `${value ?? "—"}${unit ? ` ${unit}` : ""}`;
const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;

export default function Inspection({ role = "inspector" }: { role?: Role }) {
  const [parts, setParts] = useState<PartType[]>();
  const [part, setPart] = useState<PartType>();
  const [characteristics, setCharacteristics] = useState<Characteristic[]>([]);
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [inspection, setInspection] = useState<InspectionData>();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reported, setReported] = useState<number[]>([]);
  const [history, setHistory] = useState<InspectionData[]>([]);
  const [sharedHistory, setSharedHistory] = useState<InspectionData[]>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api.catalog.list().then((items) => setParts(items.filter((item) => item.active))).catch(() => setError("No se pudieron cargar los tipos de pieza.")); }, []);
  useEffect(() => { api.inspections.list().then(setHistory).catch(() => setError("No se pudo cargar el historial.")); }, []);
  useEffect(() => { api.inspections.list("shared").then(setSharedHistory).catch(() => setError("No se pudieron cargar las mediciones persistidas.")); }, []);
  const allSelected = characteristics.length > 0 && selected.length === characteristics.length;
  const partlySelected = selected.length > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = partlySelected; }, [partlySelected]);

  async function choosePart(id: number) {
    const next = parts?.find((item) => item.id === id); setPart(next); setSelected([]); setError("");
    if (!next) return;
    try {
      const [features, markers] = await Promise.all([api.catalog.characteristics(id), api.catalog.balloons(id)]);
      setCharacteristics(features); setBalloons(markers);
    } catch { setError("No se pudo cargar la información de inspección."); }
  }
  function toggle(id: number) { setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); }
  function toggleAll() { setSelected(allSelected ? [] : characteristics.map((item) => item.id)); }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!part || !selected.length) { setError("Selecciona al menos una característica."); return; }
    try { setInspection(await api.inspections.start({ part_type_id: part.id, characteristic_ids: selected })); setIndex(0); }
    catch { setError("No se pudo iniciar la inspección."); }
  }
  const active = characteristics.find((item) => item.id === selected[index]);
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!inspection || !active) return; setError("");
    const form = event.currentTarget; const raw = String(new FormData(form).get("actual") ?? "").trim(); const actual = Number(raw);
    if (!raw || !Number.isFinite(actual)) { setError(`Ingresa un valor numérico válido${active.unit ? ` en ${active.unit}` : ""}.`); return; }
    try {
      const saved = await api.inspections.record(inspection.id, { characteristic_id: active.id, actual_value: actual });
      setMeasurements((items) => [...items, saved]); form.reset();
      if (index < selected.length - 1) setIndex(index + 1);
    } catch { setError("No se pudo registrar el valor. Revisa el dato ingresado."); }
  }
  async function complete() {
    if (!inspection) return; setError("");
    try { setInspection(await api.inspections.complete(inspection.id)); }
    catch { setError("No se pudo completar la inspección."); }
  }
  async function reportDeviation(event: FormEvent<HTMLFormElement>, inspectionId: number, measurement: Measurement, code: string) {
    event.preventDefault(); setError(""); setFeedback("");
    const description = String(new FormData(event.currentTarget).get("description") || "").trim();
    if (!description) { setError("Describe la desviación manual antes de reportarla."); return; }
    try {
      await api.inspections.createDeviation(inspectionId, measurement.id, description);
      setReported((items) => [...items, measurement.id]);
      setFeedback(`Desviación manual reportada para ${code}.`);
    } catch (next) { setError(failure("No se pudo reportar la desviación manual.", next)); }
  }
  if (inspection?.completed_at) return <section><h2>Inspección completada</h2><p className="final-status">Estado final: {inspection.status}</p>
    {error && <p role="alert">{error}</p>}<p>Gestiona la generación y descarga desde Informes generados.</p>
  </section>;

  return <section><h2>Inspección</h2>{error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {history.some((item) => item.completed_at) && <ul className="list" aria-label="Inspecciones completadas">{history.filter((item) => item.completed_at).map((item) => <li key={item.id}><span>Inspección {item.id} · {item.status}</span>{role === "admin" && !item.annulled_at && <button onClick={async () => { const reason = prompt("Motivo de anulación"); if (reason) { await api.inspections.annul(item.id, reason); setHistory((rows) => rows.filter((row) => row.id !== item.id)); } }}>Anular inspección {item.id}</button>}</li>)}</ul>}
    {sharedHistory.some((item) => item.measurements.length) && <div aria-label="Mediciones persistidas compartidas"><h3>Mediciones persistidas</h3>{sharedHistory.filter((item) => item.measurements.length).map((item) => <article className="card" key={item.id}>
      <h4>Inspección {item.id} · {item.inspector} · {item.annulled_at ? "Anulada" : "Completada"}</h4>
      <ul className="list">{item.measurements.map((measurement) => { const code = `Medición ${measurement.id}`; return <li key={measurement.id}><div><strong>{code} · {measurement.status}</strong><p>Valor real: {measurement.actual_value} · Método: {measurement.measurement_method_snapshot || "—"}</p>{role === "inspector" && !reported.includes(measurement.id) && <form aria-label={`Reportar desviación manual de ${code}`} noValidate onSubmit={(event) => reportDeviation(event, item.id, measurement, code)} className="row"><label>Descripción de desviación manual para {code}<textarea name="description" maxLength={500} /></label><button>Reportar desviación de {code}</button></form>}</div></li>; })}</ul>
    </article>)}</div>}
    {!inspection ? <form onSubmit={start} className="card form-grid">
      <label>Tipo de pieza activo<select value={part?.id || ""} onChange={(event) => choosePart(Number(event.target.value))} required><option value="">Selecciona</option>{parts?.map((item) => <option key={item.id} value={item.id}>{item.part_number}</option>)}</select></label>
      <fieldset><legend>Características a inspeccionar</legend>{characteristics.length > 0 && <label className="check"><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />Seleccionar todas las características</label>}{characteristics.map((item) => <label key={item.id} className="check"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />{item.control_plan} — {item.name || "Sin nombre"}</label>)}</fieldset>
      <button>Iniciar inspección</button>
    </form> : active && <>
      <div className="inspection-grid">
        <article className="card"><h3>Plano</h3>{part?.image_path ? <div className="image-map"><img src={api.catalog.imageUrl(part.id)} alt={`Plano de ${part.part_number}`} />{balloons.map((balloon) => { const marker = characteristics.find((item) => item.id === balloon.characteristic_id)?.control_plan || "Sin característica"; const activeMarker = balloon.characteristic_id === active.id; return <span key={balloon.id} className={`balloon ${activeMarker ? "active" : ""}`} style={{ left: `${balloon.x * 100}%`, top: `${balloon.y * 100}%` }} aria-label={activeMarker ? `Marcador C.P. activo ${marker}` : `Marcador C.P. ${marker}`}>{marker}</span>; })}</div> : <p>No hay plano disponible.</p>}</article>
        <article className="card"><h3>{active.control_plan} — {active.name || "Sin nombre"}</h3><p>Nominal: {withUnit(active.nominal, active.unit)}</p><p>Límites: {withUnit(active.min_limit, active.unit)} — {withUnit(active.max_limit, active.unit)}</p><p>Método: {active.measurement_method}</p></article>
        <form onSubmit={record} className="card"><h3>Medición real</h3><label>Valor real{active.unit ? ` (${active.unit})` : ""}<input name="actual" type="number" step="any" inputMode="decimal" /></label><button>Registrar valor</button></form>
      </div>
      <div className="row inspection-nav"><button disabled={index === 0} onClick={() => setIndex(index - 1)}>Anterior</button><span>Característica {index + 1} de {selected.length}</span><button disabled={index === selected.length - 1} onClick={() => setIndex(index + 1)}>Siguiente</button><button onClick={complete}>Completar inspección</button></div>
      {measurements.length > 0 && <ul className="list" aria-label="Resultados registrados">{measurements.map((item) => { const feature = characteristics.find((candidate) => candidate.id === item.characteristic_id); const code = feature?.control_plan || `Medición ${item.id}`; return <li key={item.id}><div><strong>{code}: <span>{item.status}</span></strong><p>Método registrado: {item.measurement_method_snapshot || "—"} · Nominal: {withUnit(item.nominal_snapshot ?? null, feature?.unit || null)} · Límites: {withUnit(item.min_limit_snapshot ?? null, feature?.unit || null)} — {withUnit(item.max_limit_snapshot ?? null, feature?.unit || null)}</p>{role === "inspector" && !reported.includes(item.id) && <form aria-label={`Reportar desviación manual de ${code}`} noValidate onSubmit={(event) => reportDeviation(event, inspection.id, item, code)} className="row"><label>Descripción de desviación manual para {code}<textarea name="description" maxLength={500} /></label><button>Reportar desviación de {code}</button></form>}</div></li>; })}</ul>}
    </>}
  </section>;
}
