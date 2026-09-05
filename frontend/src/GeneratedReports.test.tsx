import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
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
  expect(screen.getByText(/Revisión 3 · Generado/)).toHaveTextContent("17 ago 2026");
  expect(screen.getByText(/17 ago 2026/, { selector: "time" })).toHaveAttribute("datetime", report.generated_at);
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

it("filters by resolved part fields, inspection and report identifiers, and readiness", async () => {
  const user = userEvent.setup(); render(<GeneratedReports />);
  await screen.findByText("Informe 90 · Inspección 20");
  const search = screen.getByRole("searchbox");
  for (const query of ["pt-100", "cuerpo", "Inspección 20", "Informe 90"]) {
    await user.clear(search); await user.type(search, query);
    expect(screen.getByText("Informe 90 · Inspección 20")).toBeInTheDocument();
  }
  expect(screen.queryByRole("button", { name: /Generar informe de inspección/ })).not.toBeInTheDocument();
  await user.clear(search);
  await user.selectOptions(screen.getByLabelText("Disponibilidad"), "blocked");
  expect(screen.getByRole("button", { name: "Generar informe de inspección 21" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Generar informe de inspección 20" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Disponibilidad"), "ready");
  expect(screen.getByRole("button", { name: "Generar informe de inspección 20" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Generar informe de inspección 21" })).not.toBeInTheDocument();
  expect(screen.getByText("Informe 90 · Inspección 20")).toBeInTheDocument();
});

it("includes both local date endpoints and rejects reversed ranges", async () => {
  api.inspections.list.mockResolvedValue([
    { ...complete, completed_at: "2026-08-17T00:00:00" },
    { ...complete, id: 22, completed_at: "2026-08-17T23:59:59.999" },
    { ...complete, id: 23, completed_at: "2026-08-18T00:00:00" },
  ]);
  api.reports.list.mockResolvedValue([
    { ...report, generated_at: "2026-08-17T00:00:00" },
    { ...report, id: 91, generated_at: "2026-08-17T23:59:59.999" },
    { ...report, id: 92, generated_at: "2026-08-18T00:00:00" },
  ]);
  render(<GeneratedReports />); await screen.findByText("Informe 90 · Inspección 20");
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-17" } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-17" } });
  expect(screen.getByText("Informe 90 · Inspección 20")).toBeInTheDocument();
  expect(screen.getByText("Informe 91 · Inspección 20")).toBeInTheDocument();
  expect(screen.queryByText("Informe 92 · Inspección 20")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generar informe de inspección 20" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generar informe de inspección 22" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Generar informe de inspección 23" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-08-18" } });
  expect(screen.getByRole("alert")).toHaveTextContent("La fecha desde no puede ser posterior");
  expect(screen.queryByText("Informe 90 · Inspección 20")).not.toBeInTheDocument();
});

it("limits the inspector filter to admins without requesting shared inspection scope", async () => {
  const user = userEvent.setup();
  api.inspections.list.mockResolvedValue([complete, { ...incomplete, inspector: "ana" }]);
  const { rerender } = render(<GeneratedReports />);
  await screen.findByText("Informe 90 · Inspección 20");
  expect(screen.queryByLabelText("Inspector")).not.toBeInTheDocument();
  rerender(<GeneratedReports role="admin" />);
  await user.selectOptions(screen.getByLabelText("Inspector"), "ana");
  expect(screen.queryByText("Informe 90 · Inspección 20")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generar informe de inspección 21" })).toBeInTheDocument();
  expect(api.inspections.list).toHaveBeenCalledWith();
  expect(api.inspections.list).toHaveBeenCalledOnce();
});

it("matches backend completion and annulment eligibility without false ready counts", async () => {
  api.inspections.list.mockResolvedValue([
    { ...complete, completed_at: null },
    { ...complete, id: 22, annulled_at: "2026-08-18T00:00:00Z" },
    { ...complete, id: 23, annulled_at: "2026-08-18T00:00:00Z", measurements: [{ ...complete.measurements[0], status: "PENDING" }] },
  ]);
  render(<GeneratedReports />);
  expect(await screen.findByRole("button", { name: "Generar informe de inspección 20" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Generar informe de inspección 22" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Generar informe de inspección 23" })).toBeDisabled();
  expect(screen.getByText("Listas para generar: 2 · Inspecciones visibles: 3")).toBeInTheDocument();
});

it("provides only usable, permission-aware requirement navigation", async () => {
  api.catalog.list.mockResolvedValue([{ id: 7, part_number: "", part_description: "" }]);
  const user = userEvent.setup(); const navigate = vi.fn();
  const { rerender } = render(<GeneratedReports />);
  await screen.findByRole("button", { name: "Generar informe de inspección 20" });
  expect(screen.queryByRole("button", { name: /Ir a/ })).not.toBeInTheDocument();
  rerender(<GeneratedReports onNavigate={navigate} />);
  expect(screen.queryByRole("button", { name: "Ir a catálogo" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ir a inspecciones" }));
  expect(navigate).toHaveBeenCalledWith("inspection");
  rerender(<GeneratedReports role="admin" onNavigate={navigate} />);
  await user.click(screen.getAllByRole("button", { name: "Ir a catálogo" })[0]);
  expect(navigate).toHaveBeenCalledWith("catalog");
});

it("previews an authenticated Blob and restores focus and revokes URLs on close and native Escape cancellation", async () => {
  const user = userEvent.setup(); render(<GeneratedReports />);
  const open = await screen.findByRole("button", { name: "Vista previa del informe 90" });
  await user.click(open);
  const preview = await screen.findByRole("dialog", { name: "Vista previa del informe 90" });
  expect(api.reports.download).toHaveBeenCalledWith(90);
  expect(screen.getByTitle("PDF del informe 90")).toHaveAttribute("src", "blob:report");
  expect(within(preview).getByRole("button", { name: "Cerrar vista previa" })).toHaveFocus();
  await user.click(within(preview).getByRole("button", { name: "Cerrar vista previa" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
  expect(open).toHaveFocus();
  await user.click(open);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(open).toHaveFocus();
});

it("revokes replaced and unmounted previews and ignores a late Blob after unmount", async () => {
  vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const user = userEvent.setup(); const { unmount } = render(<GeneratedReports />);
  const open = await screen.findByRole("button", { name: "Vista previa del informe 90" });
  await user.click(open); await screen.findByRole("dialog");
  fireEvent.click(open);
  await waitFor(() => expect(screen.getByTitle("PDF del informe 90")).toHaveAttribute("src", "blob:second"));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
  unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:second");

  let finish!: (blob: Blob) => void;
  api.reports.download.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const next = render(<GeneratedReports />);
  await user.click(await screen.findByRole("button", { name: "Vista previa del informe 90" }));
  next.unmount();
  await act(async () => finish(new Blob(["late pdf"])));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
});

it("closes and restores focus during a pending preview download without publishing a late Blob", async () => {
  const user = userEvent.setup(); render(<GeneratedReports />);
  const open = await screen.findByRole("button", { name: "Vista previa del informe 90" });
  await user.click(open);
  const preview = await screen.findByRole("dialog");
  let finish!: (blob: Blob) => void;
  api.reports.download.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await user.click(within(preview).getByRole("button", { name: "Descargar informe 90" }));
  await user.click(within(preview).getByRole("button", { name: "Cerrar vista previa" }));
  expect(open).toHaveFocus();
  expect(open).toBeEnabled();
  await act(async () => finish(new Blob(["late pdf"])));
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
});

it("surfaces loading, generation, preview and download failures without inventing reports", async () => {
  api.reports.list.mockRejectedValueOnce(new Error("denied"));
  const first = render(<GeneratedReports />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los informes generados. denied");
  expect(screen.queryByText(/Listas para generar:/)).not.toBeInTheDocument();
  first.unmount();
  api.reports.generate.mockRejectedValueOnce(new Error("requirements changed"));
  api.reports.download.mockRejectedValue(new Error("forbidden"));
  const user = userEvent.setup(); render(<GeneratedReports />);
  await user.click(await screen.findByRole("button", { name: "Generar informe de inspección 20" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo generar el informe. requirements changed");
  await user.click(screen.getByRole("button", { name: "Vista previa del informe 90" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo abrir la vista previa. forbidden");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Descargar informe 90" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar el informe. forbidden");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
