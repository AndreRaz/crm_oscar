import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Catalog from "./Catalog";

const api = vi.hoisted(() => ({
  catalog: {
    list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn(), imageUrl: vi.fn(),
    createPart: vi.fn(), patchPart: vi.fn(), uploadImage: vi.fn(),
    createCharacteristic: vi.fn(), patchCharacteristic: vi.fn(), deleteCharacteristic: vi.fn(),
    createBalloon: vi.fn(), deleteBalloon: vi.fn(),
  },
}));
vi.mock("./api/client", () => ({ api }));

const part = { id: 7, part_number: "PT-100", part_description: "Inicial", image_path: "7.png", revision_no: 1, active: true };

beforeEach(() => {
  vi.clearAllMocks();
  api.catalog.list.mockResolvedValue([part]);
  api.catalog.characteristics.mockResolvedValue([]);
  api.catalog.balloons.mockResolvedValue([]);
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
  const image = await screen.findByAltText("Plano de PT-100");
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 100, height: 100 } as DOMRect);
  fireEvent.click(image, { clientX: 60, clientY: 70 });
  await user.selectOptions(screen.getByLabelText("Característica del marcador"), "8");
  await user.click(screen.getByRole("button", { name: "Guardar marcador" }));
  expect(api.catalog.createBalloon).toHaveBeenCalledWith(7, { characteristic_id: 8, x: .5, y: .5 });
  expect(await screen.findByLabelText("Marcador CP-01")).toHaveTextContent("CP-01");
});

it("rejects a blank method or non-finite canonical values before calling the API", async () => {
  const user = userEvent.setup(); render(<Catalog role="admin" />);
  await user.click(await screen.findByRole("button", { name: "Ver PT-100" }));
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
