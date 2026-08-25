import { ChangeEvent, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { api, Characteristic, PartType, StabilityAnalysis } from "./api/client";

const formatDate = (value: string) => new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short", timeStyle: "short",
}).format(new Date(value));

export default function Stability() {
  const [parts, setParts] = useState<PartType[]>();
  const [characteristics, setCharacteristics] = useState<Characteristic[]>();
  const [partId, setPartId] = useState(0); const [characteristicId, setCharacteristicId] = useState(0);
  const [analysis, setAnalysis] = useState<StabilityAnalysis>(); const [error, setError] = useState("");
  useEffect(() => { api.catalog.list().then(setParts).catch(() => setError("No se pudieron cargar los tipos de pieza.")); }, []);

  async function selectPart(event: ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value); setPartId(id); setCharacteristicId(0); setAnalysis(undefined); setError("");
    if (!id) { setCharacteristics(undefined); return; }
    setCharacteristics(undefined);
    try { setCharacteristics(await api.catalog.characteristics(id)); }
    catch { setError("No se pudieron cargar las características del tipo de pieza."); }
  }

  async function selectCharacteristic(event: ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value); setCharacteristicId(id); setAnalysis(undefined); setError("");
    if (!id) return;
    try { setAnalysis(await api.stability.analysis(partId, id)); }
    catch { setError("No se pudo cargar el análisis de estabilidad."); }
  }

  return <section><h2>Estabilidad</h2>
    {error && <p role="alert">{error}</p>}
    {!parts ? !error && <p>Cargando tipos de pieza…</p> : <div className="row card stability-filters">
      <label>Tipo de pieza<select value={partId || ""} onChange={selectPart}><option value="">Selecciona</option>{parts.map((part) => <option value={part.id} key={part.id}>{part.part_number}</option>)}</select></label>
      <label>Característica<select value={characteristicId || ""} onChange={selectCharacteristic} disabled={!partId || !characteristics}><option value="">Selecciona</option>{characteristics?.map((item) => <option value={item.id} key={item.id}>{item.control_plan} — {item.name || "Sin nombre"}</option>)}</select></label>
    </div>}
    {parts && (!partId ? <p>Selecciona un tipo de pieza y una característica.</p> : !characteristics ? !error && <p>Cargando características…</p> : characteristics.length === 0 ? <p>Este tipo no tiene características.</p> : characteristicId && !analysis ? !error && <p>Cargando análisis…</p> : null)}
    {analysis && (analysis.points.length === 0 ? <p>No hay mediciones para esta selección.</p> : <>
      <div className="chart-scroll"><LineChart width={900} height={300} data={analysis.points} aria-label="Gráfico de tendencia">
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="completed_at" tickFormatter={formatDate} /><YAxis /><Tooltip labelFormatter={(value) => formatDate(String(value))} />
        <Line type="monotone" dataKey="actual" name="Valores reales" stroke="#2457a7" />
        {analysis.characteristic.nominal !== null && <ReferenceLine y={analysis.characteristic.nominal} label="Nominal" stroke="#526174" />}
        {analysis.characteristic.lower_limit !== null && <ReferenceLine y={analysis.characteristic.lower_limit} label="Límite inferior" stroke="#a11818" />}
        {analysis.characteristic.upper_limit !== null && <ReferenceLine y={analysis.characteristic.upper_limit} label="Límite superior" stroke="#a11818" />}
      </LineChart></div>
      <table aria-label="Mediciones cronológicas"><thead><tr><th>Inspección</th><th>Fecha</th><th>Valor real</th><th>Desviación</th><th>Estado</th></tr></thead>
        <tbody>{analysis.points.map((point) => <tr key={point.inspection_id}><td>{point.inspection_id}</td><td>{formatDate(point.completed_at)}</td><td>{point.actual}</td><td>{point.deviation ?? "—"}</td><td>{point.status}</td></tr>)}</tbody>
      </table>
    </>)}
  </section>;
}
