import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import DrawingViewer from "./DrawingViewer";
import { Balloon, Characteristic } from "./api/client";

const characteristic: Characteristic = { id: 8, part_type_id: 7, control_plan: "CP-01", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .2, min_limit: 9.8, max_limit: 10.2, sort_order: 0 };
const balloon: Balloon = { id: 3, part_type_id: 7, characteristic_id: 8, x: .25, y: .75 };
const props = { src: "/drawing.png", alt: "Plano de PT-100", balloons: [balloon], characteristics: [characteristic] };
afterEach(() => vi.restoreAllMocks());

it("zooms a shared image/marker canvas, resets scrolling, and exposes a keyboard viewport", async () => {
  const user = userEvent.setup(); render(<DrawingViewer {...props} />);
  const viewport = screen.getByRole("region", { name: "Vista desplazable: Plano de PT-100" });
  expect(viewport).toHaveAttribute("tabindex", "0");
  expect(viewport).toHaveStyle({ overflow: "auto" });
  const image = screen.getByAltText(props.alt);
  expect(image.parentElement).toHaveStyle({ width: "100%" });
  await user.click(screen.getByRole("button", { name: "Acercar plano" }));
  expect(screen.getByLabelText("Nivel de zoom")).toHaveTextContent("125%");
  expect(image.parentElement).toHaveStyle({ width: "125%" });
  expect(screen.getByRole("button", { name: "Marcador C.P. CP-01" }).parentElement).toHaveStyle({ left: "25%", top: "75%" });
  await user.click(screen.getByRole("button", { name: "Alejar plano" }));
  expect(screen.getByLabelText("Nivel de zoom")).toHaveTextContent("100%");
  viewport.scrollLeft = 100; viewport.scrollTop = 50;
  await user.click(screen.getByRole("button", { name: "Restablecer vista" }));
  expect(viewport.scrollLeft).toBe(0); expect(viewport.scrollTop).toBe(0);
});

it("selects characteristics with controlled active IDs and never places a marker on marker actions", async () => {
  const user = userEvent.setup(), onSelect = vi.fn(), onImageClick = vi.fn(), onRemove = vi.fn();
  const { rerender } = render(<DrawingViewer {...props} onSelect={onSelect} onImageClick={onImageClick} onRemove={onRemove} />);
  await user.click(screen.getByRole("button", { name: "Marcador C.P. CP-01" }));
  expect(onSelect).toHaveBeenCalledWith(8);
  expect(onImageClick).not.toHaveBeenCalled();
  rerender(<DrawingViewer {...props} activeId={8} onSelect={onSelect} onImageClick={onImageClick} onRemove={onRemove} />);
  expect(screen.getByRole("button", { name: "Marcador C.P. activo CP-01" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Eliminar marcador CP-01" }));
  expect(onRemove).toHaveBeenCalledWith(3);
  expect(onImageClick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByAltText(props.alt), { clientX: 10, clientY: 20 });
  expect(onImageClick).toHaveBeenCalledTimes(1);
});

it("resets zoom for another image and handles unavailable fullscreen without throwing", async () => {
  const user = userEvent.setup(); const { rerender } = render(<DrawingViewer {...props} />);
  await user.click(screen.getByRole("button", { name: "Acercar plano" }));
  rerender(<DrawingViewer {...props} src="/other.png" />);
  expect(screen.getByLabelText("Nivel de zoom")).toHaveTextContent("100%");
  expect(screen.queryByRole("button", { name: /Eliminar marcador/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Pantalla completa" }));
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudo abrir o cerrar la pantalla completa");
});

it("catches a rejected fullscreen request", async () => {
  const user = userEvent.setup(); const { container } = render(<DrawingViewer {...props} />);
  const root = container.firstElementChild as HTMLElement;
  root.requestFullscreen = vi.fn().mockRejectedValue(new Error("Denied"));
  await user.click(screen.getByRole("button", { name: "Pantalla completa" }));
  expect(root.requestFullscreen).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("Puedes usar el zoom");
});

it("tracks browser fullscreen changes and exits before an external removal confirmation", async () => {
  const user = userEvent.setup(), onRemove = vi.fn();
  const { container } = render(<DrawingViewer {...props} onRemove={onRemove} />);
  const root = container.firstElementChild as HTMLElement;
  let current: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn(async () => { current = null; document.dispatchEvent(new Event("fullscreenchange")); }) });
  root.requestFullscreen = vi.fn(async () => { current = root; document.dispatchEvent(new Event("fullscreenchange")); });
  try {
    await user.click(screen.getByRole("button", { name: "Pantalla completa" }));
    expect(screen.getByRole("button", { name: "Salir de pantalla completa" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eliminar marcador CP-01" }));
    expect(document.exitFullscreen).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(3);
    expect(screen.getByRole("button", { name: "Pantalla completa" })).toBeInTheDocument();
  } finally {
    Reflect.deleteProperty(document, "fullscreenElement"); Reflect.deleteProperty(document, "exitFullscreen");
  }
});

it("bounds zoom at 50% and 400%", async () => {
  const user = userEvent.setup(); render(<DrawingViewer {...props} />);
  const smaller = screen.getByRole("button", { name: "Alejar plano" }), larger = screen.getByRole("button", { name: "Acercar plano" });
  await user.click(smaller); await user.click(smaller);
  expect(smaller).toBeDisabled(); expect(screen.getByLabelText("Nivel de zoom")).toHaveTextContent("50%");
  for (let count = 0; count < 14; count += 1) await user.click(larger);
  expect(larger).toBeDisabled(); expect(screen.getByLabelText("Nivel de zoom")).toHaveTextContent("400%");
});
