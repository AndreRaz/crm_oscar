import { useEffect, useMemo, useRef, useState } from "react";
import { api, DeviationGroup, GeneratedReport, Inspection, PartType, Role } from "./api/client";
import StatusBadge from "./StatusBadge";
import { reportRequirements } from "./reportEligibility";

const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;
const formatDate = (value: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
type Destination = "catalog" | "inspection" | "deviations";

export default function GeneratedReports({ role = "inspector", onNavigate }: { role?: Role; onNavigate?: (page: Destination) => void }) {
  const [reports, setReports] = useState<GeneratedReport[]>();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [parts, setParts] = useState<PartType[]>([]);
  const [groups, setGroups] = useState<DeviationGroup[]>([]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [readiness, setReadiness] = useState("all");
  const [inspector, setInspector] = useState("");
  const [preview, setPreview] = useState<{ report: GeneratedReport; url: string }>();
  const previewUrl = useRef<string | undefined>(undefined);
  const previewRequest = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const restorePreviewFocus = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.all([api.reports.list(), api.inspections.list(), api.catalog.list(), api.deviations.list()])
      .then(([nextReports, nextInspections, nextParts, queue]) => {
        if (!active) return;
        setReports(nextReports); setInspections(nextInspections); setParts(nextParts); setGroups(queue.groups);
      })
      .catch((next) => { if (active) setError(failure("No se pudieron cargar los informes generados.", next)); });
    return () => {
      active = false; mounted.current = false; previewRequest.current++;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (preview) { dialog.current?.showModal(); closeButton.current?.focus(); }
  }, [preview]);
  useEffect(() => {
    if (!preview && !pending && restorePreviewFocus.current) {
      restorePreviewFocus.current = false; trigger.current?.focus();
    }
  }, [preview, pending]);

  const pendingInspectionIds = useMemo(() => new Set(groups
    .filter((group) => group.deviations.some((item) => item.status === "PENDING"))
    .map((group) => group.inspection.id)), [groups]);
  const rows = inspections.map((inspection) => {
    const part = parts.find((entry) => entry.id === inspection.part_type_id);
    return { inspection, part, checklist: reportRequirements(inspection, part, pendingInspectionIds) };
  });
  const invalidRange = Boolean(from && to && from > to);
  const inRange = (value: string) => {
    const date = new Date(value);
    const start = from ? new Date(`${from}T00:00:00`) : undefined;
    const end = to ? new Date(`${to}T00:00:00`) : undefined;
    if (end) end.setDate(end.getDate() + 1);
    return !invalidRange && (!start || date >= start) && (!end || date < end);
  };
  const query = search.trim().toLocaleLowerCase("es");
  const matches = (inspection: Inspection | undefined, part: PartType | undefined, report?: GeneratedReport) => {
    const text = `${part?.part_number || ""} ${part?.part_description || ""} Inspección ${inspection?.id ?? report?.inspection_id ?? ""} ${report ? `Informe ${report.id}` : ""}`;
    return text.toLocaleLowerCase("es").includes(query) && (role !== "admin" || !inspector || inspection?.inspector === inspector);
  };
  const visibleInspections = rows.filter(({ inspection, part, checklist }) => matches(inspection, part)
    && inRange(inspection.completed_at || inspection.started_at)
    && (readiness === "all" || (readiness === "ready" ? !checklist.length : checklist.length > 0)));
  const visibleReports = reports?.filter((report) => {
    const row = rows.find(({ inspection }) => inspection.id === report.inspection_id);
    return matches(row?.inspection, row?.part, report) && inRange(report.generated_at);
  });

  async function generate(inspectionId: number) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(""); setFeedback("");
    try {
      const created = await api.reports.generate(inspectionId);
      if (!mounted.current) return;
      setReports((current) => [created, ...(current || [])]);
      setFeedback(`Informe ${created.id} generado.`);
    } catch (next) { if (mounted.current) setError(failure("No se pudo generar el informe.", next)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }

  function closePreview() {
    previewRequest.current++;
    busy.current = false; setPending(false);
    dialog.current?.close();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined; restorePreviewFocus.current = true; setPreview(undefined);
  }

  async function openFile(report: GeneratedReport, inline: boolean) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    const request = ++previewRequest.current;
    if (inline && !preview) trigger.current = document.activeElement as HTMLElement;
    try {
      const blob = await api.reports.download(report.id);
      if (!mounted.current || request !== previewRequest.current) return;
      const url = URL.createObjectURL(blob);
      if (inline) {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url; setPreview({ report, url });
      } else {
        try {
          const link = document.createElement("a"); link.href = url; link.download = report.file_path; link.click();
        } finally { URL.revokeObjectURL(url); }
      }
    } catch (next) { if (mounted.current && request === previewRequest.current) setError(failure(inline ? "No se pudo abrir la vista previa." : "No se pudo descargar el informe.", next)); }
    finally {
      if (request === previewRequest.current) {
        busy.current = false; if (mounted.current) setPending(false);
      }
    }
  }

  return <section className="reports-page"><h2>Informes generados</h2>
    {error && !preview && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    <div className="filter-bar card report-filters">
      <label>Buscar informes e inspecciones<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Parte, descripción o identificador" /></label>
      <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      {role === "admin" && <label>Inspector<select value={inspector} onChange={(event) => setInspector(event.target.value)}><option value="">Todos</option>{[...new Set(inspections.map((item) => item.inspector))].sort().map((name) => <option key={name}>{name}</option>)}</select></label>}
    </div>
    <p className="field-help">Fechas locales, ambos días incluidos. Inspecciones: fecha de finalización o inicio. Historial: fecha de generación.</p>
    {invalidRange && <p role="alert">La fecha desde no puede ser posterior a la fecha hasta.</p>}
    {!reports && !error && <p>Cargando informes…</p>}
    {reports && <>
      <section className="report-generation card" aria-labelledby="report-generation-heading">
        <h3 id="report-generation-heading">Generar informe</h3>
        <p className="summary-count">Listas para generar: {rows.filter((row) => !row.checklist.length).length} · Inspecciones visibles: {visibleInspections.length}</p>
        <label>Disponibilidad<select value={readiness} onChange={(event) => setReadiness(event.target.value)}><option value="all">Todas</option><option value="ready">Listas para generar</option><option value="blocked">Con requisitos pendientes</option></select></label>
        {visibleInspections.length === 0 ? <p>No hay inspecciones que coincidan con los filtros.</p> : <ul className="list report-inspections">{visibleInspections.map(({ inspection, part, checklist }) => <li key={inspection.id}>
          <div><strong>{part?.part_number || "Parte sin número"} · Inspección {inspection.id}</strong><p>{part?.part_description}</p>
            <p><StatusBadge status={inspection.status} /> {inspection.annulled_at && <StatusBadge status="ANNULLED" />} · {formatDate(inspection.completed_at || inspection.started_at)} · {inspection.inspector}</p>
            {checklist.length ? <ul aria-label={`Requisitos pendientes de inspección ${inspection.id}`}>{checklist.map((item) => <li key={item.text}>{item.text} {onNavigate && (item.page !== "catalog" || role === "admin") && <button className="button-link" onClick={() => onNavigate(item.page)}>Ir a {item.page === "catalog" ? "catálogo" : item.page === "inspection" ? "inspecciones" : "desviaciones"}</button>}</li>)}</ul> : <p>Lista para generar.</p>}
            {role !== "admin" && checklist.some((item) => item.page === "catalog") && <p className="field-help">Solicita a administración completar los datos del catálogo.</p>}
          </div><button disabled={checklist.length > 0 || pending} onClick={() => generate(inspection.id)}>Generar informe de inspección {inspection.id}</button>
        </li>)}</ul>}
      </section>
      <details className="report-history card" open><summary>Historial de informes ({visibleReports?.length || 0})</summary>
        {!visibleReports?.length ? <p>No hay informes que coincidan con los filtros.</p> : <ul className="list">{visibleReports.map((report) => {
          const row = rows.find(({ inspection }) => inspection.id === report.inspection_id);
          return <li key={report.id}><div><strong>Informe {report.id} · Inspección {report.inspection_id}</strong><p>{row?.part?.part_number} · {row?.part?.part_description}</p><p>Revisión {report.part_revision_id} · Generado <time dateTime={report.generated_at}>{formatDate(report.generated_at)}</time></p></div>
            <div className="report-actions"><button disabled={pending} onClick={() => openFile(report, true)}>Vista previa del informe {report.id}</button><button disabled={pending} onClick={() => openFile(report, false)}>Descargar informe {report.id}</button></div>
          </li>;
        })}</ul>}
      </details>
    </>}
    {preview && <dialog ref={dialog} className="report-preview-dialog" aria-labelledby="report-preview-title" onCancel={(event) => { event.preventDefault(); closePreview(); }}>
      <header className="dialog-heading"><h3 id="report-preview-title">Vista previa del informe {preview.report.id}</h3><button ref={closeButton} onClick={closePreview}>Cerrar vista previa</button></header>
      {error && <p role="alert">{error}</p>}
      <p>Documento PDF guardado. Puedes descargarlo si tu navegador no permite visualizarlo.</p>
      <iframe className="report-preview-frame" title={`PDF del informe ${preview.report.id}`} src={preview.url} />
      <button disabled={pending} onClick={() => openFile(preview.report, false)}>Descargar informe {preview.report.id}</button>
    </dialog>}
  </section>;
}
