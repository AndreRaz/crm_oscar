import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Deviations from "./Deviations";

const api = vi.hoisted(() => ({
  approvedDeviations: { listActive: vi.fn() },
  deviations: { list: vi.fn(), resolve: vi.fn() },
  inspections: { detail: vi.fn(), annul: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const inspection = {
  id: 20, part_number: "PT-100", inspector: "luis",
  completed_at: "2026-08-17T10:00:00Z", annulled_at: null, status: "PENDING",
};
const group = {
  inspection,
  measurements: [
    { id: 30, characteristic_id: 8, actual_value: 10.5, deviation: .5, status: "PENDING" },
    { id: 31, characteristic_id: 9, actual_value: 10, deviation: null, status: "IN_TOLERANCE" },
  ],
  deviations: [
    { id: 50, measurement_id: 30, origin: "AUTO", status: "PENDING", description: null, created_by: null, created_at: "2026-08-17T10:00:00Z", approved_deviation_id: null, approved_deviation_code_snapshot: null, approved_deviation_description_snapshot: null, rejection_reason: null, resolved_by: null, resolved_at: null },
    { id: 51, measurement_id: 31, origin: "MANUAL", status: "PENDING", description: "Acabado superficial", created_by: 2, created_at: "2026-08-17T10:05:00Z", approved_deviation_id: null, approved_deviation_code_snapshot: null, approved_deviation_description_snapshot: null, rejection_reason: null, resolved_by: null, resolved_at: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.approvedDeviations.listActive.mockResolvedValue([
    { id: 7, code: "DEV-7", description: "Uso aprobado", active: true, created_at: "2026-08-01" },
  ]);
  api.deviations.list.mockResolvedValue({ groups: [group] });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "PENDING", measurements: [] });
});

it("shows the shared pending list to inspectors without serials or action controls", async () => {
  render(<Deviations role="inspector" />);

  expect(await screen.findByRole("heading", { name: "PT-100 · Inspección 20" })).toBeInTheDocument();
  expect(screen.getAllByText("Pendiente")).toHaveLength(2);
  expect(screen.getByText("Automática · Medición 30")).toBeInTheDocument();
  expect(screen.getByText("Manual · Medición 31")).toBeInTheDocument();
  expect(screen.getByText("Descripción: Acabado superficial")).toBeInTheDocument();
  expect(screen.queryByText(/SER-|serial/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: /Resolver desviación/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /informe/i })).not.toBeInTheDocument();
  expect(api.approvedDeviations.listActive).not.toHaveBeenCalled();
});

it("lets an administrator accept with an active approved-deviation entry", async () => {
  api.deviations.resolve.mockResolvedValue({ ...group.deviations[0], status: "ACCEPTED", approved_deviation_id: 7 });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "ACCEPTED_WITH_DEVIATIONS", measurements: [] });
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValueOnce({ groups: [] });
  const user = userEvent.setup();
  render(<Deviations role="admin" />);

  await user.selectOptions(await screen.findByLabelText("Desviación aprobada para desviación 50"), "7");
  await user.click(screen.getByRole("button", { name: "Resolver desviación 50" }));

  expect(api.approvedDeviations.listActive).toHaveBeenCalledOnce();
  expect(api.deviations.resolve).toHaveBeenCalledWith(50, { action: "accept", approved_deviation_id: 7 });
  expect(await screen.findByRole("status")).toHaveTextContent("Estado de inspección: ACCEPTED_WITH_DEVIATIONS");
  await waitFor(() => expect(api.deviations.list).toHaveBeenCalledTimes(2));
});

it("requires and submits a rejection reason without an approved entry", async () => {
  api.deviations.resolve.mockResolvedValue({ ...group.deviations[1], status: "REJECTED", rejection_reason: "Rechazar pieza" });
  api.inspections.detail.mockResolvedValue({ ...inspection, status: "REJECTED", measurements: [] });
  const user = userEvent.setup();
  render(<Deviations role="admin" />);

  await user.selectOptions(await screen.findByLabelText("Decisión para desviación 51"), "reject");
  fireEvent.submit(screen.getByRole("form", { name: "Resolver desviación 51" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo de rechazo");
  expect(api.deviations.resolve).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText("Motivo de rechazo para desviación 51"), "Rechazar pieza");
  await user.click(screen.getByRole("button", { name: "Resolver desviación 51" }));
  expect(api.deviations.resolve).toHaveBeenCalledWith(51, { action: "reject", rejection_reason: "Rechazar pieza" });
  expect(await screen.findByRole("status")).toHaveTextContent("Estado de inspección: REJECTED");
});

it("preserves manual deviations on annulled inspections while suppressing repeat annulment", async () => {
  const annulledGroup = {
    inspection: { ...inspection, id: 22, annulled_at: "2026-08-18T11:30:00Z", status: "CONFORMING" },
    measurements: [{ id: 32, characteristic_id: 9, actual_value: 10, deviation: null, status: "IN_TOLERANCE" }],
    deviations: [{ ...group.deviations[1], id: 52, measurement_id: 32, description: "Rayadura visible" }],
  };
  api.deviations.list.mockResolvedValue({ groups: [annulledGroup] });
  render(<Deviations role="admin" />);

  expect(await screen.findByText("Anulada: 2026-08-18T11:30:00Z")).toBeInTheDocument();
  expect(screen.getByText("Manual · Medición 32")).toBeInTheDocument();
  expect(screen.getByText("Valor real: 10 · Desviación: — · Estado: IN_TOLERANCE")).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Resolver desviación 52" })).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Anular inspección 22" })).not.toBeInTheDocument();
});
