import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import RevisionHistory from "./RevisionHistory";
import { PartRevision } from "./api/client";

const before = { part_number: "PT-100", part_description: "Inicial", image_path: "old.png", active: true, legacy_code: "PRIVATE-LEGACY", characteristics: [{ id: 8, control_plan: "D1", name: "Diámetro", measurement_method: "Calibrador", nominal: 10, active: true, balloon: { x: .2, y: .3 } }] };
const after = { ...before, part_description: "Actualizada", image_path: "new.png", characteristics: [{ ...before.characteristics[0], id: 20, measurement_method: "Micrómetro", nominal: 11, balloon: { x: .5, y: .3 } }] };
const revisions: PartRevision[] = [
  { id: 1, part_type_id: 7, revision_no: 1, definition_json: JSON.stringify(before), created_by: null, created_at: "2026-09-01T10:00:00Z" },
  { id: 2, part_type_id: 7, revision_no: 2, definition_json: JSON.stringify(after), created_by: 3, created_at: "2026-09-02T10:00:00Z" },
];

it("diffs meaningful snapshot fields, not database IDs or legacy codes", async () => {
  const user = userEvent.setup();
  render(<RevisionHistory revisions={revisions} currentRevisionNo={2} admin={false} busy={false} onRestore={vi.fn()} />);
  await user.click(screen.getByText("Ver cambios de la revisión 2"));
  const table = screen.getByRole("table", { name: "Cambios: Revisión 1 → Revisión 2" });
  expect(within(table).getByRole("row", { name: "Descripción Inicial Actualizada" })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: "C.P. D1 · Método de medición Calibrador Micrómetro" })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: "C.P. D1 · Nominal 10 11" })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: "C.P. D1 · Marcador X 0.2 0.5" })).toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE-LEGACY|legacy_code/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /restauración/ })).not.toBeInTheDocument();
});

it("requires an administrator preview and explicit confirmation, with cancel available", async () => {
  const user = userEvent.setup(), restore = vi.fn().mockResolvedValue(true);
  render(<RevisionHistory revisions={revisions} currentRevisionNo={2} admin busy={false} onRestore={restore} />);
  expect(screen.queryByRole("button", { name: "Confirmar restauración" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Vista previa de restauración 1" }));
  const preview = screen.getByRole("region", { name: "Confirmar restauración de revisión 1" });
  expect(within(preview).getByRole("row", { name: "Descripción Actualizada Inicial" })).toBeInTheDocument();
  expect(restore).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancelar restauración" }));
  expect(restore).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Vista previa de restauración 1" }));
  await user.click(screen.getByRole("button", { name: "Confirmar restauración" }));
  expect(restore).toHaveBeenCalledExactlyOnceWith(1);
  expect(screen.queryByRole("region", { name: "Confirmar restauración de revisión 1" })).not.toBeInTheDocument();
});

it("handles malformed snapshots without showing raw data or offering a restore", () => {
  render(<RevisionHistory revisions={[{ ...revisions[0], definition_json: "not json" }]} currentRevisionNo={1} admin busy={false} onRestore={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudo interpretar");
  expect(screen.queryByText("not json")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
