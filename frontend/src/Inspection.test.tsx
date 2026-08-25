import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Inspection from "./Inspection";

const api = vi.hoisted(() => ({
  catalog: { list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn(), imageUrl: vi.fn((id) => `/api/part-types/${id}/image`) },
  inspections: { list: vi.fn(), start: vi.fn(), record: vi.fn(), createDeviation: vi.fn(), complete: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const part = { id: 7, part_number: "PT-100", part_description: "Pieza", image_path: "7.png", revision_no: 2, active: true };
const characteristics = [
  { id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 },
  { id: 9, part_type_id: 7, control_plan: "L1", name: "Longitud", unit: "mm", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 10, tol_plus: null, tol_minus: null, min_limit: 9, max_limit: 11, sort_order: 1 },
];
const inspection = { id: 20, part_type_id: 7, part_revision_id: 2, inspector: "luis", status: "PENDING", started_at: "2026-08-17", completed_at: null, annulled_at: null, characteristic_ids: [8, 9], measurements: [] };

beforeEach(() => {
  vi.clearAllMocks();
  api.inspections.record.mockReset();
  api.catalog.list.mockResolvedValue([part, { ...part, id: 10, code: "INACTIVA", active: false }]);
  api.catalog.characteristics.mockResolvedValue(characteristics);
  api.catalog.balloons.mockResolvedValue([
    { id: 1, part_type_id: 7, characteristic_id: 8, x: .2, y: .3 },
    { id: 2, part_type_id: 7, characteristic_id: 9, x: .7, y: .8 },
  ]);
  api.inspections.start.mockResolvedValue(inspection);
  api.inspections.list.mockResolvedValue([]);
});

it("guides selected characteristics and displays only server-returned statuses", async () => {
  api.inspections.record
    .mockResolvedValueOnce({ id: 30, characteristic_id: 8, actual_value: 10.1, nominal_snapshot: 10, min_limit_snapshot: 9.8, max_limit_snapshot: 10.2, measurement_method_snapshot: "Micrómetro", status: "IN_TOLERANCE" })
    .mockResolvedValueOnce({ id: 31, characteristic_id: 9, actual_value: 12.5, nominal_snapshot: 10, min_limit_snapshot: 9, max_limit_snapshot: 11, measurement_method_snapshot: "Calibrador", status: "PENDING" });
  api.inspections.complete.mockResolvedValue({ ...inspection, completed_at: "2026-08-17", status: "PENDING" });
  const user = userEvent.setup(); render(<Inspection />);

  const type = await screen.findByLabelText("Tipo de pieza activo");
  expect(screen.queryByRole("option", { name: "INACTIVA" })).not.toBeInTheDocument();
  await user.selectOptions(type, "7");
  await user.click(await screen.findByLabelText(/D1/)); await user.click(screen.getByLabelText(/L1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  expect(api.inspections.start).toHaveBeenCalledWith({ part_type_id: 7, characteristic_ids: [8, 9] });
  expect(screen.queryByText(/serie/i)).not.toBeInTheDocument();

  expect(await screen.findByAltText("Plano de PT-100")).toBeInTheDocument();
  expect(screen.getByText("Nominal: 10 mm")).toBeInTheDocument();
  expect(screen.getByText("Límites: 9.8 mm — 10.2 mm")).toBeInTheDocument();
  expect(screen.getByText("Método: Micrómetro")).toBeInTheDocument();
  expect(screen.getByLabelText("Marcador C.P. activo D1")).toHaveTextContent("D1");
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByText("IN_TOLERANCE")).toBeInTheDocument();
  expect(screen.getByText("Método registrado: Micrómetro · Nominal: 10 mm · Límites: 9.8 mm — 10.2 mm")).toBeInTheDocument();
  expect(screen.getByLabelText("Marcador C.P. activo L1")).toHaveTextContent("L1");
  await user.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByLabelText("Marcador C.P. activo D1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Siguiente" }));

  await user.type(screen.getByLabelText("Valor real (mm)"), "12.5");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByText("PENDING")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Completar inspección" }));
  expect(await screen.findByText("Estado final: PENDING")).toBeInTheDocument();
  expect(screen.getByText("Gestiona la generación y descarga desde Informes generados.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /informe/i })).not.toBeInTheDocument();
});

it("selects, deselects, and exposes the indeterminate characteristic state", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  const selectAll = await screen.findByLabelText("Seleccionar todas las características") as HTMLInputElement;
  const first = screen.getByLabelText(/D1/) as HTMLInputElement;
  const second = screen.getByLabelText(/L1/) as HTMLInputElement;
  expect(selectAll).not.toBeChecked();
  expect(selectAll.indeterminate).toBe(false);

  await user.click(first);
  expect(selectAll.indeterminate).toBe(true);
  await user.click(selectAll);
  expect(first).toBeChecked();
  expect(second).toBeChecked();
  expect(selectAll).toBeChecked();
  expect(selectAll.indeterminate).toBe(false);

  await user.click(selectAll);
  expect(first).not.toBeChecked();
  expect(second).not.toBeChecked();
  expect(selectAll).not.toBeChecked();
});

it("creates a manual deviation from a recorded measurement with a mandatory description", async () => {
  api.inspections.record.mockResolvedValue({ id: 30, characteristic_id: 8, actual_value: 10.1, nominal_snapshot: 10, min_limit_snapshot: 9.8, max_limit_snapshot: 10.2, measurement_method_snapshot: "Micrómetro", status: "IN_TOLERANCE" });
  api.inspections.createDeviation.mockResolvedValue({ id: 50, measurement_id: 30, origin: "MANUAL", status: "PENDING", description: "Acabado superficial", created_by: 2, created_at: "2026-08-17" });
  const user = userEvent.setup(); render(<Inspection role="inspector" />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  await user.click(await screen.findByLabelText(/D1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));

  fireEvent.submit(await screen.findByRole("form", { name: "Reportar desviación manual de D1" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Describe la desviación manual");
  expect(api.inspections.createDeviation).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Descripción de desviación manual para D1"), "  Acabado superficial  ");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de D1" }));
  expect(api.inspections.createDeviation).toHaveBeenCalledWith(20, 30, "Acabado superficial");
  expect(await screen.findByRole("status")).toHaveTextContent("Desviación manual reportada para D1");
  expect(screen.queryByRole("form", { name: "Reportar desviación manual de D1" })).not.toBeInTheDocument();
});

it("discovers persisted historical measurements and reports nonblank manual deviations", async () => {
  const historical = {
    ...inspection, id: 41, inspector: "marta", completed_at: "2026-08-18T10:00:00Z",
    measurements: [{ id: 61, characteristic_id: 8, actual_value: 10, status: "IN_TOLERANCE", measurement_method_snapshot: "Micrómetro" }],
  };
  const annulled = {
    ...inspection, id: 42, inspector: "sofia", completed_at: "2026-08-19T10:00:00Z", annulled_at: "2026-08-19T11:00:00Z",
    measurements: [{ id: 62, characteristic_id: 9, actual_value: 10.2, status: "IN_TOLERANCE", measurement_method_snapshot: "Calibrador" }],
  };
  api.inspections.list.mockImplementation((scope?: "shared") => Promise.resolve(scope === "shared" ? [historical, annulled] : []));
  api.inspections.createDeviation
    .mockResolvedValueOnce({ id: 70, measurement_id: 62, origin: "MANUAL", status: "PENDING", description: "Rayadura visible" })
    .mockRejectedValueOnce(new Error("Ya existe una desviación MANUAL pendiente para esta medición"));
  const user = userEvent.setup(); render(<Inspection role="inspector" />);

  expect(await screen.findByText("Inspección 42 · sofia · Anulada")).toBeInTheDocument();
  expect(screen.getByText("Inspección 41 · marta · Completada")).toBeInTheDocument();
  expect(api.inspections.list.mock.calls).toEqual(expect.arrayContaining([[], ["shared"]]));
  fireEvent.submit(screen.getByRole("form", { name: "Reportar desviación manual de Medición 62" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Describe la desviación manual");
  await user.type(screen.getByLabelText("Descripción de desviación manual para Medición 62"), "  Rayadura visible  ");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de Medición 62" }));
  expect(api.inspections.createDeviation).toHaveBeenCalledWith(42, 62, "Rayadura visible");
  expect(await screen.findByRole("status")).toHaveTextContent("Desviación manual reportada para Medición 62");
  expect(screen.queryByRole("form", { name: "Reportar desviación manual de Medición 62" })).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("Descripción de desviación manual para Medición 61"), "Duplicada");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de Medición 61" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una desviación MANUAL pendiente para esta medición");
  expect(screen.getByRole("form", { name: "Reportar desviación manual de Medición 61" })).toBeInTheDocument();
});

it("rejects an invalid actual value without sending a measurement", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  await user.click(await screen.findByLabelText(/D1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  await user.click(await screen.findByRole("button", { name: "Registrar valor" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa un valor numérico válido en mm.");
  expect(api.inspections.record).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText("D1 — Diámetro")).toBeInTheDocument());
});
