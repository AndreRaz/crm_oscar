import { Inspection, PartType } from "./api/client";

export type ReportRequirement = { text: string; page: "catalog" | "inspection" | "deviations" };

export function reportRequirements(inspection: Inspection, part: PartType | undefined, pendingInspectionIds: Set<number>): ReportRequirement[] {
  const measured = new Set(inspection.measurements.map((item) => item.characteristic_id));
  const missingCount = inspection.characteristic_ids.filter((id) => !measured.has(id)).length;
  const items: ReportRequirement[] = [];
  if (missingCount) items.push({ text: `Faltan ${missingCount} mediciones.`, page: "inspection" });
  // Annulled automatic deviations are hidden from the queue, but still block reports.
  if (pendingInspectionIds.has(inspection.id) || inspection.measurements.some((item) => item.status === "PENDING")) {
    items.push({ text: "Hay desviaciones pendientes.", page: "deviations" });
  }
  if (!part?.part_number.trim()) items.push({ text: "Falta el número de parte.", page: "catalog" });
  if (!part?.part_description.trim()) items.push({ text: "Falta la descripción de parte.", page: "catalog" });
  return items;
}
