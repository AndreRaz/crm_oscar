import { useEffect, useMemo, useState } from "react";
import { api, DeviationGroup, GeneratedReport, Inspection, PartType } from "./api/client";

const failure = (fallback: string, error: unknown) => `${fallback}${error instanceof Error ? ` ${error.message}` : ""}`;

function missingItems(inspection: Inspection, part: PartType | undefined, pendingInspectionIds: Set<number>) {
  const measured = new Set(inspection.measurements.map((item) => item.characteristic_id));
  const missingCount = inspection.characteristic_ids.filter((id) => !measured.has(id)).length;
  const items: string[] = [];
  if (missingCount) items.push(`Faltan ${missingCount} mediciones.`);
  if (pendingInspectionIds.has(inspection.id)) items.push("Hay desviaciones pendientes.");
  if (!part?.part_number.trim()) items.push("Falta el número de parte.");
  if (!part?.part_description.trim()) items.push("Falta la descripción de parte.");
  return items;
}

export default function GeneratedReports() {
  const [reports, setReports] = useState<GeneratedReport[]>();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [parts, setParts] = useState<PartType[]>([]);
  const [groups, setGroups] = useState<DeviationGroup[]>([]);
  const [pending, setPending] = useState<number>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    Promise.all([api.reports.list(), api.inspections.list(), api.catalog.list(), api.deviations.list()])
      .then(([nextReports, nextInspections, nextParts, queue]) => {
        setReports(nextReports); setInspections(nextInspections); setParts(nextParts); setGroups(queue.groups);
      })
      .catch((next) => setError(failure("No se pudieron cargar los informes generados.", next)));
  }, []);

  const pendingInspectionIds = useMemo(() => new Set(groups
    .filter((group) => group.deviations.some((item) => item.status === "PENDING"))
    .map((group) => group.inspection.id)), [groups]);

  async function generate(inspectionId: number) {
    setPending(inspectionId); setError(""); setFeedback("");
    try {
      const created = await api.reports.generate(inspectionId);
      setReports((current) => [created, ...(current || [])]);
      setFeedback(`Informe ${created.id} generado.`);
    } catch (next) { setError(failure("No se pudo generar el informe.", next)); }
    finally { setPending(undefined); }
  }

  async function download(report: GeneratedReport) {
    setPending(-report.id); setError("");
    try {
      const blob = await api.reports.download(report.id);
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = report.file_path; link.click(); URL.revokeObjectURL(url);
    } catch (next) { setError(failure("No se pudo descargar el informe.", next)); }
    finally { setPending(undefined); }
  }

  return <section><h2>Informes generados</h2>
    {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    <h3>Generar informe</h3>
    {inspections.length === 0 ? <p>No hay inspecciones disponibles.</p> : <ul className="list report-inspections">{inspections.map((inspection) => {
      const checklist = missingItems(inspection, parts.find((part) => part.id === inspection.part_type_id), pendingInspectionIds);
      return <li key={inspection.id}><div><strong>Inspección {inspection.id}</strong>
        {checklist.length ? <ul aria-label={`Requisitos pendientes de inspección ${inspection.id}`}>{checklist.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Lista para generar.</p>}
      </div><button disabled={checklist.length > 0 || pending !== undefined} onClick={() => generate(inspection.id)}>Generar informe de inspección {inspection.id}</button></li>;
    })}</ul>}
    <h3>Historial de informes</h3>
    {!reports ? !error && <p>Cargando informes…</p> : reports.length === 0 ? <p>No hay informes generados.</p> : <ul className="list">{reports.map((report) => <li key={report.id}>
      <span><strong>Informe {report.id} · Inspección {report.inspection_id}</strong><br />Revisión {report.part_revision_id} · Generado {report.generated_at}</span>
      <button disabled={pending !== undefined} onClick={() => download(report)}>Descargar informe {report.id}</button>
    </li>)}</ul>}
  </section>;
}
