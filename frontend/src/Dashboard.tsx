import { useEffect, useState } from "react";
import { api, DeviationGroup, Inspection, PartType, User } from "./api/client";
import { reportRequirements } from "./reportEligibility";
import StatusBadge from "./StatusBadge";

export default function Dashboard({ user, onNavigate }: { user: User; onNavigate: (page: "inspection" | "deviations" | "reports" | "catalog") => void }) {
  const [data, setData] = useState<{ inspections: Inspection[]; parts: PartType[]; groups: DeviationGroup[] }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([api.inspections.list(), api.catalog.list(), api.deviations.list()])
      .then(([inspections, parts, queue]) => { if (active) setData({ inspections, parts, groups: queue.groups }); })
      .catch(() => { if (active) setError("No se pudo cargar el resumen de trabajo."); });
    return () => { active = false; };
  }, [attempt]);
  const pending = data?.inspections.filter((item) => !item.completed_at && !item.annulled_at) ?? [];
  const pendingIds = new Set(data?.groups.filter((group) => group.deviations.some((item) => item.status === "PENDING")).map((group) => group.inspection.id));
  const deviationCount = data?.groups.reduce((count, group) => count + group.deviations.filter((item) => item.status === "PENDING").length, 0) ?? 0;
  const ready = data?.inspections.filter((item) => !reportRequirements(item, data.parts.find((part) => part.id === item.part_type_id), pendingIds).length) ?? [];

  return <section className="dashboard">
    <div className="page-heading"><div><p className="eyebrow">CONTROL DIMENSIONAL</p><h2>Tu jornada, de un vistazo</h2><p>{user.username}, continúa una inspección o atiende los pendientes de calidad.</p></div><button className="button-primary" onClick={() => onNavigate("inspection")}>Nueva inspección</button></div>
    {error ? <div className="card"><p role="alert">{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Reintentar resumen</button></div> : !data ? <p role="status">Cargando resumen…</p> : <>
      <div className="dashboard-metrics">
        <button className="metric-card" onClick={() => onNavigate("inspection")}><span>Por continuar</span><strong>{pending.length}</strong><small>Inspecciones sin finalizar</small></button>
        <button className="metric-card metric-warning" onClick={() => onNavigate("deviations")}><span>Desviaciones pendientes</span><strong>{deviationCount}</strong><small>{user.role === "admin" ? "Revisar y resolver" : "Consultar cola compartida"}</small></button>
        <button className="metric-card" onClick={() => onNavigate("reports")}><span>Listas para informe</span><strong>{ready.length}</strong><small>Con requisitos completos</small></button>
      </div>
      <p className="field-help">{user.role === "admin" ? "Inspecciones de todos los inspectores." : "Tus inspecciones e informes. La cola de desviaciones es compartida."} Los requisitos se vuelven a validar al generar cada informe.</p>
      <div className="dashboard-columns"><section className="card"><h3>Retoma el trabajo</h3>{pending.length ? <ul className="list">{pending.slice(0, 5).map((item) => <li key={item.id}><div><strong>{data.parts.find((part) => part.id === item.part_type_id)?.part_number || "Parte no disponible"}</strong><p>Inspección {item.id} · {item.inspector}</p><small>{item.characteristic_ids.filter((id) => item.measurements.some((measurement) => measurement.characteristic_id === id)).length} de {item.characteristic_ids.length} características medidas</small></div><button onClick={() => onNavigate("inspection")}>Ver pendientes</button></li>)}</ul> : <p>No tienes inspecciones por continuar. Puedes iniciar una desde el catálogo de piezas activas.</p>}</section>
        <section className="card"><h3>Últimas inspecciones completadas</h3>{data.inspections.some((item) => item.completed_at) ? <ul className="list">{data.inspections.filter((item) => item.completed_at).slice(0, 5).map((item) => <li key={item.id}><div><strong>Inspección {item.id}</strong><p>{data.parts.find((part) => part.id === item.part_type_id)?.part_number}</p></div><StatusBadge status={item.annulled_at ? "ANNULLED" : item.status} /></li>)}</ul> : <p>Aún no hay inspecciones completadas.</p>}<button onClick={() => onNavigate("reports")}>Abrir informes</button></section></div>
    </>}
  </section>;
}
