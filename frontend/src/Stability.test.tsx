import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Stability from "./Stability";
import type { StabilityAnalysis } from "./api/client";

const api = vi.hoisted(() => ({
  catalog: { list: vi.fn(), characteristics: vi.fn() },
  stability: { analysis: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children, width, height }: { children: React.ReactNode; width: string; height: number }) => <div data-testid="responsive-chart" data-width={width} data-height={height}>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div aria-label="Gráfico de tendencia">{children}</div>,
  Line: () => <span>Valores reales</span>,
  ReferenceLine: ({ y, label }: { y: number; label: string }) => <span>{label}: {y}</span>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));

const parts = [
  { id: 7, part_number: "PT-100", part_description: "Pieza 100", image_path: null, revision_no: 1, active: true },
  { id: 9, part_number: "PT-200", part_description: "Pieza 200", image_path: null, revision_no: 1, active: true },
];
const diameter = { id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 };
const response: StabilityAnalysis = {
  characteristic: { control_plan: "D1", name: "Diámetro", unit: "mm", nominal: 10, lower_limit: 9.8, upper_limit: 10.2 },
  points: [
    { inspection_id: 20, completed_at: "2026-01-01T10:00:00Z", actual: 9.9, deviation: -.1, status: "IN_TOLERANCE" },
    { inspection_id: 21, completed_at: "2026-01-02T10:00:00Z", actual: 10.4, deviation: null, status: "PENDING" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.catalog.list.mockResolvedValue(parts);
  api.catalog.characteristics.mockResolvedValue([diameter]);
  api.stability.analysis.mockResolvedValue(response);
});

it("loads one scoped characteristic and renders server reference lines plus the chronological table", async () => {
  const user = userEvent.setup(); render(<Stability />);
  expect(screen.getByText("Cargando tipos de pieza…")).toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  expect(api.catalog.characteristics).toHaveBeenCalledWith(7);
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  await waitFor(() => expect(api.stability.analysis).toHaveBeenCalledWith(7, 8));

  const chart = await screen.findByLabelText("Gráfico de tendencia");
  expect(chart).toHaveTextContent("Nominal: 10");
  expect(chart).toHaveTextContent("Tolerancia inferior: 9.8");
  expect(chart).toHaveTextContent("Tolerancia superior: 10.2");
  expect(screen.getByTestId("responsive-chart")).toHaveAttribute("data-width", "100%");
  expect(screen.getByTestId("responsive-chart")).toHaveAttribute("data-height", "320");
  expect(screen.getByText(/no límites de control estadístico/)).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Valor real (mm)" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Desviación (mm)" })).toBeInTheDocument();
  const rows = within(screen.getByRole("table", { name: "Mediciones cronológicas" })).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("20");
  expect(rows[2]).toHaveTextContent("21");
  expect(screen.queryByText(/serie/i)).not.toBeInTheDocument();
  expect(rows[2]).toHaveTextContent("—");
});

it("includes both local date endpoints, maintains chronology and excludes the next midnight", async () => {
  api.stability.analysis.mockResolvedValue({ ...response, points: [
    { ...response.points[0], inspection_id: 22, completed_at: "2026-01-02T00:00:00" },
    { ...response.points[1], completed_at: "2026-01-01T23:59:59.999" },
    { ...response.points[0], completed_at: "2026-01-01T00:00:00" },
  ] });
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-01-01" } });
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent("20");
  expect(within(rows[2]).getAllByRole("cell")[0]).toHaveTextContent("21");
  expect(screen.getByText("2 mediciones visibles de 3")).toBeInTheDocument();
  expect(api.stability.analysis).toHaveBeenCalledExactlyOnceWith(7, 8);
});

it("shows range validation and filtered empty states without rendering misleading charts", async () => {
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-02-01" } });
  expect(screen.getByText("No hay mediciones en el intervalo seleccionado.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Gráfico de tendencia")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-01-01" } });
  expect(screen.getByRole("alert")).toHaveTextContent("La fecha desde no puede ser posterior");
});

it("handles missing units and reference limits without inventing values", async () => {
  api.stability.analysis.mockResolvedValue({ ...response, characteristic: { ...response.characteristic, unit: null, nominal: null, lower_limit: null, upper_limit: null } });
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  expect(await screen.findByRole("columnheader", { name: "Valor real (sin unidad)" })).toBeInTheDocument();
  expect(screen.getByText(/Nominal: — sin unidad/)).toBeInTheDocument();
  expect(screen.getByLabelText("Gráfico de tendencia")).not.toHaveTextContent("Tolerancia inferior:");
});

it("ignores stale characteristic and analysis responses after selecting another part", async () => {
  let finishCharacteristics!: (value: typeof diameter[]) => void;
  api.catalog.characteristics.mockReturnValueOnce(new Promise((resolve) => { finishCharacteristics = resolve; }))
    .mockResolvedValueOnce([{ ...diameter, id: 10, part_type_id: 9, control_plan: "D2" }]);
  let finishAnalysis!: (value: StabilityAnalysis) => void;
  api.stability.analysis.mockReturnValueOnce(new Promise((resolve) => { finishAnalysis = resolve; }));
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(screen.getByLabelText("Tipo de pieza"), "9");
  await user.selectOptions(screen.getByLabelText("Característica"), "10");
  await act(async () => finishCharacteristics([diameter]));
  expect(screen.queryByRole("option", { name: "D1 — Diámetro" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Tipo de pieza"), "");
  await act(async () => finishAnalysis(response));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Característica")).toBeDisabled();
});

it("reports characteristic loading errors", async () => {
  api.catalog.characteristics.mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las características del tipo de pieza.");
  expect(screen.queryByText("Cargando características…")).not.toBeInTheDocument();
});

it("shows an empty state without calculating analytics", async () => {
  api.stability.analysis.mockResolvedValue({ ...response, points: [] });
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  expect(await screen.findByText("No hay mediciones para esta selección.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Gráfico de tendencia")).not.toBeInTheDocument();
  expect(screen.queryByText(/Cp|Cpk|control/i)).not.toBeInTheDocument();
});

it("reports catalog and analysis loading failures", async () => {
  api.catalog.list.mockRejectedValueOnce(new Error("offline"));
  const { unmount } = render(<Stability />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los tipos de pieza");
  expect(screen.queryByText("Cargando tipos de pieza…")).not.toBeInTheDocument();
  unmount();

  api.catalog.list.mockResolvedValue(parts);
  api.stability.analysis.mockRejectedValueOnce(new Error("denied"));
  const user = userEvent.setup(); render(<Stability />);
  await user.selectOptions(await screen.findByLabelText("Tipo de pieza"), "7");
  await user.selectOptions(await screen.findByLabelText("Característica"), "8");
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el análisis de estabilidad");
  expect(screen.queryByText("Cargando análisis…")).not.toBeInTheDocument();
});
