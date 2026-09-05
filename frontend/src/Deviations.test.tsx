import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Deviations from "./Deviations";

const api = vi.hoisted(() => ({
  approvedDeviations: { listActive: vi.fn() },
  deviations: { list: vi.fn(), resolve: vi.fn() },
  inspections: { annul: vi.fn() },
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
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("shows the shared pending list to inspectors without serials or action controls", async () => {
  render(<Deviations role="inspector" />);

  expect(await screen.findByRole("heading", { name: "PT-100 · Inspección 20" })).toBeInTheDocument();
  expect(screen.getAllByText("Pendiente").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("Automática · Medición 30")).toBeInTheDocument();
  expect(screen.getByText("Manual · Medición 31")).toBeInTheDocument();
  expect(screen.getByText("Descripción: Acabado superficial")).toBeInTheDocument();
  expect(screen.queryByText(/SER-|serial/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: /Resolver desviación/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /informe/i })).not.toBeInTheDocument();
  expect(api.approvedDeviations.listActive).not.toHaveBeenCalled();
  expect(api.deviations.list).toHaveBeenCalledExactlyOnceWith(true);
});

it("lets an administrator accept with an active approved-deviation entry", async () => {
  const accepted = { ...group.deviations[0], status: "ACCEPTED", approved_deviation_id: 7 };
  api.deviations.resolve.mockResolvedValue(accepted);
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValue({ groups: [{ ...group,
    inspection: { ...inspection, status: "ACCEPTED_WITH_DEVIATIONS" },
    deviations: [accepted, group.deviations[1]],
  }] });
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
  const rejected = { ...group.deviations[1], status: "REJECTED", rejection_reason: "Rechazar pieza" };
  api.deviations.resolve.mockResolvedValue(rejected);
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValue({ groups: [{ ...group,
    deviations: [group.deviations[0], rejected],
  }] });
  const user = userEvent.setup();
  render(<Deviations role="admin" />);

  await user.selectOptions(await screen.findByLabelText("Decisión para desviación 51"), "reject");
  fireEvent.submit(screen.getByRole("form", { name: "Resolver desviación 51" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo de rechazo");
  expect(api.deviations.resolve).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText("Motivo de rechazo para desviación 51"), "Rechazar pieza");
  await user.click(screen.getByRole("button", { name: "Resolver desviación 51" }));
  expect(api.deviations.resolve).toHaveBeenCalledWith(51, { action: "reject", rejection_reason: "Rechazar pieza" });
  expect(await screen.findByRole("status")).toHaveTextContent("Estado de inspección: PENDING");
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "REJECTED");
  expect(screen.getByText("Motivo de rechazo: Rechazar pieza")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Resolver desviación 51" })).not.toBeInTheDocument();
});

it("preserves manual deviations on annulled inspections while suppressing repeat annulment", async () => {
  const annulledGroup = {
    inspection: { ...inspection, id: 22, annulled_at: "2026-08-18T11:30:00Z", status: "CONFORMING" },
    measurements: [{ id: 32, characteristic_id: 9, actual_value: 10, deviation: null, status: "IN_TOLERANCE" }],
    deviations: [{ ...group.deviations[1], id: 52, measurement_id: 32, description: "Rayadura visible" }],
  };
  api.deviations.list.mockResolvedValue({ groups: [annulledGroup] });
  render(<Deviations role="admin" />);

  expect(await screen.findByText(/Anulada: 18 ago 2026/)).toBeInTheDocument();
  expect(screen.getByText("Manual · Medición 32")).toBeInTheDocument();
  expect(screen.getByText(/Valor real: 10 · Desviación: —/)).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Resolver desviación 52" })).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Anular inspección 22" })).not.toBeInTheDocument();
});

it("defaults to pending, searches parts, filters inspectors only for admins and preserves supplied evidence", async () => {
  const resolved = { ...group, inspection: { ...inspection, id: 21, inspector: "ana", part_number: "PT-200" }, deviations: [
    { ...group.deviations[0], id: 60, status: "ACCEPTED", approved_deviation_code_snapshot: "DEV-7", approved_deviation_description_snapshot: "Uso aprobado" },
    { ...group.deviations[1], id: 61, status: "REJECTED", rejection_reason: "Daño visible" },
  ] };
  api.deviations.list.mockResolvedValue({ groups: [group, resolved] });
  const user = userEvent.setup(); const { rerender } = render(<Deviations />);
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  expect(screen.getByLabelText("Estado de desviación")).toHaveValue("PENDING");
  expect(screen.queryByRole("heading", { name: "PT-200 · Inspección 21" })).not.toBeInTheDocument();
  expect(screen.getByText("Desviaciones pendientes: 2 · Inspecciones con pendientes: 1")).toBeInTheDocument();
  expect(screen.queryByLabelText("Inspector")).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: /Resolver/ })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "all");
  expect(screen.getByText("Catálogo aprobado: DEV-7 — Uso aprobado")).toBeInTheDocument();
  expect(screen.getByText("Motivo de rechazo: Daño visible")).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "pt-200");
  expect(screen.queryByRole("heading", { name: "PT-100 · Inspección 20" })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  rerender(<Deviations role="admin" />);
  await user.selectOptions(screen.getByLabelText("Inspector"), "ana");
  expect(screen.queryByRole("heading", { name: "PT-100 · Inspección 20" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "PT-200 · Inspección 21" })).toBeInTheDocument();
});

it("loads persisted resolution evidence after saving and after remounting the page", async () => {
  const accepted = { ...group.deviations[0], status: "ACCEPTED", approved_deviation_id: 7,
    approved_deviation_code_snapshot: "DEV-7", approved_deviation_description_snapshot: "Uso aprobado",
    resolved_at: "2026-08-19T10:00:00Z" };
  api.deviations.resolve.mockResolvedValue(accepted);
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockResolvedValue({ groups: [{ ...group,
    deviations: [accepted, group.deviations[1]],
    measurements: [{ ...group.measurements[0], status: "DEVIATION_ACCEPTED" }, group.measurements[1]],
  }] });
  const user = userEvent.setup(); const { unmount } = render(<Deviations role="admin" />);
  await user.selectOptions(await screen.findByLabelText("Desviación aprobada para desviación 50"), "7");
  await user.click(screen.getByRole("button", { name: "Resolver desviación 50" }));
  await screen.findByRole("status");
  expect(screen.queryByText("Catálogo aprobado: DEV-7 — Uso aprobado")).not.toBeInTheDocument();
  expect(screen.getByText("Desviaciones pendientes: 1 · Inspecciones con pendientes: 1")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "history");
  expect(screen.getByText("Catálogo aprobado: DEV-7 — Uso aprobado")).toBeInTheDocument();
  expect(screen.getByText(/Valor real: 10.5/)).toBeInTheDocument();
  expect(screen.getByText(/Historial guardado en el servidor/)).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Resolver desviación 50" })).not.toBeInTheDocument();
  unmount();
  render(<Deviations role="inspector" />);
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "history");
  expect(screen.getByText("Catálogo aprobado: DEV-7 — Uso aprobado")).toBeInTheDocument();
  expect(screen.getByText(/Valor real: 10.5/)).toHaveTextContent("Desviación aceptada");
  expect(api.deviations.list).toHaveBeenCalledTimes(3);
  expect(api.deviations.list.mock.calls).toEqual([[true], [true], [true]]);
});

it("filters persisted history by deviation creation dates with inclusive local endpoints", async () => {
  api.deviations.list.mockResolvedValue({ groups: [{ ...group,
    inspection: { ...inspection, completed_at: "2030-01-01T00:00:00" },
    deviations: [
      { ...group.deviations[0], created_at: "2026-08-17T00:00:00", description: "Start boundary" },
      { ...group.deviations[1], created_at: "2026-08-17T23:59:59.999", status: "REJECTED", rejection_reason: "End boundary", resolved_at: "2031-01-01T00:00:00" },
      { ...group.deviations[0], id: 52, created_at: "2026-08-18T00:00:00", description: "Next midnight" },
      { ...group.deviations[0], id: 53, created_at: "2026-08-16T23:59:59.999", description: "Previous day" },
    ],
  }] });
  const user = userEvent.setup(); render(<Deviations role="inspector" />);
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "all");
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-17" } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-17" } });
  expect(screen.getByText("Descripción: Start boundary")).toBeInTheDocument();
  expect(screen.getByText("Motivo de rechazo: End boundary")).toBeInTheDocument();
  expect(screen.queryByText("Descripción: Next midnight")).not.toBeInTheDocument();
  expect(screen.queryByText("Descripción: Previous day")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "history");
  expect(screen.queryByText("Descripción: Start boundary")).not.toBeInTheDocument();
  expect(screen.getByText("Motivo de rechazo: End boundary")).toBeInTheDocument();
  expect(api.deviations.list).toHaveBeenCalledExactlyOnceWith(true);
});

it("supports open date ranges and shows an invalid-range alert without stale results", async () => {
  const user = userEvent.setup(); render(<Deviations role="inspector" />);
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-18" } });
  expect(screen.getByText("No hay desviaciones que coincidan con los filtros.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-16" } });
  expect(screen.getByRole("alert")).toHaveTextContent("La fecha desde no puede ser posterior");
  expect(screen.queryByRole("heading", { name: "PT-100 · Inspección 20" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("No hay desviaciones que coincidan con los filtros.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-18" } });
  expect(screen.getByRole("heading", { name: "PT-100 · Inspección 20" })).toBeInTheDocument();
  expect(api.deviations.list).toHaveBeenCalledExactlyOnceWith(true);
});

it("does not offer stale mutations when a successful save cannot refresh persisted history", async () => {
  const rejected = { ...group.deviations[0], status: "REJECTED", rejection_reason: "Damaged part" };
  api.deviations.resolve.mockResolvedValue(rejected);
  api.deviations.list.mockResolvedValueOnce({ groups: [group] }).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ groups: [{ ...group, deviations: [rejected, group.deviations[1]] }] });
  const user = userEvent.setup(); render(<Deviations role="admin" />);
  await user.selectOptions(await screen.findByLabelText("Decisión para desviación 50"), "reject");
  await user.type(screen.getByLabelText("Motivo de rechazo para desviación 50"), "Damaged part");
  await user.click(screen.getByRole("button", { name: "Resolver desviación 50" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La disposición se guardó, pero no se pudieron actualizar las desviaciones. offline");
  expect(screen.getByRole("status")).toHaveTextContent("Disposición guardada.");
  expect(screen.queryByRole("form", { name: /Resolver/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reintentar carga de desviaciones" }));
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  await user.selectOptions(screen.getByLabelText("Estado de desviación"), "history");
  expect(screen.getByText("Motivo de rechazo: Damaged part")).toBeInTheDocument();
  expect(api.deviations.resolve).toHaveBeenCalledOnce();
});

it("locks all mutations until saving settles and allows retry after errors", async () => {
  let reject!: (error: Error) => void;
  api.deviations.resolve.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const user = userEvent.setup(); render(<Deviations role="admin" />);
  await user.selectOptions(await screen.findByLabelText("Desviación aprobada para desviación 50"), "7");
  const form = screen.getByRole("form", { name: "Resolver desviación 50" });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.deviations.resolve).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Decisión para desviación 51")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Anular inspección 20" })).toBeDisabled();
  await act(async () => reject(new Error("denied")));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la disposición. denied");
  expect(screen.getByRole("button", { name: "Resolver desviación 50" })).toBeEnabled();
  expect(screen.getByLabelText("Desviación aprobada para desviación 50")).toHaveValue("7");
});

it("requires a reason and explicit destructive confirmation, and supports cancellation with focus restoration", async () => {
  const user = userEvent.setup(); render(<Deviations role="admin" />);
  const annulButton = await screen.findByRole("button", { name: "Anular inspección 20" });
  await user.click(annulButton);
  expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo de anulación");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Motivo de anulación de inspección 20"), "Registro duplicado");
  await user.click(annulButton);
  const confirmation = screen.getByRole("dialog", { name: "¿Anular inspección 20?" });
  expect(confirmation).toHaveTextContent("Sus mediciones y evidencias se conservarán");
  expect(confirmation).toHaveTextContent("Motivo: Registro duplicado");
  expect(within(confirmation).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(api.inspections.annul).not.toHaveBeenCalled();
  fireEvent(confirmation, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(annulButton).toHaveFocus();
  expect(api.inspections.annul).not.toHaveBeenCalled();
});

it("confirms annulment once, locks pending actions, and keeps failures inside the dialog", async () => {
  let reject!: (error: Error) => void;
  api.inspections.annul.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const user = userEvent.setup(); render(<Deviations role="admin" />);
  await user.type(await screen.findByLabelText("Motivo de anulación de inspección 20"), "Registro duplicado");
  await user.click(screen.getByRole("button", { name: "Anular inspección 20" }));
  const confirm = screen.getByRole("button", { name: "Confirmar anulación" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(api.inspections.annul).toHaveBeenCalledExactlyOnceWith(20, "Registro duplicado");
  expect(screen.getByRole("button", { name: "Anulando…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await act(async () => reject(new Error("server unavailable")));
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("No se pudo anular la inspección. server unavailable");
  expect(screen.getByRole("button", { name: "Confirmar anulación" })).toBeEnabled();
  api.inspections.annul.mockResolvedValueOnce({ ...inspection, annulled_at: "2026-08-20T10:00:00Z" });
  api.deviations.list.mockResolvedValueOnce({ groups: [] });
  await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Inspección anulada.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not offer annulment for unfinished inspections or actions to inspectors", async () => {
  api.deviations.list.mockResolvedValue({ groups: [{ ...group, inspection: { ...inspection, completed_at: null } }] });
  const { rerender } = render(<Deviations role="admin" />);
  await screen.findByRole("heading", { name: "PT-100 · Inspección 20" });
  expect(screen.queryByRole("form", { name: "Anular inspección 20" })).not.toBeInTheDocument();
  rerender(<Deviations role="inspector" />);
  expect(screen.queryByRole("form", { name: /Resolver/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Inspector")).not.toBeInTheDocument();
});

it("reports queue and approved catalog failures without claiming an empty successful load", async () => {
  api.deviations.list.mockRejectedValueOnce(new Error("offline"));
  const first = render(<Deviations role="inspector" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la cola de desviaciones. offline");
  expect(screen.queryByText("Cargando desviaciones…")).not.toBeInTheDocument();
  expect(screen.queryByText(/Desviaciones pendientes: 0/)).not.toBeInTheDocument();
  first.unmount();
  api.approvedDeviations.listActive.mockRejectedValueOnce(new Error("denied"));
  render(<Deviations role="admin" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el catálogo de desviaciones aprobadas. denied");
});
