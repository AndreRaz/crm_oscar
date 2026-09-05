import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Catalog from "./Catalog";

const api = vi.hoisted(() => ({
  catalog: {
    list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn(), imageUrl: vi.fn(),
    createPart: vi.fn(), patchPart: vi.fn(), uploadImage: vi.fn(),
    createCharacteristic: vi.fn(), patchCharacteristic: vi.fn(), deleteCharacteristic: vi.fn(),
    createBalloon: vi.fn(), deleteBalloon: vi.fn(), revisions: vi.fn(), restoreRevision: vi.fn(),
  },
}));
vi.mock("./api/client", () => ({ api }));

const part = { id: 7, part_number: "PT-100", part_description: "Inicial", image_path: "7.png", revision_no: 1, active: true };

beforeEach(() => {
  vi.resetAllMocks();
  api.catalog.list.mockResolvedValue([part]);
  api.catalog.characteristics.mockImplementation(async () => Promise.all(api.catalog.createCharacteristic.mock.results.map((result) => result.value)));
  api.catalog.balloons.mockImplementation(async () => Promise.all(api.catalog.createBalloon.mock.results.map((result) => result.value)));
  api.catalog.revisions.mockResolvedValue([]);
  api.catalog.imageUrl.mockImplementation((id: number) => `/api/part-types/${id}/image`);
});

it("creates and edits parts through the canonical Spanish-labelled fields", async () => {
  api.catalog.createPart.mockResolvedValue({ ...part, id: 8, part_number: "PT-200" });
  api.catalog.patchPart.mockResolvedValue({ ...part, part_number: "PT-101", part_description: "Editada" });
  const user = userEvent.setup(); render(<Catalog role="admin" />);

  await user.click(await screen.findByRole("button", { name: "Agregar pieza" }));
  await user.type(screen.getByLabelText("Número de parte"), "PT-200");
  await user.type(screen.getByLabelText("Descripción de parte"), "Nueva pieza");
  await user.click(screen.getByRole("button", { name: "Crear tipo" }));
  expect(api.catalog.createPart).toHaveBeenCalledWith({ part_number: "PT-200", part_description: "Nueva pieza" });
  expect(screen.queryByText("Código del nuevo tipo")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
  await screen.findByRole("tab", { name: "Datos" });
  await user.clear(screen.getByLabelText("Número de parte"));
  await user.type(screen.getByLabelText("Número de parte"), "PT-101");
  await user.clear(screen.getByLabelText("Descripción de parte"));
  await user.type(screen.getByLabelText("Descripción de parte"), "Editada");
  await user.click(screen.getByRole("button", { name: "Guardar tipo" }));
  expect(api.catalog.patchPart).toHaveBeenCalledWith(7, { part_number: "PT-101", part_description: "Editada" });
});

it("authors asymmetric and limits characteristics with canonical control-plan fields", async () => {
  api.catalog.createCharacteristic
    .mockResolvedValueOnce({ id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .1, min_limit: 9.9, max_limit: 10.2, sort_order: 0 })
    .mockResolvedValueOnce({ id: 9, part_type_id: 7, control_plan: "L1", name: "Longitud", unit: "mm", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 20, tol_plus: null, tol_minus: null, min_limit: 19.5, max_limit: 20.5, sort_order: 1 });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Características" }));
  await user.type(await screen.findByLabelText("Plan de control"), "D1");
  await user.type(screen.getByLabelText("Nombre"), "Diámetro");
  await user.type(screen.getByLabelText("Unidad"), "mm");
  await user.type(screen.getByLabelText("Método de medición"), "Micrómetro");
  await user.type(screen.getByLabelText("Nominal"), "10");
  await user.type(screen.getByLabelText("Tolerancia superior"), "0.2");
  await user.type(screen.getByLabelText("Tolerancia inferior"), "0.1");
  await user.click(screen.getByRole("button", { name: "Guardar característica" }));
  expect(api.catalog.createCharacteristic).toHaveBeenLastCalledWith(7, expect.objectContaining({
    control_plan: "D1", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .1,
  }));
  expect(await screen.findByText(/Micrómetro · Nominal 10 · Límites 9.9 — 10.2/)).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Formato de tolerancia"), "LIMITS");
  await user.type(screen.getByLabelText("Plan de control"), "L1");
  await user.type(screen.getByLabelText("Método de medición"), "Calibrador");
  await user.type(screen.getByLabelText("Nominal"), "20");
  await user.type(screen.getByLabelText("Límite mínimo"), "19.5");
  await user.type(screen.getByLabelText("Límite máximo"), "20.5");
  await user.type(screen.getByLabelText("Orden"), "1");
  await user.click(screen.getByRole("button", { name: "Guardar característica" }));
  expect(api.catalog.createCharacteristic).toHaveBeenLastCalledWith(7, expect.objectContaining({
    control_plan: "L1", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 20,
    tol_plus: null, tol_minus: null, min_limit: 19.5, max_limit: 20.5,
  }));
});

it("omits the lower tolerance so the API can default it to the upper tolerance", async () => {
  api.catalog.createCharacteristic.mockResolvedValue({ id: 8, part_type_id: 7, control_plan: "D1", name: null, unit: null, measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Características" }));
  await user.type(screen.getByLabelText("Plan de control"), "D1");
  await user.type(screen.getByLabelText("Método de medición"), "Micrómetro");
  await user.type(screen.getByLabelText("Nominal"), "10");
  await user.type(screen.getByLabelText("Tolerancia superior"), "0.2");
  await user.click(screen.getByRole("button", { name: "Guardar característica" }));
  expect(api.catalog.createCharacteristic).toHaveBeenCalledWith(7, expect.objectContaining({ tol_plus: .2, tol_minus: null }));
  expect(await screen.findByText(/Límites 9.8 — 10.2/)).toBeInTheDocument();
});

it("positions and displays a marker by its C.P. control-plan code", async () => {
  const characteristic = { id: 8, part_type_id: 7, control_plan: "CP-01", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 };
  api.catalog.characteristics.mockResolvedValue([characteristic]);
  api.catalog.createBalloon.mockResolvedValue({ id: 3, part_type_id: 7, characteristic_id: 8, x: .5, y: .5 });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Plano" }));
  const image = await screen.findByAltText("Plano de PT-100");
  await user.click(screen.getByRole("button", { name: "Acercar plano" }));
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 125, height: 125 } as DOMRect);
  fireEvent.click(image, { clientX: 72.5, clientY: 82.5 });
  await user.selectOptions(screen.getByLabelText("Característica del marcador"), "8");
  await user.click(screen.getByRole("button", { name: "Guardar marcador" }));
  expect(api.catalog.createBalloon).toHaveBeenCalledWith(7, { characteristic_id: 8, x: .5, y: .5 });
  expect(await screen.findByRole("button", { name: "Marcador C.P. CP-01" })).toHaveTextContent("CP-01");
});

it("rejects a blank method or non-finite canonical values before calling the API", async () => {
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Características" }));
  await user.type(await screen.findByLabelText("Plan de control"), "D1");
  await user.type(screen.getByLabelText("Nominal"), "10");
  await user.type(screen.getByLabelText("Tolerancia superior"), "0.2");
  fireEvent.submit(screen.getByRole("form", { name: "Definir característica" }));
  expect(screen.getByRole("alert")).toHaveTextContent("El método de medición es obligatorio");
  expect(api.catalog.createCharacteristic).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText("Método de medición"), "Micrómetro");
  fireEvent.change(screen.getByLabelText("Nominal"), { target: { value: "1e309" } });
  fireEvent.submit(screen.getByRole("form", { name: "Definir característica" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa valores numéricos finitos");
  expect(api.catalog.createCharacteristic).not.toHaveBeenCalled();

  await user.selectOptions(screen.getByLabelText("Formato de tolerancia"), "LIMITS");
  await user.type(screen.getByLabelText("Nominal"), "10");
  await user.type(screen.getByLabelText("Límite mínimo"), "11");
  await user.type(screen.getByLabelText("Límite máximo"), "12");
  fireEvent.submit(screen.getByRole("form", { name: "Definir característica" }));
  expect(screen.getByRole("alert")).toHaveTextContent("El nominal debe estar entre los límites");
  expect(api.catalog.createCharacteristic).not.toHaveBeenCalled();
});

it("searches part number, description and ID with status filtering and deterministic sorting", async () => {
  api.catalog.list.mockResolvedValue([
    part,
    { ...part, id: 12, part_number: "AX-20", part_description: "Carcasa exterior", active: false },
    { ...part, id: 3, part_number: "AX-2", part_description: "Soporte" },
  ]);
  const user = userEvent.setup(); render(<Catalog role="inspector" />);
  await screen.findByRole("button", { name: "Ver PT-100" });
  const search = screen.getByLabelText("Buscar por número de parte, descripción o ID");
  await user.type(search, " ax ");
  expect(screen.getAllByRole("button", { name: /^Ver / }).map((item) => item.textContent)).toEqual([expect.stringContaining("AX-2ID 3"), expect.stringContaining("AX-20ID 12")]);
  await user.selectOptions(screen.getByLabelText("Estado"), "active");
  expect(screen.queryByRole("button", { name: "Ver AX-20" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Estado"), "all");
  await user.clear(search); await user.type(search, "CARCASA");
  expect(screen.getByRole("button", { name: "Ver AX-20" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ver AX-2" })).not.toBeInTheDocument();
  await user.clear(search); await user.type(search, "12");
  expect(screen.getAllByRole("button", { name: /^Ver / })).toHaveLength(1);
  await user.clear(search);
  await user.selectOptions(screen.getByLabelText("Ordenar por"), "id-desc");
  expect(screen.getAllByRole("button", { name: /^Ver / }).map((item) => item.getAttribute("aria-label"))).toEqual(["Ver AX-20", "Ver PT-100", "Ver AX-2"]);
  await user.type(search, "missing");
  expect(screen.getByText("No se encontraron piezas con esos criterios.")).toBeInTheDocument();
});

it("separates detail from the catalog, preserves filters on return, and resets forms across parts", async () => {
  const other = { ...part, id: 8, part_number: "PT-200", part_description: "Segunda" };
  api.catalog.list.mockResolvedValue([part, other]);
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  const search = screen.getByLabelText("Buscar por número de parte, descripción o ID");
  await user.type(search, "PT");
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await screen.findByRole("tab", { name: "Datos" });
  expect(screen.queryByRole("button", { name: "Ver PT-200" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Buscar por número de parte, descripción o ID")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("Número de parte"));
  await user.type(screen.getByLabelText("Número de parte"), "Unsaved");
  await user.click(screen.getByRole("button", { name: "Volver al catálogo" }));
  expect(screen.getByLabelText("Buscar por número de parte, descripción o ID")).toHaveValue("PT");
  await user.click(screen.getByRole("button", { name: "Ver PT-200" }));
  expect(await screen.findByLabelText("Número de parte")).toHaveValue("PT-200");
  expect(screen.getByLabelText("Descripción de parte")).toHaveValue("Segunda");
});

it("ignores a late detail response from a previously selected part", async () => {
  const other = { ...part, id: 8, part_number: "PT-200", part_description: "Segunda" };
  api.catalog.list.mockResolvedValue([part, other]);
  let resolveOld!: (value: unknown[]) => void;
  api.catalog.characteristics.mockImplementation((id: number) => id === 7 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve([]));
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  expect(screen.getByText("Cargando detalle…")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Volver al catálogo" }));
  await user.click(screen.getByRole("button", { name: "Ver PT-200" }));
  await user.click(await screen.findByRole("tab", { name: "Características" }));
  await act(async () => resolveOld([{ id: 90, control_plan: "STALE", measurement_method: "Old" }]));
  expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  expect(screen.getByText("Este tipo no tiene características.")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Datos" }));
  expect(screen.getByLabelText("Número de parte")).toHaveValue("PT-200");
});

it("requires confirmation to deactivate and refreshes the live part and history", async () => {
  api.catalog.patchPart.mockImplementation(async () => {
    api.catalog.list.mockResolvedValue([{ ...part, active: false, revision_no: 2 }]);
    return { ...part, active: false, revision_no: 2 };
  });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("button", { name: "Desactivar tipo" }));
  expect(api.catalog.patchPart).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Confirmar cambio" })).toHaveTextContent("no se podrán iniciar nuevas inspecciones");
  await user.click(screen.getByRole("button", { name: "Cancelar cambio" }));
  expect(api.catalog.patchPart).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Desactivar tipo" }));
  await user.click(screen.getByRole("button", { name: "Confirmar cambio" }));
  expect(await screen.findByRole("button", { name: "Activar tipo" })).toBeInTheDocument();
  expect(api.catalog.patchPart).toHaveBeenCalledExactlyOnceWith(7, { active: false });
  expect(api.catalog.revisions).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/ID 7 · Revisión 2 · Inactivo/)).toBeInTheDocument();
});

it("confirms characteristic deletion and refreshes dependent markers", async () => {
  const characteristic = { id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", nominal: 10, min_limit: 9, max_limit: 11 };
  api.catalog.characteristics.mockResolvedValue([characteristic]);
  api.catalog.balloons.mockResolvedValue([{ id: 3, characteristic_id: 8, x: .5, y: .5 }]);
  api.catalog.deleteCharacteristic.mockImplementation(async () => {
    api.catalog.characteristics.mockResolvedValue([]); api.catalog.balloons.mockResolvedValue([]);
  });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Características" }));
  await user.click(screen.getByRole("button", { name: "Eliminar D1" }));
  expect(api.catalog.deleteCharacteristic).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Confirmar cambio" })).toHaveTextContent("Si tiene mediciones, se conservará inactiva");
  await user.click(screen.getByRole("button", { name: "Confirmar cambio" }));
  expect(await screen.findByText("Este tipo no tiene características.")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Plano" }));
  expect(screen.queryByRole("button", { name: "Marcador C.P. D1" })).not.toBeInTheDocument();
  expect(api.catalog.balloons).toHaveBeenCalledTimes(2);
});

it("restores only after an admin preview and refreshes the part, definition and immutable history", async () => {
  const snapshot = { part_number: "PT-OLD", part_description: "Anterior", image_path: "old.png", active: false, characteristics: [] };
  const oldRevision = { id: 1, part_type_id: 7, revision_no: 1, created_by: 1, created_at: "2026-09-01T10:00:00Z", definition_json: JSON.stringify(snapshot) };
  const currentRevision = { ...oldRevision, id: 2, revision_no: 2, definition_json: JSON.stringify({ ...snapshot, ...part }) };
  api.catalog.list.mockResolvedValue([{ ...part, revision_no: 2 }]);
  api.catalog.revisions.mockResolvedValue([oldRevision, currentRevision]);
  api.catalog.restoreRevision.mockImplementation(async () => {
    const restored = { ...oldRevision, id: 3, revision_no: 3 };
    api.catalog.list.mockResolvedValue([{ ...part, ...snapshot, revision_no: 3 }]);
    api.catalog.revisions.mockResolvedValue([oldRevision, currentRevision, restored]);
    return restored;
  });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Historial" }));
  await user.click(screen.getByRole("button", { name: "Vista previa de restauración 1" }));
  const preview = screen.getByRole("region", { name: "Confirmar restauración de revisión 1" });
  expect(within(preview).getByRole("row", { name: "Número de parte PT-100 PT-OLD" })).toBeInTheDocument();
  expect(api.catalog.restoreRevision).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirmar restauración" }));
  expect(await screen.findByText("Revisión 3 · Actual")).toBeInTheDocument();
  expect(api.catalog.restoreRevision).toHaveBeenCalledExactlyOnceWith(7, 1);
  expect(api.catalog.characteristics).toHaveBeenCalledTimes(2);
  expect(api.catalog.balloons).toHaveBeenCalledTimes(2);
  expect(api.catalog.revisions).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("tab", { name: "Datos" }));
  expect(screen.getByLabelText("Número de parte")).toHaveValue("PT-OLD");
  expect(screen.getByLabelText("Descripción de parte")).toHaveValue("Anterior");
  await user.click(screen.getByRole("button", { name: "Volver al catálogo" }));
  expect(screen.getByRole("button", { name: "Ver PT-OLD" })).toHaveTextContent("Inactivo");
});

it("keeps every inspector section read-only, including history and drawing markers", async () => {
  const snapshot = { part_number: "PT-100", part_description: "Inicial", image_path: null, active: true, characteristics: [] };
  api.catalog.revisions.mockResolvedValue([1, 2].map((revision_no) => ({ id: revision_no, part_type_id: 7, revision_no, definition_json: JSON.stringify(snapshot), created_by: null, created_at: "2026-09-01T10:00:00Z" })));
  api.catalog.list.mockResolvedValue([{ ...part, revision_no: 2 }]);
  const user = userEvent.setup(); render(<Catalog role="inspector" />);
  expect(screen.queryByRole("button", { name: "Agregar pieza" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await screen.findByRole("tab", { name: "Datos" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Características" }));
  expect(screen.queryByRole("button", { name: /Guardar|Editar|Eliminar/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Plano" }));
  expect(screen.queryByLabelText("Imagen de la pieza")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Guardar marcador/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Historial" }));
  expect(screen.getByText("Revisión 2 · Actual")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /restauración/ })).not.toBeInTheDocument();
});

it("blocks duplicate mutations and distinguishes a saved mutation from a failed refresh", async () => {
  let resolveSave!: (value: unknown) => void;
  api.catalog.patchPart.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("button", { name: "Guardar tipo" }));
  expect(screen.getByRole("button", { name: "Guardar tipo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Volver al catálogo" })).toBeDisabled();
  api.catalog.revisions.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => resolveSave(part));
  expect(await screen.findByRole("alert")).toHaveTextContent("El cambio se guardó, pero no se pudo actualizar el detalle");
  expect(api.catalog.patchPart).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Guardar tipo" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reintentar detalle" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar tipo" })).toBeEnabled());
});

it("confirms marker removal without deleting its characteristic", async () => {
  api.catalog.characteristics.mockResolvedValue([{ id: 8, part_type_id: 7, control_plan: "D1" }]);
  api.catalog.balloons.mockResolvedValue([{ id: 3, characteristic_id: 8, x: .5, y: .5 }]);
  api.catalog.deleteBalloon.mockImplementation(async () => { api.catalog.balloons.mockResolvedValue([]); });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Plano" }));
  await user.click(screen.getByRole("button", { name: "Eliminar marcador D1" }));
  expect(api.catalog.deleteBalloon).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancelar cambio" })).toHaveFocus();
  expect(screen.getByRole("region", { name: "Confirmar cambio" })).toHaveTextContent("La característica y las revisiones anteriores se conservarán");
  await user.click(screen.getByRole("button", { name: "Confirmar cambio" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Marcador C.P. D1" })).not.toBeInTheDocument());
  expect(api.catalog.deleteBalloon).toHaveBeenCalledExactlyOnceWith(3);
  expect(api.catalog.deleteCharacteristic).not.toHaveBeenCalled();
  expect(screen.getByRole("option", { name: "D1" })).toBeInTheDocument();
});

it("refreshes an uploaded drawing with a revision-qualified image URL", async () => {
  api.catalog.list.mockResolvedValue([{ ...part, image_path: null }]);
  api.catalog.uploadImage.mockImplementation(async () => {
    const updated = { ...part, image_path: "7-v2.png", revision_no: 2 };
    api.catalog.list.mockResolvedValue([updated]); return updated;
  });
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  await user.click(await screen.findByRole("tab", { name: "Plano" }));
  expect(screen.getByText("No hay plano disponible.")).toBeInTheDocument();
  const file = new File(["image"], "drawing.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Imagen de la pieza"), file);
  expect(await screen.findByAltText("Plano de PT-100")).toHaveAttribute("src", "/api/part-types/7/image?revision=2");
  expect(api.catalog.uploadImage).toHaveBeenCalledExactlyOnceWith(7, file);
  expect(api.catalog.revisions).toHaveBeenCalledTimes(2);
});

it("supports arrow, Home and End keys in the detail tablist", async () => {
  const user = userEvent.setup(); render(<Catalog role="inspector" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
  const data = await screen.findByRole("tab", { name: "Datos" });
  data.focus(); await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Plano" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Plano" })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Historial" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(data).toHaveFocus();
});
