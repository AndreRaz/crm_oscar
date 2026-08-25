import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import GeneratedReports from "./GeneratedReports";

const api = vi.hoisted(() => ({
  auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  users: { list: vi.fn() },
  catalog: { list: vi.fn(), characteristics: vi.fn(), balloons: vi.fn() },
  deviations: { list: vi.fn() },
  inspections: { list: vi.fn() },
  reports: { list: vi.fn(), generate: vi.fn(), download: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const complete = {
  id: 20, part_type_id: 7, part_revision_id: 3, inspector: "luis", status: "CONFORMING",
  started_at: "2026-08-17T09:00:00Z", completed_at: "2026-08-17T10:00:00Z", annulled_at: null,
  characteristic_ids: [8], measurements: [{ id: 30, characteristic_id: 8, actual_value: 10, status: "IN_TOLERANCE" }],
};
const incomplete = {
  ...complete, id: 21, completed_at: null, characteristic_ids: [8, 9], measurements: [],
};
const report = {
  id: 90, inspection_id: 20, part_revision_id: 3, content_hash: "a".repeat(64),
  file_path: "report-90.pdf", generated_by: 1, generated_at: "2026-08-17T10:05:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.users.list.mockResolvedValue([]);
  api.catalog.list.mockResolvedValue([
    { id: 7, part_number: "PT-100", part_description: "Cuerpo", image_path: null, revision_no: 3, active: true },
  ]);
  api.catalog.characteristics.mockResolvedValue([]);
  api.catalog.balloons.mockResolvedValue([]);
  api.deviations.list.mockResolvedValue({ groups: [] });
  api.inspections.list.mockResolvedValue([complete, incomplete]);
  api.reports.list.mockResolvedValue([report]);
  api.reports.download.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

it.each([
  { id: 1, username: "ana", role: "admin", active: true },
  { id: 2, username: "luis", role: "inspector", active: true },
])("shows the generated-reports tab to authenticated $role users", async (account) => {
  api.auth.me.mockResolvedValue(account);
  const user = userEvent.setup();
  render(<App />);

  await user.click(await screen.findByRole("tab", { name: "Informes generados" }));
  expect(await screen.findByRole("heading", { name: "Informes generados" })).toBeInTheDocument();
  expect(api.reports.list).toHaveBeenCalledOnce();
  expect(api.inspections.list).toHaveBeenCalledWith();
});

it("lists authorized reports and downloads only persisted report records", async () => {
  const user = userEvent.setup();
  render(<GeneratedReports />);

  expect(await screen.findByText("Informe 90 · Inspección 20")).toBeInTheDocument();
  expect(screen.getByText("Revisión 3 · Generado 2026-08-17T10:05:00Z")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Descargar informe 90" }));

  expect(api.reports.download).toHaveBeenCalledWith(90);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

it("gates generation with a checklist and generates an eligible inspection", async () => {
  api.deviations.list.mockResolvedValue({ groups: [{ inspection: { id: 21 }, deviations: [{ status: "PENDING" }], measurements: [] }] });
  api.reports.generate.mockResolvedValue({ ...report, id: 91, file_path: "report-91.pdf" });
  const user = userEvent.setup();
  render(<GeneratedReports />);

  const eligible = await screen.findByRole("button", { name: "Generar informe de inspección 20" });
  const blocked = screen.getByRole("button", { name: "Generar informe de inspección 21" });
  expect(eligible).toBeEnabled();
  expect(blocked).toBeDisabled();
  expect(screen.getByText("Faltan 2 mediciones.")).toBeInTheDocument();
  expect(screen.getByText("Hay desviaciones pendientes.")).toBeInTheDocument();

  await user.click(eligible);
  expect(api.reports.generate).toHaveBeenCalledWith(20);
  await waitFor(() => expect(screen.getByText("Informe 91 · Inspección 20")).toBeInTheDocument());
});
