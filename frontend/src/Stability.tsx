import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Characteristic, PartType, StabilityAnalysis } from "./api/client";
import StatusBadge from "./StatusBadge";

const formatDate = (value: string) => new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short", timeStyle: "short",
}).format(new Date(value));

export default function Stability() {
  const [parts, setParts] = useState<PartType[]>();
  const [characteristics, setCharacteristics] = useState<Characteristic[]>();
  const [partId, setPartId] = useState(0); const [characteristicId, setCharacteristicId] = useState(0);
  const [analysis, setAnalysis] = useState<StabilityAnalysis>(); const [error, setError] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  useEffect(() => { api.catalog.list().then(setParts).catch(() => setError("No se pudieron cargar los tipos de pieza.")); }, []);

  useEffect(() => {
    if (!partId) return;
    let active = true;
    api.catalog.characteristics(partId).then((next) => { if (active) setCharacteristics(next); })
      .catch(() => { if (active) setError("No se pudieron cargar las características del tipo de pieza."); });
    return () => { active = false; };
  }, [partId]);

  useEffect(() => {
    if (!partId || !characteristicId) return;
    let active = true;
    api.stability.analysis(partId, characteristicId).then((next) => { if (active) setAnalysis(next); })
      .catch(() => { if (active) setError("No se pudo cargar el análisis de estabilidad."); });
    return () => { active = false; };
  }, [partId, characteristicId]);

  const invalidRange = Boolean(from && to && from > to);
  const start = from ? new Date(`${from}T00:00:00`) : undefined;
  const end = to ? new Date(`${to}T00:00:00`) : undefined;
  if (end) end.setDate(end.getDate() + 1);
  const points = (analysis?.points || []).filter((point) => {
    const date = new Date(point.completed_at);
    return !invalidRange && (!start || date >= start) && (!end || date < end);
  }).sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime() || a.inspection_id - b.inspection_id);
  const unit = analysis?.characteristic.unit || "sin unidad";

  return <section className="stability-page"><h2>Estabilidad</h2>
    {error && <p role="alert">{error}</p>}
    {!parts ? !error && <p>Cargando tipos de pieza…</p> : <div className="row card stability-filters">
      <label>Tipo de pieza<select value={partId || ""} onChange={(event) => { setPartId(Number(event.target.value)); setCharacteristicId(0); setCharacteristics(undefined); setAnalysis(undefined); setError(""); }}><option value="">Selecciona</option>{parts.map((part) => <option value={part.id} key={part.id}>{part.part_number}</option>)}</select></label>
      <label>Característica<select value={characteristicId || ""} onChange={(event) => { setCharacteristicId(Number(event.target.value)); setAnalysis(undefined); setError(""); }} disabled={!partId || !characteristics}><option value="">Selecciona</option>{characteristics?.map((item) => <option value={item.id} key={item.id}>{item.control_plan} — {item.name || "Sin nombre"}</option>)}</select></label>
      <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>}
    {invalidRange && <p role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>}
    {parts && (!partId ? <p>Selecciona un tipo de pieza y una característica.</p> : !characteristics ? !error && <p>Cargando características…</p> : characteristics.length === 0 ? <p>Este tipo no tiene características.</p> : characteristicId && !analysis ? !error && <p>Cargando análisis…</p> : null)}
    {analysis && (analysis.points.length === 0 ? <p>No hay mediciones para esta selección.</p> : <>
      <p className="field-help">Fechas locales, ambos días incluidos. Unidad: {unit}. Se muestran límites de tolerancia, no límites de control estadístico.</p>
      <p className="tolerance-summary">Nominal: {analysis.characteristic.nominal ?? "—"} {unit} · Tolerancia inferior: {analysis.characteristic.lower_limit ?? "—"} {unit} · Tolerancia superior: {analysis.characteristic.upper_limit ?? "—"} {unit}</p>
      <p className="summary-count">{points.length} mediciones visibles de {analysis.points.length}</p>
      {!points.length ? <p>No hay mediciones en el intervalo seleccionado.</p> : <>
      <div className="stability-chart" style={{ minWidth: 0 }}><ResponsiveContainer width="100%" height={320} minWidth={0}><LineChart data={points} aria-label="Gráfico de tendencia">
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="completed_at" tickFormatter={formatDate} /><YAxis unit={analysis.characteristic.unit ? ` ${unit}` : undefined} /><Tooltip labelFormatter={(value) => formatDate(String(value))} />
        <Line type="linear" dataKey="actual" name={`Valor real (${unit})`} stroke="#2457a7" />
        {analysis.characteristic.nominal !== null && <ReferenceLine y={analysis.characteristic.nominal} label="Nominal" stroke="#526174" />}
        {analysis.characteristic.lower_limit !== null && <ReferenceLine y={analysis.characteristic.lower_limit} label="Tolerancia inferior" stroke="#a11818" ifOverflow="extendDomain" />}
        {analysis.characteristic.upper_limit !== null && <ReferenceLine y={analysis.characteristic.upper_limit} label="Tolerancia superior" stroke="#a11818" ifOverflow="extendDomain" />}
      </LineChart></ResponsiveContainer></div>
      <div className="table-scroll"><table aria-label="Mediciones cronológicas"><thead><tr><th>Inspección</th><th>Fecha</th><th>Valor real ({unit})</th><th>Desviación ({unit})</th><th>Estado</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.inspection_id}><td>{point.inspection_id}</td><td><time dateTime={point.completed_at}>{formatDate(point.completed_at)}</time></td><td>{point.actual}</td><td>{point.deviation ?? "—"}</td><td><StatusBadge status={point.status} /></td></tr>)}</tbody>
      </table></div>
      </>}
    </>)}
  </section>;
}
