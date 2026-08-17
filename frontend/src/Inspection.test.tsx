import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Inspection from "./Inspection";

const api = vi.hoisted(() => ({
  catalog: { list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn(), imageUrl: vi.fn((id) => `/api/part-types/${id}/image`) },
  inspections: { start: vi.fn(), record: vi.fn(), complete: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const part = { id: 7, code: "PT-100", image_path: "7.png", active: true };
const characteristics = [
  { id: 8, part_type_id: 7, code: "D1", name: "Diámetro", unit: "mm", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, min_limit: null, max_limit: null, sort_order: 0 },
  { id: 9, part_type_id: 7, code: "L1", name: "Longitud", unit: "mm", tol_type: "LIMITS", nominal: null, tol_plus: null, min_limit: 9, max_limit: 11, sort_order: 1 },
];
const inspection = { id: 20, part_type_id: 7, serial: "SER-1", inspector: "luis", status: "PENDING", started_at: "2026-08-17", completed_at: null, annulled_at: null, characteristic_ids: [8, 9], measurements: [] };

beforeEach(() => {
  vi.clearAllMocks();
  api.catalog.list.mockResolvedValue([part, { ...part, id: 10, code: "INACTIVA", active: false }]);
  api.catalog.characteristics.mockResolvedValue(characteristics);
  api.catalog.balloons.mockResolvedValue([
    { id: 1, part_type_id: 7, number: 4, characteristic_id: 8, x: .2, y: .3 },
    { id: 2, part_type_id: 7, number: 5, characteristic_id: 9, x: .7, y: .8 },
  ]);
  api.inspections.start.mockResolvedValue(inspection);
});

it("guides selected characteristics and displays only server-returned statuses", async () => {
  api.inspections.record
    .mockResolvedValueOnce({ id: 30, characteristic_id: 8, actual_value: 10.1, status: "IN_TOLERANCE" })
    .mockResolvedValueOnce({ id: 31, characteristic_id: 9, actual_value: 12.5, status: "PENDING" });
  api.inspections.complete.mockResolvedValue({ ...inspection, completed_at: "2026-08-17", status: "PENDING" });
  const user = userEvent.setup(); render(<Inspection />);

  const type = await screen.findByLabelText("Tipo de pieza activo");
  expect(screen.queryByRole("option", { name: "INACTIVA" })).not.toBeInTheDocument();
  await user.selectOptions(type, "7");
  await user.type(screen.getByLabelText("Número de serie"), "SER-1");
  await user.click(await screen.findByLabelText(/D1/)); await user.click(screen.getByLabelText(/L1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  expect(api.inspections.start).toHaveBeenCalledWith({ part_type_id: 7, serial: "SER-1", characteristic_ids: [8, 9] });

  expect(await screen.findByAltText("Plano de PT-100")).toBeInTheDocument();
  expect(screen.getByText("Nominal: 10 mm")).toBeInTheDocument();
  expect(screen.getByText("Tolerancia: ±0.2 mm")).toBeInTheDocument();
  expect(screen.getByLabelText("Globo activo 4")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Valor real (mm)"), "10.1");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByText("IN_TOLERANCE")).toBeInTheDocument();
  expect(screen.getByLabelText("Globo activo 5")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Anterior" }));
  expect(screen.getByLabelText("Globo activo 4")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Siguiente" }));

  await user.type(screen.getByLabelText("Valor real (mm)"), "12.5");
  await user.click(screen.getByRole("button", { name: "Registrar valor" }));
  expect(await screen.findByText("PENDING")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Completar inspección" }));
  expect(await screen.findByText("Estado final: PENDING")).toBeInTheDocument();
});

it("rejects an invalid actual value without sending a measurement", async () => {
  const user = userEvent.setup(); render(<Inspection />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza activo"), "7");
  await user.type(screen.getByLabelText("Número de serie"), "SER-1");
  await user.click(await screen.findByLabelText(/D1/));
  await user.click(screen.getByRole("button", { name: "Iniciar inspección" }));
  await user.click(await screen.findByRole("button", { name: "Registrar valor" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa un valor numérico válido en mm.");
  expect(api.inspections.record).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText("D1 — Diámetro")).toBeInTheDocument());
});
