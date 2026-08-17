import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Deviations from "./Deviations";

const api = vi.hoisted(() => ({
  deviations: { list: vi.fn(), dispose: vi.fn() },
  inspections: { detail: vi.fn(), annul: vi.fn(), report: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const inspection = { id: 20, part_type_code: "PT-100", serial: "SER-1", inspector: "luis", completed_at: "2026-08-17T10:00:00Z", status: "PENDING" };
const group = { inspection, measurements: [
  { id: 30, characteristic_id: 8, actual_value: 10.5, deviation: .5, status: "PENDING" },
  { id: 31, characteristic_id: 9, actual_value: 12.5, deviation: 1.5, status: "PENDING" },
] };

beforeEach(() => {
  vi.clearAllMocks();
  api.deviations.list.mockResolvedValue({ groups: [group] });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "PENDING", measurements: [] });
  api.inspections.report.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

it("groups pending measurements and refreshes the server status after an accepted disposition", async () => {
  api.deviations.dispose.mockResolvedValue({ ...group.measurements[0], status: "DEVIATION_ACCEPTED" });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "ACCEPTED_WITH_DEVIATIONS", measurements: [] });
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValueOnce({ groups: [] });
  const user = userEvent.setup(); render(<Deviations />);

  expect(await screen.findByRole("heading", { name: "PT-100 · SER-1" })).toBeInTheDocument();
  expect(screen.getByText("Valor real: 10.5 · Desviación: 0.5 · Estado: PENDING")).toBeInTheDocument();
  fireEvent.submit(screen.getByRole("form", { name: "Disponer medición 30" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Escribe una nota o motivo");
  expect(api.deviations.dispose).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText("Nota o motivo de la medición 30"), "Concesión aprobada");
  await user.click(screen.getByRole("button", { name: "Guardar disposición de medición 30" }));
  expect(api.deviations.dispose).toHaveBeenCalledWith(30, { action: "accept", text: "Concesión aprobada" });
  expect(await screen.findByRole("status")).toHaveTextContent("Estado de inspección: ACCEPTED_WITH_DEVIATIONS");
  await waitFor(() => expect(api.deviations.list).toHaveBeenCalledTimes(2));
});

it("sends a mandatory rejection reason without deriving a client status", async () => {
  api.deviations.dispose.mockResolvedValue({ ...group.measurements[1], status: "REJECTED" });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "REJECTED", measurements: [] });
  const user = userEvent.setup(); render(<Deviations />);
  await user.selectOptions(await screen.findByLabelText("Decisión para medición 31"), "reject");
  await user.type(screen.getByLabelText("Nota o motivo de la medición 31"), "Rechazar pieza");
  await user.click(screen.getByRole("button", { name: "Guardar disposición de medición 31" }));
  expect(api.deviations.dispose).toHaveBeenCalledWith(31, { action: "reject", text: "Rechazar pieza" });
  expect(await screen.findByRole("status")).toHaveTextContent("Estado de inspección: REJECTED");
});

it("downloads the authorized PDF and requires a reason before annulment", async () => {
  api.inspections.annul.mockResolvedValue({ ...inspection, annulled_at: "2026-08-17T11:00:00Z", annulment_reason: "Serie incorrecta" });
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValueOnce({ groups: [] });
  const user = userEvent.setup(); render(<Deviations />);
  await user.click(await screen.findByRole("button", { name: "Descargar informe de SER-1" }));
  expect(api.inspections.report).toHaveBeenCalledWith(20);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

  fireEvent.submit(screen.getByRole("form", { name: "Anular inspección SER-1" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo de anulación");
  expect(api.inspections.annul).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Motivo de anulación de SER-1"), "Serie incorrecta");
  await user.click(screen.getByRole("button", { name: "Anular inspección SER-1" }));
  expect(api.inspections.annul).toHaveBeenCalledWith(20, "Serie incorrecta");
  expect(await screen.findByRole("status")).toHaveTextContent("Inspección anulada");
});
