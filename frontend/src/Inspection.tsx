import { FormEvent, useEffect, useState } from "react";
import { api, Balloon, Characteristic, Inspection as InspectionData, Measurement, PartType, Role } from "./api/client";
import ReportDownload from "./ReportDownload";

const withUnit = (value: number | null, unit: string | null) => `${value ?? "—"}${unit ? ` ${unit}` : ""}`;

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
  const [history, setHistory] = useState<InspectionData[]>([]);
  useEffect(() => { api.catalog.list().then((items) => setParts(items.filter((item) => item.active))).catch(() => setError("No se pudieron cargar los tipos de pieza.")); }, []);
  useEffect(() => { api.inspections.list().then(setHistory).catch(() => setError("No se pudo cargar el historial.")); }, []);

  async function choosePart(id: number) {
    const next = parts?.find((item) => item.id === id); setPart(next); setSelected([]); setError("");
    if (!next) return;
    try {
      const [features, markers] = await Promise.all([api.catalog.characteristics(id), api.catalog.balloons(id)]);
      setCharacteristics(features); setBalloons(markers);
    } catch { setError("No se pudo cargar la información de inspección."); }
  }
  function toggle(id: number) { setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!part || !selected.length) { setError("Selecciona al menos una característica."); return; }
    const serial = String(new FormData(event.currentTarget).get("serial")).trim();
    try { setInspection(await api.inspections.start({ part_type_id: part.id, serial, characteristic_ids: selected })); setIndex(0); }
    catch { setError("No se pudo iniciar la inspección. Revisa el número de serie."); }
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
  if (inspection?.completed_at) return <section><h2>Inspección completada</h2><p className="final-status">Estado final: {inspection.status}</p>
    {error && <p role="alert">{error}</p>}<ReportDownload inspectionId={inspection.id} label="Descargar mi informe" onError={setError} />
  </section>;

  return <section><h2>Inspección</h2>{error && <p role="alert">{error}</p>}
    {history.some((item) => item.completed_at) && <ul className="list" aria-label="Inspecciones completadas">{history.filter((item) => item.completed_at).map((item) => <li key={item.id}><span>{item.serial} · {item.status}</span><ReportDownload inspectionId={item.id} label={`Descargar informe de ${item.serial}`} onError={setError} />{role === "admin" && <button onClick={async () => { const reason = prompt("Motivo de anulación"); if (reason) { await api.inspections.annul(item.id, reason); setHistory((rows) => rows.filter((row) => row.id !== item.id)); } }}>Anular {item.serial}</button>}</li>)}</ul>}
    {!inspection ? <form onSubmit={start} className="card form-grid">
      <label>Tipo de pieza activo<select value={part?.id || ""} onChange={(event) => choosePart(Number(event.target.value))} required><option value="">Selecciona</option>{parts?.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
      <label>Número de serie<input name="serial" required /></label>
      <fieldset><legend>Características a inspeccionar</legend>{characteristics.map((item) => <label key={item.id} className="check"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />{item.code} — {item.name || "Sin nombre"}</label>)}</fieldset>
      <button>Iniciar inspección</button>
    </form> : active && <>
      <div className="inspection-grid">
        <article className="card"><h3>Plano</h3>{part?.image_path ? <div className="image-map"><img src={api.catalog.imageUrl(part.id)} alt={`Plano de ${part.code}`} />{balloons.map((balloon) => <span key={balloon.id} className={`balloon ${balloon.characteristic_id === active.id ? "active" : ""}`} style={{ left: `${balloon.x * 100}%`, top: `${balloon.y * 100}%` }} aria-label={balloon.characteristic_id === active.id ? `Globo activo ${balloon.number}` : `Globo ${balloon.number}`}>{balloon.number}</span>)}</div> : <p>No hay plano disponible.</p>}</article>
        <article className="card"><h3>{active.code} — {active.name || "Sin nombre"}</h3>{active.tol_type === "SYMMETRIC" ? <><p>Nominal: {withUnit(active.nominal, active.unit)}</p><p>Tolerancia: ±{withUnit(active.tol_plus, active.unit)}</p></> : <p>Límites: {withUnit(active.min_limit, active.unit)} — {withUnit(active.max_limit, active.unit)}</p>}</article>
        <form onSubmit={record} className="card"><h3>Medición real</h3><label>Valor real{active.unit ? ` (${active.unit})` : ""}<input name="actual" type="number" step="any" inputMode="decimal" /></label><button>Registrar valor</button></form>
      </div>
      <div className="row inspection-nav"><button disabled={index === 0} onClick={() => setIndex(index - 1)}>Anterior</button><span>Característica {index + 1} de {selected.length}</span><button disabled={index === selected.length - 1} onClick={() => setIndex(index + 1)}>Siguiente</button><button onClick={complete}>Completar inspección</button></div>
      {measurements.length > 0 && <ul className="list" aria-label="Resultados registrados">{measurements.map((item) => <li key={item.id}>{characteristics.find((feature) => feature.id === item.characteristic_id)?.code}: <strong>{item.status}</strong></li>)}</ul>}
    </>}
  </section>;
}
