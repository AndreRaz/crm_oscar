import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const api = vi.hoisted(() => ({
  auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  users: { list: vi.fn(), create: vi.fn(), patch: vi.fn() },
  catalog: { list: vi.fn(), characteristics: vi.fn() },
}));
vi.mock("./api/client", () => ({ api }));

const admin = { id: 1, username: "ana", role: "admin", active: true };
const inspector = { id: 2, username: "luis", role: "inspector", active: true };

describe("frontend shell", () => {
  beforeEach(() => { vi.clearAllMocks(); api.users.list.mockResolvedValue([]); api.catalog.list.mockResolvedValue([]); });

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
    expect(await screen.findByRole("navigation")).toHaveTextContent("UsuariosCatálogoDesviacionesEstabilidad");
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Control dimensional" })).toBeInTheDocument();
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
    api.catalog.list.mockResolvedValue([{ id: 7, code: "PT-100", image_path: null, active: true }]);
    api.catalog.characteristics.mockResolvedValue([{ id: 8, part_type_id: 7, code: "L1", name: "Longitud", unit: "mm", tol_type: "LIMITS", nominal: null, tol_plus: null, min_limit: 9, max_limit: 11, sort_order: 0 }]);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("PT-100")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver PT-100" }));
    expect(await screen.findByText(/Longitud/)).toHaveTextContent("Longitud (mm)");
    expect(screen.queryByRole("tab", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Crear tipo|Editar|Desactivar tipo/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.catalog.characteristics).toHaveBeenCalledWith(7));
  });
});
