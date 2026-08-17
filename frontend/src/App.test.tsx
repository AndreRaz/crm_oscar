import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const api = vi.hoisted(() => ({
  auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  users: { list: vi.fn(), create: vi.fn(), patch: vi.fn() },
  catalog: {
    list: vi.fn(), createPart: vi.fn(), patchPart: vi.fn(), uploadImage: vi.fn(),
    characteristics: vi.fn(), createCharacteristic: vi.fn(), patchCharacteristic: vi.fn(), deleteCharacteristic: vi.fn(),
    balloons: vi.fn(), createBalloon: vi.fn(), deleteBalloon: vi.fn(), imageUrl: vi.fn((id) => `/api/part-types/${id}/image`),
  },
  deviations: { list: vi.fn(), dispose: vi.fn() },
  stability: { analysis: vi.fn() },
  inspections: { list: vi.fn(), detail: vi.fn(), annul: vi.fn(), report: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const admin = { id: 1, username: "ana", role: "admin", active: true };
const inspector = { id: 2, username: "luis", role: "inspector", active: true };

describe("frontend shell", () => {
  beforeEach(() => {
    vi.clearAllMocks(); api.users.list.mockResolvedValue([]); api.catalog.list.mockResolvedValue([]);
    api.catalog.characteristics.mockResolvedValue([]); api.catalog.balloons.mockResolvedValue([]);
    api.deviations.list.mockResolvedValue({ groups: [] });
    api.inspections.list.mockResolvedValue([]);
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
    expect(await screen.findByRole("navigation")).toHaveTextContent("UsuariosCatálogoInspecciónDesviacionesEstabilidad");
    await user.click(screen.getByRole("tab", { name: "Estabilidad" }));
    expect(await screen.findByText("Selecciona un tipo de pieza y una característica.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Desviaciones" }));
    expect(await screen.findByText("No hay desviaciones pendientes.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Control dimensional" })).toBeInTheDocument();
  });

  it.each([admin, inspector])("exposes completed reports to %s and annulment to admins", async (account) => {
    api.auth.me.mockResolvedValue(account); api.inspections.list.mockResolvedValue([{ id: 20, serial: "S-20", completed_at: "2026-08-17", status: "CONFORMING" }]);
    api.inspections.report.mockResolvedValue(new Blob(["pdf"])); api.inspections.annul.mockResolvedValue({});
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(window, "prompt").mockReturnValue("Duplicada");
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Inspección" }));
    await user.click(await screen.findByRole("button", { name: "Descargar informe de S-20" }));
    expect(api.inspections.report).toHaveBeenCalledWith(20);
    if (account.role === "admin") { await user.click(screen.getByRole("button", { name: "Anular S-20" })); expect(api.inspections.annul).toHaveBeenCalledWith(20, "Duplicada"); }
    else expect(screen.queryByRole("button", { name: "Anular S-20" })).not.toBeInTheDocument();
  });

  it("lets an administrator create, deactivate, and reset a user", async () => {
    api.auth.me.mockResolvedValue(admin);
    api.users.list.mockResolvedValue([inspector]);
    api.users.create.mockResolvedValue({ id: 3, username: "marta", role: "inspector", active: true });
    api.users.patch.mockImplementation((_id, changes) => Promise.resolve({ ...inspector, ...changes }));
    vi.spyOn(window, "prompt").mockReturnValue("nueva-clave");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("luis")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nuevo usuario"), "marta");
    await user.type(screen.getByLabelText("Contraseña inicial"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("marta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desactivar luis" }));
    expect(api.users.patch).toHaveBeenCalledWith(2, { active: false });
    await user.click(screen.getByRole("button", { name: "Restablecer clave de luis" }));
    expect(api.users.patch).toHaveBeenCalledWith(2, { password: "nueva-clave" });
  });

  it("gives inspectors a read-only catalog without administrator tabs", async () => {
    api.auth.me.mockResolvedValue(inspector);
    api.catalog.list.mockResolvedValue([{ id: 7, code: "PT-100", image_path: "7.png", active: true }]);
    api.catalog.characteristics.mockResolvedValue([{ id: 8, part_type_id: 7, code: "L1", name: "Longitud", unit: "mm", tol_type: "LIMITS", nominal: null, tol_plus: null, min_limit: 9, max_limit: 11, sort_order: 0 }]);
    api.catalog.balloons.mockResolvedValue([{ id: 9, part_type_id: 7, number: 1, characteristic_id: 8, x: .25, y: .75 }]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("PT-100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar pieza" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    expect(await screen.findByText(/Longitud/)).toHaveTextContent("Longitud (mm)");
    expect(screen.queryByRole("tab", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Crear tipo|Editar|Desactivar tipo/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.catalog.characteristics).toHaveBeenCalledWith(7));
    expect(screen.getByLabelText("Globo 1: L1")).toBeInTheDocument();
  });

  it("puts the administrator add card first and closes the focused form after creation", async () => {
    api.auth.me.mockResolvedValue(admin);
    api.catalog.list.mockResolvedValue([{ id: 7, code: "PT-100", name: "Pieza", description: "Inicial", image_path: null, active: true }]);
    api.catalog.createPart.mockResolvedValue({ id: 8, code: "PT-200", name: "Bomba", description: "Nueva", image_path: null, active: true });
    api.catalog.patchPart.mockResolvedValue({ id: 7, code: "PT-100", name: "Válvula", description: "Editada", image_path: null, active: true });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Catálogo" }));
    const addCard = screen.getByRole("button", { name: "Agregar pieza" });
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.type(screen.getByLabelText("Buscar por ID"), "999");
    expect(screen.getByText("No se encontraron piezas para ese ID.")).toBeInTheDocument();
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.clear(screen.getByLabelText("Buscar por ID"));
    expect(screen.queryByLabelText("Código del nuevo tipo")).not.toBeInTheDocument();
    await user.click(addCard);
    const code = screen.getByLabelText("Código del nuevo tipo");
    expect(code).toHaveFocus();
    await user.type(code, "PT-200");
    await user.type(screen.getByLabelText("Nombre del nuevo tipo"), "Bomba");
    await user.type(screen.getByLabelText("Descripción del nuevo tipo"), "Nueva");
    await user.click(screen.getByRole("button", { name: "Crear tipo" }));
    expect(api.catalog.createPart).toHaveBeenCalledWith({ code: "PT-200", name: "Bomba", description: "Nueva" });
    expect(screen.queryByLabelText("Código del nuevo tipo")).not.toBeInTheDocument();
    expect(addCard.parentElement?.firstElementChild).toBe(addCard);
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    await user.clear(screen.getByLabelText("Nombre del tipo")); await user.type(screen.getByLabelText("Nombre del tipo"), "Válvula");
    await user.clear(screen.getByLabelText("Descripción del tipo")); await user.type(screen.getByLabelText("Descripción del tipo"), "Editada");
    await user.click(screen.getByRole("button", { name: "Guardar tipo" }));
    expect(api.catalog.patchPart).toHaveBeenCalledWith(7, { name: "Válvula", description: "Editada" });
  });

  it("shows image-first cards, filters by partial numeric ID, and opens details", async () => {
    api.auth.me.mockResolvedValue(inspector);
    api.catalog.list.mockResolvedValue([
      { id: 17, code: "PT-IMG", image_path: "17.png", active: true },
      { id: 28, code: "PT-NOIMG", image_path: null, active: false },
    ]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByAltText("Imagen de PT-IMG")).toHaveAttribute("src", "/api/part-types/17/image");
    expect(screen.getByLabelText("Sin imagen para PT-NOIMG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver PT-IMG" })).toHaveTextContent("PT-IMGID 17Activo");
    expect(screen.getByRole("button", { name: "Ver PT-NOIMG" })).toHaveTextContent("PT-NOIMGID 28Inactivo");
    await user.type(screen.getByLabelText("Buscar por ID"), "7");
    expect(screen.getByRole("button", { name: "Ver PT-IMG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver PT-NOIMG" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Buscar por ID"));
    await user.type(screen.getByLabelText("Buscar por ID"), "999");
    expect(screen.getByText("No se encontraron piezas para ese ID.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Buscar por ID"));
    await user.click(screen.getByRole("button", { name: "Ver PT-IMG" }));
    await waitFor(() => expect(api.catalog.characteristics).toHaveBeenCalledWith(17));
    expect(screen.getByRole("heading", { name: "PT-IMG" })).toBeInTheDocument();
  });

  it("lets an administrator manage both tolerance formats, upload an image, and place a normalized balloon", async () => {
    const part = { id: 7, code: "PT-100", image_path: null, active: true };
    const symmetric = { id: 8, part_type_id: 7, code: "D1", name: "Diámetro", unit: "mm", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, min_limit: null, max_limit: null, sort_order: 0 };
    const limits = { ...symmetric, id: 9, code: "L1", tol_type: "LIMITS", nominal: null, tol_plus: null, min_limit: 9, max_limit: null };
    api.auth.me.mockResolvedValue(admin); api.catalog.list.mockResolvedValue([part]);
    api.catalog.createPart.mockResolvedValue({ ...part, id: 10, code: "PT-200" });
    api.catalog.uploadImage.mockResolvedValue({ ...part, image_path: "7.png" });
    api.catalog.createCharacteristic.mockResolvedValueOnce(symmetric).mockResolvedValueOnce(limits);
    api.catalog.createBalloon.mockResolvedValue({ id: 12, part_type_id: 7, number: 3, characteristic_id: 8, x: .5, y: .5 });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Catálogo" }));
    await user.click(screen.getByRole("button", { name: "Agregar pieza" }));
    await user.type(screen.getByLabelText("Código del nuevo tipo"), "PT-200");
    await user.type(screen.getByLabelText("Nombre del nuevo tipo"), "Pieza"); await user.type(screen.getByLabelText("Descripción del nuevo tipo"), "Test");
    await user.click(screen.getByRole("button", { name: "Crear tipo" }));
    expect(api.catalog.createPart).toHaveBeenCalledWith({ code: "PT-200", name: "Pieza", description: "Test" });
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    const file = new File(["image"], "pieza.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Imagen de la pieza"), file);
    expect(api.catalog.uploadImage).toHaveBeenCalledWith(7, file);
    await user.type(screen.getByLabelText("Código de característica"), "D1");
    await user.type(screen.getByLabelText("Nominal"), "10"); await user.type(screen.getByLabelText("Tolerancia ±"), "0.2");
    await user.click(screen.getByRole("button", { name: "Guardar característica" }));
    expect(api.catalog.createCharacteristic).toHaveBeenCalledWith(7, expect.objectContaining({ code: "D1", tol_type: "SYMMETRIC", nominal: 10, tol_plus: .2, min_limit: null, max_limit: null }));
    await user.selectOptions(screen.getByLabelText("Formato de tolerancia"), "LIMITS");
    await user.clear(screen.getByLabelText("Código de característica")); await user.type(screen.getByLabelText("Código de característica"), "L1");
    await user.type(screen.getByLabelText("Límite mínimo"), "9");
    await user.click(screen.getByRole("button", { name: "Guardar característica" }));
    expect(api.catalog.createCharacteristic).toHaveBeenLastCalledWith(7, expect.objectContaining({ code: "L1", tol_type: "LIMITS", nominal: null, tol_plus: null, min_limit: 9, max_limit: null }));
    const image = screen.getByAltText("Plano de PT-100");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 100, height: 100 } as DOMRect);
    fireEvent.click(image, { clientX: 60, clientY: 70 });
    await user.type(screen.getByLabelText("Número de globo"), "3");
    await user.selectOptions(screen.getByLabelText("Característica del globo"), "8");
    await user.click(screen.getByRole("button", { name: "Guardar globo" }));
    expect(api.catalog.createBalloon).toHaveBeenCalledWith(7, { number: 3, characteristic_id: 8, x: .5, y: .5 });
  });
});
