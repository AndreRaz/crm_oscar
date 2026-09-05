import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Balloon, Characteristic, Inspection, PartType, User } from "./api/client";

const api = vi.hoisted(() => ({
  auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  users: { list: vi.fn(), create: vi.fn(), patch: vi.fn() },
  catalog: {
    list: vi.fn(), createPart: vi.fn(), patchPart: vi.fn(), uploadImage: vi.fn(),
    characteristics: vi.fn(), createCharacteristic: vi.fn(), patchCharacteristic: vi.fn(), deleteCharacteristic: vi.fn(),
    balloons: vi.fn(), createBalloon: vi.fn(), deleteBalloon: vi.fn(), imageUrl: vi.fn((id) => `/api/part-types/${id}/image`),
    revisions: vi.fn(), restoreRevision: vi.fn(),
  },
  approvedDeviations: { listActive: vi.fn() },
  deviations: { list: vi.fn(), resolve: vi.fn() },
  stability: { analysis: vi.fn() },
  inspections: { list: vi.fn(), detail: vi.fn(), annul: vi.fn() },
  reports: { list: vi.fn(), generate: vi.fn(), download: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const admin: User = { id: 1, username: "ana", role: "admin", active: true };
const inspector: User = { id: 2, username: "luis", role: "inspector", active: true };
const catalogSearch = "Buscar por número de parte, descripción o ID";
const completedInspection: Inspection = {
  id: 20, part_type_id: 7, part_revision_id: 1, inspector: "luis", status: "CONFORMING",
  started_at: "2026-08-17T09:00:00Z", completed_at: "2026-08-17T10:00:00Z", annulled_at: null,
  characteristic_ids: [8], measurements: [{ id: 30, characteristic_id: 8, actual_value: 10, status: "IN_TOLERANCE", measurement_method_snapshot: "Calibrador" }],
};

describe("frontend shell", () => {
  beforeEach(() => {
    vi.resetAllMocks(); api.users.list.mockResolvedValue([]); api.catalog.list.mockResolvedValue([]);
    api.catalog.imageUrl.mockImplementation((id) => `/api/part-types/${id}/image`);
    api.catalog.revisions.mockResolvedValue([]);
    api.catalog.characteristics.mockResolvedValue([]); api.catalog.balloons.mockResolvedValue([]);
    api.deviations.list.mockResolvedValue({ groups: [] });
    api.inspections.list.mockResolvedValue([]);
    api.approvedDeviations.listActive.mockResolvedValue([]);
    api.reports.list.mockResolvedValue([]);
  });

  it("shows loading, login errors, then opens the administrator shell and logs out", async () => {
    api.auth.me.mockRejectedValue(new Error("Sin sesión"));
    api.auth.login.mockRejectedValueOnce(new Error("Invalid credentials")).mockResolvedValueOnce(admin);
    api.auth.logout.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("Cargando sesión…")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Usuario"), "ana");
    await user.type(screen.getByLabelText("Contraseña"), "incorrecta");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No fue posible iniciar sesión");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    const navigation = await screen.findByRole("navigation");
    expect(within(navigation).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Inicio", "Inspección", "Desviaciones", "Informes generados", "Catálogo", "Estabilidad", "Usuarios",
    ]);
    expect(within(navigation).getByRole("tab", { name: "Inicio" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Tu jornada, de un vistazo" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Estabilidad" }));
    expect(await screen.findByText("Selecciona un tipo de pieza y una característica.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Desviaciones" }));
    expect(await screen.findByText("No hay desviaciones que coincidan con los filtros.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Control dimensional" })).toBeInTheDocument();
  });

  it.each([admin, inspector])("removes inline reports for %s and keeps annulment admin-only", async (account) => {
    api.auth.me.mockResolvedValue(account);
    api.inspections.list.mockImplementation((scope?: "shared") => Promise.resolve(scope === "shared" ? [] : [completedInspection]));
    api.inspections.annul.mockResolvedValue({ ...completedInspection, annulled_at: "2026-08-18T10:00:00Z" });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Inspección" }));
    await user.click(screen.getByRole("tab", { name: "Historial" }));
    const history = await screen.findByRole("list", { name: "Inspecciones completadas" });
    expect(history).toHaveTextContent("Inspección 20 · Conforme");
    expect(screen.queryByRole("button", { name: /Descargar informe/ })).not.toBeInTheDocument();
    if (account.role === "admin") {
      await user.click(screen.getByRole("button", { name: "Anular inspección 20" }));
      expect(api.inspections.annul).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Confirmar anulación" })).toBeDisabled();
      await user.type(screen.getByLabelText("Motivo de anulación"), "Duplicada");
      await user.click(screen.getByRole("button", { name: "Cancelar anulación" }));
      expect(api.inspections.annul).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Anular inspección 20" }));
      await user.type(screen.getByLabelText("Motivo de anulación"), "Duplicada");
      await user.click(screen.getByRole("button", { name: "Confirmar anulación" }));
      expect(api.inspections.annul).toHaveBeenCalledWith(20, "Duplicada");
      await waitFor(() => expect(history).toHaveTextContent("Inspección 20 · Anulado"));
      expect(screen.queryByRole("button", { name: "Anular inspección 20" })).not.toBeInTheDocument();
    }
    else expect(screen.queryByRole("button", { name: "Anular inspección 20" })).not.toBeInTheDocument();
  });

  it("lets an administrator create, deactivate, and reset a user", async () => {
    api.auth.me.mockResolvedValue(admin);
    api.users.list.mockResolvedValue([inspector]);
    api.users.create.mockResolvedValue({ id: 3, username: "marta", role: "inspector", active: true });
    let currentUser = { ...inspector };
    api.users.patch.mockImplementation((_id, changes) => {
      currentUser = { ...currentUser, ...changes };
      return Promise.resolve(currentUser);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Usuarios" }));
    expect(await screen.findByText("luis")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nuevo usuario"), "marta");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("marta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desactivar luis" }));
    expect(api.users.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(api.users.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Desactivar luis" }));
    await user.click(screen.getByRole("button", { name: "Confirmar desactivación" }));
    expect(api.users.patch).toHaveBeenCalledWith(2, { active: false });
    expect(await screen.findByRole("button", { name: "Activar luis" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restablecer clave de luis" }));
    expect(api.users.patch).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText("Nueva contraseña para luis"), "nueva-clave");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(api.users.patch).toHaveBeenCalledWith(2, { password: "nueva-clave" });
    await waitFor(() => expect(screen.queryByLabelText("Nueva contraseña para luis")).not.toBeInTheDocument());
  });

  it("gives inspectors a read-only catalog without administrator tabs", async () => {
    api.auth.me.mockResolvedValue(inspector);
    api.catalog.list.mockResolvedValue([{ id: 7, part_number: "PT-100", part_description: "Pieza", image_path: "7.png", revision_no: 1, active: true }]);
    api.catalog.characteristics.mockResolvedValue([{ id: 8, part_type_id: 7, control_plan: "L1", name: "Longitud", unit: "mm", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 10, tol_plus: null, tol_minus: null, min_limit: 9, max_limit: 11, sort_order: 0 }]);
    api.catalog.balloons.mockResolvedValue([{ id: 9, part_type_id: 7, characteristic_id: 8, x: .25, y: .75 }]);
    const user = userEvent.setup();
    render(<App />);
    const navigation = await screen.findByRole("navigation");
    expect(within(navigation).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Inicio", "Inspección", "Desviaciones", "Informes generados", "Catálogo",
    ]);
    expect(within(navigation).getByRole("tab", { name: "Inicio" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Tu jornada, de un vistazo" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Catálogo" }));
    expect(await screen.findByText("PT-100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar pieza" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    await screen.findByRole("tab", { name: "Datos" });
    expect(screen.queryByLabelText("Número de parte")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar tipo" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "Características" }));
    expect(await screen.findByText(/Longitud/)).toHaveTextContent("Longitud (mm)");
    expect(screen.queryByRole("tab", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Crear tipo|Editar|Desactivar tipo/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.catalog.characteristics).toHaveBeenCalledWith(7));
    expect(api.catalog.revisions).toHaveBeenCalledWith(7);
    await user.click(screen.getByRole("tab", { name: "Plano" }));
    expect(screen.getByLabelText("Marcador C.P. L1")).toHaveTextContent("L1");
    expect(screen.queryByLabelText("Imagen de la pieza")).not.toBeInTheDocument();
  });

  it("puts the administrator add card first and closes the focused form after creation", async () => {
    api.auth.me.mockResolvedValue(admin);
    let parts: PartType[] = [{ id: 7, part_number: "PT-100", part_description: "Inicial", image_path: null, revision_no: 1, active: true }];
    api.catalog.list.mockImplementation(async () => [...parts]);
    api.catalog.createPart.mockImplementation(async (input) => {
      const created = { id: 8, ...input, image_path: null, revision_no: 1, active: true };
      parts = [...parts, created];
      return created;
    });
    api.catalog.patchPart.mockImplementation(async (id, changes) => {
      parts = parts.map((part) => part.id === id ? { ...part, ...changes, revision_no: part.revision_no + 1 } : part);
      return parts.find((part) => part.id === id);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Catálogo" }));
    const addCard = await screen.findByRole("button", { name: "Agregar pieza" });
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.type(screen.getByLabelText(catalogSearch), "999");
    expect(screen.getByText("No se encontraron piezas con esos criterios.")).toBeInTheDocument();
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.clear(screen.getByLabelText(catalogSearch));
    expect(screen.queryByLabelText("Número de parte")).not.toBeInTheDocument();
    await user.click(addCard);
    const partNumber = screen.getByLabelText("Número de parte");
    expect(partNumber).toHaveFocus();
    await user.type(partNumber, "PT-200");
    await user.type(screen.getByLabelText("Descripción de parte"), "Nueva");
    await user.click(screen.getByRole("button", { name: "Crear tipo" }));
    expect(api.catalog.createPart).toHaveBeenCalledWith({ part_number: "PT-200", part_description: "Nueva" });
    expect(await screen.findByRole("button", { name: "Ver PT-200" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Número de parte")).not.toBeInTheDocument();
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    await screen.findByRole("tab", { name: "Datos" });
    await user.clear(screen.getByLabelText("Número de parte")); await user.type(screen.getByLabelText("Número de parte"), "PT-101");
    await user.clear(screen.getByLabelText("Descripción de parte")); await user.type(screen.getByLabelText("Descripción de parte"), "Editada");
    await user.click(screen.getByRole("button", { name: "Guardar tipo" }));
    expect(api.catalog.patchPart).toHaveBeenCalledWith(7, { part_number: "PT-101", part_description: "Editada" });
    expect(await screen.findByRole("heading", { name: "PT-101" })).toBeInTheDocument();
    expect(screen.getByText(/ID 7 · Revisión 2/)).toBeInTheDocument();
  });

  it("shows image-first cards, filters by partial numeric ID, and opens details", async () => {
    api.auth.me.mockResolvedValue(inspector);
    api.catalog.list.mockResolvedValue([
      { id: 17, part_number: "PT-IMG", part_description: "Con imagen", image_path: "17.png", revision_no: 1, active: true },
      { id: 28, part_number: "PT-NOIMG", part_description: "Sin imagen", image_path: null, revision_no: 1, active: false },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Catálogo" }));
    expect(await screen.findByAltText("Imagen de PT-IMG")).toHaveAttribute("src", "/api/part-types/17/image?revision=1");
    expect(screen.getByLabelText("Sin imagen para PT-NOIMG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver PT-IMG" })).toHaveTextContent("PT-IMGID 17Activo");
    expect(screen.getByRole("button", { name: "Ver PT-NOIMG" })).toHaveTextContent("PT-NOIMGID 28Inactivo");
    await user.type(screen.getByLabelText(catalogSearch), "7");
    expect(screen.getByRole("button", { name: "Ver PT-IMG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver PT-NOIMG" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(catalogSearch));
    await user.type(screen.getByLabelText(catalogSearch), "999");
    expect(screen.getByText("No se encontraron piezas con esos criterios.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText(catalogSearch));
    await user.click(screen.getByRole("button", { name: "Ver PT-IMG" }));
    await waitFor(() => expect(api.catalog.characteristics).toHaveBeenCalledWith(17));
    expect(screen.getByRole("heading", { name: "PT-IMG" })).toBeInTheDocument();
  });

  it("lets an administrator manage both tolerance formats, upload an image, and place a normalized balloon", async () => {
    const part: PartType = { id: 7, part_number: "PT-100", part_description: "Pieza", image_path: null, revision_no: 1, active: true };
    const symmetric: Characteristic = { id: 8, part_type_id: 7, control_plan: "D1", name: "Diámetro", unit: "mm", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .1, min_limit: 9.9, max_limit: 10.2, sort_order: 0 };
    const limits: Characteristic = { ...symmetric, id: 9, control_plan: "L1", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 10, tol_plus: null, tol_minus: null, min_limit: 9, max_limit: 11 };
    let parts = [part];
    let characteristics: Characteristic[] = [];
    let balloons: Balloon[] = [];
    const revisePart = (changes: Partial<PartType> = {}) => {
      parts = parts.map((item) => item.id === part.id ? { ...item, ...changes, revision_no: item.revision_no + 1 } : item);
      return parts.find((item) => item.id === part.id)!;
    };
    api.auth.me.mockResolvedValue(admin);
    api.catalog.list.mockImplementation(async () => [...parts]);
    api.catalog.characteristics.mockImplementation(async () => [...characteristics]);
    api.catalog.balloons.mockImplementation(async () => [...balloons]);
    api.catalog.createPart.mockImplementation(async (input) => {
      const created = { ...part, ...input, id: 10 };
      parts = [...parts, created];
      return created;
    });
    api.catalog.uploadImage.mockImplementation(async () => revisePart({ image_path: "7.png" }));
    api.catalog.createCharacteristic.mockImplementation(async (_id, input) => {
      const created = input.tol_type === "SYMMETRIC" ? symmetric : limits;
      characteristics = [...characteristics, created]; revisePart();
      return created;
    });
    api.catalog.createBalloon.mockImplementation(async (id, input) => {
      const created = { id: 12, part_type_id: id, ...input };
      balloons = [...balloons, created]; revisePart();
      return created;
    });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Catálogo" }));
    await user.click(await screen.findByRole("button", { name: "Agregar pieza" }));
    await user.type(screen.getByLabelText("Número de parte"), "PT-200");
    await user.type(screen.getByLabelText("Descripción de parte"), "Test");
    await user.click(screen.getByRole("button", { name: "Crear tipo" }));
    expect(api.catalog.createPart).toHaveBeenCalledWith({ part_number: "PT-200", part_description: "Test" });
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    await user.click(await screen.findByRole("tab", { name: "Plano" }));
    const file = new File(["image"], "pieza.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Imagen de la pieza"), file);
    expect(api.catalog.uploadImage).toHaveBeenCalledWith(7, file);
    expect(await screen.findByAltText("Plano de PT-100")).toHaveAttribute("src", "/api/part-types/7/image?revision=2");
    await user.click(screen.getByRole("tab", { name: "Características" }));
    await user.type(screen.getByLabelText("Plan de control"), "D1");
    await user.type(screen.getByLabelText("Método de medición"), "Micrómetro");
    await user.type(screen.getByLabelText("Nominal"), "10"); await user.type(screen.getByLabelText("Tolerancia superior"), "0.2"); await user.type(screen.getByLabelText("Tolerancia inferior"), "0.1");
    await user.click(screen.getByRole("button", { name: "Guardar característica" }));
    expect(api.catalog.createCharacteristic).toHaveBeenCalledWith(7, expect.objectContaining({ control_plan: "D1", measurement_method: "Micrómetro", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, tol_minus: .1, min_limit: null, max_limit: null }));
    expect(await screen.findByRole("button", { name: "Editar D1" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Formato de tolerancia"), "LIMITS");
    await user.clear(screen.getByLabelText("Plan de control")); await user.type(screen.getByLabelText("Plan de control"), "L1");
    await user.type(screen.getByLabelText("Método de medición"), "Calibrador");
    await user.type(screen.getByLabelText("Nominal"), "10");
    await user.type(screen.getByLabelText("Límite mínimo"), "9");
    await user.type(screen.getByLabelText("Límite máximo"), "11");
    await user.click(screen.getByRole("button", { name: "Guardar característica" }));
    expect(api.catalog.createCharacteristic).toHaveBeenLastCalledWith(7, expect.objectContaining({ control_plan: "L1", measurement_method: "Calibrador", tol_type: "LIMITS", nominal: 10, tol_plus: null, tol_minus: null, min_limit: 9, max_limit: 11 }));
    expect(await screen.findByRole("button", { name: "Editar L1" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Plano" }));
    const image = screen.getByAltText("Plano de PT-100");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 100, height: 100 } as DOMRect);
    fireEvent.click(image, { clientX: 60, clientY: 70 });
    await user.selectOptions(screen.getByLabelText("Característica del marcador"), "8");
    await user.click(screen.getByRole("button", { name: "Guardar marcador" }));
    expect(api.catalog.createBalloon).toHaveBeenCalledWith(7, { characteristic_id: 8, x: .5, y: .5 });
    expect(await screen.findByLabelText("Marcador C.P. D1")).toHaveTextContent("D1");
    expect(screen.getByAltText("Plano de PT-100")).toHaveAttribute("src", "/api/part-types/7/image?revision=5");
    expect(api.catalog.characteristics).toHaveBeenCalledTimes(5);
    expect(api.catalog.balloons).toHaveBeenCalledTimes(5);
    expect(api.catalog.revisions).toHaveBeenCalledTimes(5);
  });
});
