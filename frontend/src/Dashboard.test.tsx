import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { DeviationGroup, Inspection, PartType, User } from "./api/client";

const api = vi.hoisted(() => ({ inspections: { list: vi.fn() }, catalog: { list: vi.fn() }, deviations: { list: vi.fn() } }));
vi.mock("./api/client", () => ({ api }));
const account: User = { id: 1, username: "Ana", role: "admin", active: true };
const part: PartType = { id: 7, part_number: "PT-100", part_description: "Eje", active: true, image_path: null, revision_no: 1 };
const inspection: Inspection = { id: 20, part_type_id: 7, part_revision_id: 1, inspector: "Ana", started_at: "2026-09-05T10:00:00Z", completed_at: null, annulled_at: null, characteristic_ids: [1], measurements: [], status: "PENDING" };

beforeEach(() => {
  vi.clearAllMocks();
  api.catalog.list.mockResolvedValue([part]);
  api.inspections.list.mockResolvedValue([]);
  api.deviations.list.mockResolvedValue({ groups: [] });
});

it("counts server-scoped pending work and complete report requirements, with working shortcuts", async () => {
  api.inspections.list.mockResolvedValue([
    inspection,
    { ...inspection, id: 21, completed_at: "2026-09-05T11:00:00Z", status: "CONFORMING", measurements: [{ id: 3, characteristic_id: 1, actual_value: 10, status: "IN_TOLERANCE" }] },
    { ...inspection, id: 22, completed_at: "2026-09-05T11:00:00Z", annulled_at: "2026-09-05T12:00:00Z", measurements: [{ id: 4, characteristic_id: 1, actual_value: 12, status: "PENDING" }] },
  ]);
  api.deviations.list.mockResolvedValue({ groups: [{ inspection: { id: 20 }, deviations: [{ status: "PENDING" }, { status: "ACCEPTED" }] }] as DeviationGroup[] });
  const navigate = vi.fn(); const user = userEvent.setup();
  render(<Dashboard user={account} onNavigate={navigate} />);
  const pending = await screen.findByRole("button", { name: /Por continuar/ });
  expect(within(pending).getByText("1")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: /Desviaciones pendientes/ })).getByText("1")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: /Listas para informe/ })).getByText("1")).toBeInTheDocument();
  await user.click(pending); expect(navigate).toHaveBeenLastCalledWith("inspection");
  await user.click(screen.getByRole("button", { name: /Desviaciones pendientes/ })); expect(navigate).toHaveBeenLastCalledWith("deviations");
  await user.click(screen.getByRole("button", { name: /Listas para informe/ })); expect(navigate).toHaveBeenLastCalledWith("reports");
  expect(screen.getByText("Anulado")).toBeInTheDocument();
});

it("never marks a measurement-complete inspection ready when manual deviations or part details are missing", async () => {
  const measured = { ...inspection, measurements: [{ id: 3, characteristic_id: 1, actual_value: 10, status: "IN_TOLERANCE" }] };
  api.inspections.list.mockResolvedValue([measured, { ...measured, id: 21, part_type_id: 8 }]);
  api.catalog.list.mockResolvedValue([part, { ...part, id: 8, part_description: " " }]);
  api.deviations.list.mockResolvedValue({ groups: [{ inspection: { id: 20 }, deviations: [{ status: "PENDING" }] }] });
  render(<Dashboard user={{ ...account, role: "inspector" }} onNavigate={vi.fn()} />);
  expect(within(await screen.findByRole("button", { name: /Listas para informe/ })).getByText("0")).toBeInTheDocument();
  expect(screen.getByText(/Tus inspecciones e informes/)).toBeInTheDocument();
  expect(api.inspections.list).toHaveBeenCalledWith();
  expect(api.deviations.list).toHaveBeenCalledWith();
});

it("does not present failed loading as zero pending work and supports retry", async () => {
  api.inspections.list.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce([]);
  const user = userEvent.setup(); render(<Dashboard user={account} onNavigate={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar");
  expect(screen.queryByRole("button", { name: /Por continuar/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reintentar resumen" }));
  expect(await screen.findByRole("button", { name: /Por continuar/ })).toBeInTheDocument();
});
