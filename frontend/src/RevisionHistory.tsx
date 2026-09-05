import { useEffect, useRef, useState } from "react";
import { PartDefinition, PartRevision, RevisionCharacteristic } from "./api/client";

const partFields = { part_number: "Número de parte", part_description: "Descripción", image_path: "Plano", active: "Estado" };
const characteristicFields = {
  name: "Nombre", unit: "Unidad", measurement_method: "Método de medición", tol_type: "Formato de tolerancia",
  nominal: "Nominal", tol_plus: "Tolerancia superior", tol_minus: "Tolerancia inferior", min_limit: "Límite mínimo",
  max_limit: "Límite máximo", sort_order: "Orden", active: "Estado",
};

function definition(revision?: PartRevision): PartDefinition | undefined {
  if (!revision) return undefined;
  try {
    const value = JSON.parse(revision.definition_json);
    if (!value || typeof value.part_number !== "string" || typeof value.part_description !== "string" ||
      typeof value.active !== "boolean" || !Array.isArray(value.characteristics) ||
      !value.characteristics.every((item: RevisionCharacteristic) => item && typeof item.control_plan === "string")) return undefined;
    return value;
  } catch { return undefined; }
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Activo" : "Inactivo";
  if (value === "SYMMETRIC") return "Nominal ± tolerancias";
  if (value === "LIMITS") return "Límites";
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function fields(value?: PartDefinition): Map<string, string> {
  const result = new Map<string, string>();
  if (!value) return result;
  for (const [key, label] of Object.entries(partFields)) result.set(label, display(value[key as keyof typeof partFields]));
  for (const item of value.characteristics) {
    const prefix = `C.P. ${item.control_plan}`;
    result.set(prefix, "Presente");
    for (const [key, label] of Object.entries(characteristicFields)) result.set(`${prefix} · ${label}`, display(item[key as keyof typeof characteristicFields]));
    result.set(`${prefix} · Marcador X`, display(item.balloon?.x));
    result.set(`${prefix} · Marcador Y`, display(item.balloon?.y));
  }
  return result;
}

function RevisionDiff({ before, after, beforeLabel, afterLabel }: { before?: PartDefinition; after: PartDefinition; beforeLabel: string; afterLabel: string }) {
  const previous = fields(before), next = fields(after);
  const changes = [...new Set([...previous.keys(), ...next.keys()])].filter((key) => previous.get(key) !== next.get(key));
  return changes.length ? <div className="revision-diff-scroll" tabIndex={0} role="region" aria-label="Diferencias de revisión"><table className="revision-diff" aria-label={`Cambios: ${beforeLabel} → ${afterLabel}`}>
    <thead><tr><th scope="col">Campo</th><th scope="col">{beforeLabel}</th><th scope="col">{afterLabel}</th></tr></thead>
    <tbody>{changes.map((key) => <tr key={key}><th scope="row">{key}</th><td>{previous.get(key) ?? "—"}</td><td>{next.get(key) ?? "—"}</td></tr>)}</tbody>
  </table></div> : <p>No hay cambios en los campos comparados.</p>;
}

export default function RevisionHistory({ revisions, currentRevisionNo, admin, busy, onRestore }: {
  revisions: PartRevision[]; currentRevisionNo: number; admin: boolean; busy: boolean;
  onRestore: (revisionNo: number) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<number>();
  const cancelPreview = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (preview !== undefined) cancelPreview.current?.focus(); }, [preview]);
  const ordered = [...revisions].sort((a, b) => a.revision_no - b.revision_no);
  const current = definition(ordered.find((item) => item.revision_no === currentRevisionNo));
  const target = ordered.find((item) => item.revision_no === preview);
  const targetDefinition = definition(target);
  return <section className="revision-history" aria-label="Historial de revisiones">
    <h3>Historial</h3><p>Las revisiones son inmutables. Restaurar crea una nueva revisión; no modifica las inspecciones completadas ni el historial anterior.</p>
    {!ordered.length && <p>No hay revisiones disponibles.</p>}
    <ol className="revision-list">{ordered.map((revision, index) => {
      const snapshot = definition(revision), previous = definition(ordered[index - 1]);
      return <li key={revision.id} className="card revision-entry">
        <h4>Revisión {revision.revision_no}{revision.revision_no === currentRevisionNo ? " · Actual" : ""}</h4>
        <p><time dateTime={revision.created_at}>{revision.created_at}</time> · {revision.created_by === null ? "Sistema" : `Usuario ${revision.created_by}`}</p>
        {snapshot && (index === 0 || previous) ? <details><summary>Ver cambios de la revisión {revision.revision_no}</summary>
          <RevisionDiff before={previous} after={snapshot} beforeLabel={index ? `Revisión ${ordered[index - 1].revision_no}` : "Sin definición"} afterLabel={`Revisión ${revision.revision_no}`} />
        </details> : <p role="alert">No se pudo interpretar la definición de esta revisión o de la anterior.</p>}
        {admin && snapshot && current && revision.revision_no !== currentRevisionNo && <button disabled={busy} type="button" onClick={() => setPreview(revision.revision_no)}>Vista previa de restauración {revision.revision_no}</button>}
      </li>;
    })}</ol>
    {admin && target && targetDefinition && current && <section className="card form-card revision-preview" role="region" aria-label={`Confirmar restauración de revisión ${preview}`}>
      <div className="form-card-header"><strong>Restaurar revisión {preview}</strong></div>
      <div className="form-card-body"><p>Se reemplazarán los datos, el estado, el plano, las características y los marcadores actuales por esta definición. Se creará una nueva revisión sin alterar el historial ni las inspecciones completadas.</p>
        <RevisionDiff before={current} after={targetDefinition} beforeLabel={`Actual · Revisión ${currentRevisionNo}`} afterLabel={`Restaurar · Revisión ${preview}`} />
      </div>
      <div className="form-card-footer"><button ref={cancelPreview} disabled={busy} type="button" onClick={() => setPreview(undefined)}>Cancelar restauración</button><button disabled={busy} type="button" onClick={async () => { if (await onRestore(target.revision_no)) setPreview(undefined); }}>Confirmar restauración</button></div>
    </section>}
  </section>;
}
