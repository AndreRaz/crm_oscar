import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Inspection from "./Inspection";

const api = vi.hoisted(() => ({
  catalog: { list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn(), revisions: vi.fn(), imageUrl: vi.fn((id) => `/api/part-types/${id}/image`) },
  inspections: { list: vi.fn(), start: vi.fn(), detail: vi.fn(), record: vi.fn(), createDeviation: vi.fn(), complete: vi.fn(), annul: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const part = { id: 7, part_number: "PT-100", part_description: "Pieza", image_path: "7.png", revision_no: 2, active: true };
const characteristics = [
  { id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 },
  { id: 9, part_type_id: 7, control_plan: "L1", name: "Longitud", unit: "mm", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 10, tol_plus: null, tol_minus: null, min_limit: 9, max_limit: 11, sort_order: 1 },
];
const inspection = { id: 20, part_type_id: 7, part_revision_id: 2, inspector: "luis", status: "PENDING", started_at: "2026-08-17", completed_at: null, annulled_at: null, characteristic_ids: [8, 9], measurements: [] };
const savedMeasurement = { id: 30, characteristic_id: 8, actual_value: 10.1, nominal_snapshot: 10, min_limit_snapshot: 9.8, max_limit_snapshot: 10.2, measurement_method_snapshot: "Micrómetro", status: "IN_TOLERANCE" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function startSelected(user: ReturnType<typeof userEvent.setup>, all = true) {
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  await user.click(await screen.findByLabelText(all ? "Seleccionar todas las características" : /D1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  await screen.findByLabelText("Valor real (mm)");
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  api.catalog.imageUrl.mockImplementation((id) => `/api/part-types/${id}/image`);
  api.catalog.list.mockResolvedValue([part, { ...part, id: 10, code: "INACTIVA", active: false }]);
  api.catalog.characteristics.mockResolvedValue(characteristics);
  api.catalog.balloons.mockResolvedValue([
    { id: 1, part_type_id: 7, characteristic_id: 8, x: .2, y: .3 },
    { id: 2, part_type_id: 7, characteristic_id: 9, x: .7, y: .8 },
  ]);
  api.catalog.revisions.mockResolvedValue([{ id: 2, part_type_id: 7, revision_no: 2 }]);
  let current = inspection;
  api.inspections.start.mockImplementation(async (input) => {
    current = { ...inspection, characteristic_ids: input.characteristic_ids };
    return current;
  });
  api.inspections.detail.mockImplementation(async () => ({ ...current, measurements: await Promise.all(api.inspections.record.mock.results.filter((item) => item.type === "return").map((item) => item.value)) }));
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
  await user.click(await screen.findByText("Resultados registrados (1)"));
  expect(await screen.findByText("En tolerancia")).toBeInTheDocument();
  expect(screen.getByText("Método registrado: Micrómetro · Nominal: 10 mm · Límites: 9.8 mm — 10.2 mm")).toBeInTheDocument();
  expect(screen.getByLabelText("Marcador C.P. activo L1")).toHaveTextContent("L1");
  await user.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByLabelText("Marcador C.P. activo D1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Siguiente" }));

  await user.type(screen.getByLabelText("Valor real (mm)"), "12.5");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByText("Pendiente")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Completar inspección" }));
  expect(await screen.findByText(/Estado final:/)).toHaveTextContent("Pendiente");
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
  await user.type(await screen.findByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));

  await user.click(await screen.findByText("Resultados registrados (1)"));
  fireEvent.submit(await screen.findByRole("form", { name: "Reportar desviación manual de D1" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Describe la desviación manual");
  expect(api.inspections.createDeviation).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Descripción de desviación manual para D1"), "  Acabado superficial  ");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de D1" }));
  expect(api.inspections.createDeviation).toHaveBeenCalledWith(20, 30, "Acabado superficial");
  expect(await screen.findByText("Desviación manual reportada para D1.")).toBeInTheDocument();
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

  expect(screen.queryByText("Inspección 42 · sofia · Anulada")).not.toBeInTheDocument();
  expect(api.inspections.list).not.toHaveBeenCalledWith("shared");
  await user.click(screen.getByRole("tab", { name: "Historial" }));
  expect(await screen.findByText("Inspección 42 · sofia · Anulada")).toBeInTheDocument();
  expect(screen.getByText("Inspección 41 · marta · Completada")).toBeInTheDocument();
  expect(api.inspections.list.mock.calls).toEqual(expect.arrayContaining([[], ["shared"]]));
  fireEvent.submit(screen.getByRole("form", { name: "Reportar desviación manual de Medición 62" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Describe la desviación manual");
  await user.type(screen.getByLabelText("Descripción de desviación manual para Medición 62"), "  Rayadura visible  ");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de Medición 62" }));
  expect(api.inspections.createDeviation).toHaveBeenCalledWith(42, 62, "Rayadura visible");
  expect(await screen.findByText("Desviación manual reportada para Medición 62.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Reportar desviación manual de Medición 62" })).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("Descripción de desviación manual para Medición 61"), "Duplicada");
  await user.click(screen.getByRole("button", { name: "Reportar desviación de Medición 61" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una desviación MANUAL pendiente para esta medición");
  expect(screen.getByRole("form", { name: "Reportar desviación manual de Medición 61" })).toBeInTheDocument();
});

it("recovers persisted measurements after unmount and continues at the first unmeasured characteristic", async () => {
  const persisted = { ...inspection, measurements: [savedMeasurement] };
  api.inspections.list.mockResolvedValue([persisted]);
  api.inspections.detail.mockResolvedValue(persisted);
  const user = userEvent.setup();
  const initial = render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByText("1/2 características medidas")).toBeInTheDocument();
  await screen.findByLabelText("Valor real (mm)");
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(screen.getByText("Faltan por medir: L1")).toBeInTheDocument();
  await user.click(screen.getByText("Resultados registrados (1)"));
  expect(screen.getByText("Valor real registrado: 10.1")).toBeInTheDocument();
  initial.unmount();

  render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  await screen.findByLabelText("Valor real (mm)");
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(api.inspections.detail).toHaveBeenCalledTimes(2);
  expect(api.inspections.start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByText(/Valor ya registrado: 10.1/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Registrar valor" })).not.toBeInTheDocument();
});

it("blocks a resumed inspection when the latest immutable revision ID differs, preserving saved evidence", async () => {
  api.inspections.list.mockResolvedValue([inspection]);
  api.inspections.detail.mockResolvedValue({ ...inspection, measurements: [savedMeasurement] });
  api.catalog.revisions.mockResolvedValue([{ id: 2, revision_no: 1 }, { id: 77, revision_no: 2 }]);
  const user = userEvent.setup(); render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La revisión de la pieza cambió");
  expect(api.catalog.characteristics).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Valor real (mm)")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Completar inspección" })).toBeDisabled();
  await user.click(screen.getByText("Resultados registrados (1)"));
  expect(screen.getByText("Valor real registrado: 10.1")).toBeInTheDocument();
  expect(api.inspections.record).not.toHaveBeenCalled();
});

it("fails closed when revisions cannot be verified and allows a retry through pending inspections", async () => {
  api.inspections.list.mockResolvedValue([inspection]);
  api.catalog.revisions.mockRejectedValueOnce(new Error("Offline"));
  const user = userEvent.setup(); render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Inspección bloqueada");
  expect(screen.queryByLabelText("Valor real (mm)")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Volver a pendientes" }));
  await user.click(screen.getByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByLabelText("Valor real (mm)")).toBeInTheDocument();
});

it("explicitly blocks unavailable selected characteristics instead of substituting another feature", async () => {
  api.inspections.list.mockResolvedValue([inspection]);
  api.catalog.characteristics.mockResolvedValue([characteristics[0]]);
  const user = userEvent.setup(); render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Características no disponibles o eliminadas: 9");
  expect(screen.queryByLabelText("Valor real (mm)")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Completar inspección" })).toBeDisabled();
});

it("uses the server selection and revision for a new inspection rather than the setup selection", async () => {
  api.inspections.start.mockResolvedValue({ ...inspection, characteristic_ids: [9] });
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user, false);
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(screen.getByText("0/1 características medidas")).toBeInTheDocument();
  expect(screen.getByText("Método: Calibrador")).toBeInTheDocument();
});

it("prevents duplicate pending submissions and never resubmits an already measured characteristic", async () => {
  const pending = deferred<typeof savedMeasurement>();
  api.inspections.record.mockReturnValue(pending.promise);
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user);
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  const form = screen.getByRole("form", { name: "Registrar medición" });
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(api.inspections.record).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Guardando medición…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Registrar valor" })).toBeDisabled();
  fireEvent.submit(form);
  expect(api.inspections.record).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(savedMeasurement));
  expect(await screen.findByText("1/2 características medidas")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.queryByRole("form", { name: "Registrar medición" })).not.toBeInTheDocument();
  expect(api.inspections.record).toHaveBeenCalledTimes(1);
});

it("disables incomplete completion and rechecks server coverage before completing", async () => {
  api.inspections.record.mockResolvedValue(savedMeasurement);
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user, false);
  const complete = screen.getByRole("button", { name: "Completar inspección" });
  expect(complete).toBeDisabled();
  fireEvent.click(complete);
  expect(api.inspections.complete).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  await waitFor(() => expect(complete).toBeEnabled());
  api.inspections.detail.mockResolvedValue({ ...inspection, characteristic_ids: [8], measurements: [] });
  await user.click(complete);
  expect(await screen.findByRole("alert")).toHaveTextContent("Faltan características por medir");
  expect(api.inspections.complete).not.toHaveBeenCalled();
  expect(complete).toBeDisabled();
});

it("preserves failed numeric input, blocks local navigation, and recovers a draft after app unmount", async () => {
  api.inspections.record.mockRejectedValue(new Error("Network unavailable"));
  const user = userEvent.setup(); const view = render(<Inspection />);
  await startSelected(user);
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Hay un valor sin guardar");
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("8");
  await user.click(screen.getByRole("tab", { name: "Historial" }));
  expect(screen.getByRole("tab", { name: "Inspeccionar" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El dato ingresado se conserva");
  expect(screen.getByLabelText("Valor real (mm)")).toHaveValue(10.1);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  view.unmount();
  api.inspections.list.mockResolvedValue([inspection]);
  api.inspections.detail.mockResolvedValue(inspection);
  render(<Inspection />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByLabelText("Valor real (mm)")).toHaveValue(10.1);
  expect(screen.getByText("Borrador recuperado. Este valor todavía no está registrado.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Descartar valor sin guardar" }));
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(sessionStorage.getItem("inspection-draft:20")).toBeNull();
});

it("rechecks revision before recording if the catalog changed after recovery", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user);
  api.catalog.revisions.mockResolvedValue([{ id: 3, revision_no: 3 }]);
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La revisión de la pieza cambió");
  expect(api.inspections.record).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("inspection-draft:20")).toContain("10.1");
});

it("recovers a measurement saved elsewhere without sending another POST", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user);
  api.inspections.detail.mockResolvedValue({ ...inspection, measurements: [savedMeasurement] });
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.2");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Esta característica ya fue medida");
  expect(api.inspections.record).not.toHaveBeenCalled();
  expect(screen.getByText("1/2 características medidas")).toBeInTheDocument();
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(screen.getByLabelText("Valor real (mm)")).toHaveValue(null);
});

it("keeps drawing marker selection controlled and protects an unsaved value", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await startSelected(user);
  await user.click(screen.getByRole("button", { name: "Marcador C.P. L1" }));
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(screen.getByRole("button", { name: "Marcador C.P. activo L1" })).toHaveAttribute("aria-pressed", "true");
  await user.type(screen.getByLabelText("Valor real (mm)"), "11");
  await user.click(screen.getByRole("button", { name: "Marcador C.P. D1" }));
  expect(screen.getByLabelText("Característica seleccionada")).toHaveValue("9");
  expect(screen.getByLabelText("Valor real (mm)")).toHaveValue(11);
});

it("blocks a revision change during new-start catalog loading", async () => {
  api.catalog.revisions.mockResolvedValueOnce([{ id: 2, revision_no: 2 }]).mockResolvedValue([{ id: 3, revision_no: 3 }]);
  const user = userEvent.setup(); render(<Inspection />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  await user.click(await screen.findByLabelText(/D1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La revisión de la pieza cambió");
  expect(screen.queryByLabelText("Valor real (mm)")).not.toBeInTheDocument();
});

it("ignores stale part setup requests and disables start while loading", async () => {
  const old = deferred<typeof characteristics>();
  api.catalog.list.mockResolvedValue([part, { ...part, id: 11, part_number: "PT-200" }]);
  api.catalog.characteristics.mockImplementation((id) => id === 7 ? old.promise : Promise.resolve([{ ...characteristics[1], id: 12, part_type_id: 11, control_plan: "B1" }]));
  const user = userEvent.setup(); render(<Inspection />);
  const select = await screen.findByLabelText("Tipo de pieza activo");
  await user.selectOptions(select, "7");
  expect(screen.getByRole("button", { name: "Iniciar inspección" })).toBeDisabled();
  await user.selectOptions(select, "11");
  await screen.findByLabelText(/B1/);
  await act(async () => old.resolve(characteristics));
  expect(screen.queryByLabelText(/D1/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/B1/)).toBeInTheDocument();
  expect(select).toHaveValue("11");
});

it("provides a fresh inspection and an optional reports link after completion", async () => {
  const completed = { ...inspection, completed_at: "2026-08-17", status: "CONFORMING", measurements: [savedMeasurement] };
  api.inspections.list.mockResolvedValue([inspection]);
  api.inspections.detail.mockResolvedValue(completed);
  const onNavigate = vi.fn();
  const user = userEvent.setup(); render(<Inspection onNavigate={onNavigate} />);
  await user.click(await screen.findByRole("button", { name: "Continuar inspección 20" }));
  expect(await screen.findByRole("heading", { name: "Inspección completada" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ver informes generados" }));
  expect(onNavigate).toHaveBeenCalledWith("reports");
  await user.click(screen.getByRole("button", { name: "Nueva inspección" }));
  expect(screen.getByLabelText("Tipo de pieza activo")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Continuar inspección 20" })).not.toBeInTheDocument();
});

it("requires an explicit reason for administrator annulment and preserves historical measurements", async () => {
  const completed = { ...inspection, completed_at: "2026-08-17", measurements: [savedMeasurement] };
  api.inspections.list.mockResolvedValue([completed]);
  api.inspections.annul.mockResolvedValue({ ...completed, annulled_at: "2026-08-18" });
  const user = userEvent.setup(); render(<Inspection role="admin" />);
  await user.click(screen.getByRole("tab", { name: "Historial" }));
  expect(screen.queryByRole("form", { name: /Reportar desviación manual/ })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Anular inspección 20" }));
  expect(screen.getByRole("button", { name: "Confirmar anulación" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("form", { name: "Confirmar anulación" }));
  expect(api.inspections.annul).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Indica el motivo");
  await user.type(screen.getByLabelText("Motivo de anulación"), "  Duplicada  ");
  await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));
  expect(api.inspections.annul).toHaveBeenCalledWith(20, "Duplicada");
  expect(await screen.findByText("Inspección 20 · luis · Anulada")).toBeInTheDocument();
  expect(screen.getByText("Valor real: 10.1 · Método: Micrómetro")).toBeInTheDocument();
});

it("does not offer annulment to inspectors", async () => {
  api.inspections.list.mockResolvedValue([{ ...inspection, completed_at: "2026-08-17", measurements: [savedMeasurement] }]);
  const user = userEvent.setup(); render(<Inspection role="inspector" />);
  await user.click(screen.getByRole("tab", { name: "Historial" }));
  await screen.findByText("Inspección 20 · luis · Completada");
  expect(screen.queryByRole("button", { name: /Anular inspección/ })).not.toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Reportar desviación manual de Medición 30" })).toBeInTheDocument();
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
