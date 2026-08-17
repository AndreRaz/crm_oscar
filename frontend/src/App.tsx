import { FormEvent, useEffect, useState } from "react";
import { api, Role, User } from "./api/client";
import Catalog from "./Catalog";

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const data = new FormData(event.currentTarget);
    try { onLogin(await api.auth.login(String(data.get("username")), String(data.get("password")))); }
    catch { setError("No fue posible iniciar sesión. Verifica tus credenciales."); }
    finally { setPending(false); }
  }
  return <main><form onSubmit={submit} className="card login">
    <h1>Control dimensional</h1>
    <label>Usuario<input name="username" required /></label>
    <label>Contraseña<input name="password" type="password" required /></label>
    {error && <p role="alert">{error}</p>}
    <button disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</button>
  </form></main>;
}

function Users() {
  const [users, setUsers] = useState<User[]>(); const [error, setError] = useState("");
  useEffect(() => { api.users.list().then(setUsers).catch(() => setError("No se pudieron cargar los usuarios.")); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = event.currentTarget; const data = new FormData(form);
    try { const created = await api.users.create({ username: String(data.get("username")), password: String(data.get("password")), role: String(data.get("role")) as Role }); setUsers((current) => [...(current || []), created]); form.reset(); }
    catch { setError("No se pudo crear el usuario."); }
  }
  async function patch(user: User, changes: { active?: boolean; password?: string }) {
    try { const updated = await api.users.patch(user.id, changes); setUsers((current) => current?.map((item) => item.id === updated.id ? updated : item)); }
    catch { setError("No se pudo actualizar el usuario."); }
  }
  return <section><h2>Usuarios</h2>
    <form onSubmit={create} className="row card">
      <label>Nuevo usuario<input name="username" required /></label>
      <label>Contraseña inicial<input name="password" type="password" minLength={8} required /></label>
      <label>Rol<select name="role"><option value="inspector">Inspector</option><option value="admin">Administrador</option></select></label>
      <button>Crear usuario</button>
    </form>
    {error && <p role="alert">{error}</p>}{!users ? <p>Cargando usuarios…</p> : <ul className="list">{users.map((user) => <li key={user.id}>
      <span><strong>{user.username}</strong> · {user.role === "admin" ? "Administrador" : "Inspector"} · {user.active ? "Activo" : "Inactivo"}</span>
      <button aria-label={`${user.active ? "Desactivar" : "Activar"} ${user.username}`} onClick={() => patch(user, { active: !user.active })}>{user.active ? "Desactivar" : "Activar"}</button>
      <button aria-label={`Restablecer clave de ${user.username}`} onClick={() => { const password = prompt("Nueva contraseña (mínimo 8 caracteres)"); if (password) patch(user, { password }); }}>Restablecer clave</button>
    </li>)}</ul>}
  </section>;
}

type Page = "users" | "catalog" | "deviations" | "stability" | "inspection";
const tabs: Record<Role, [Page, string][]> = {
  admin: [["users", "Usuarios"], ["catalog", "Catálogo"], ["deviations", "Desviaciones"], ["stability", "Estabilidad"]],
  inspector: [["catalog", "Catálogo"], ["inspection", "Inspección"]],
};

export default function App() {
  const [user, setUser] = useState<User | null>(); const [page, setPage] = useState<Page>("catalog");
  function enter(next: User) { setUser(next); setPage(next.role === "admin" ? "users" : "catalog"); }
  useEffect(() => { api.auth.me().then(enter).catch(() => setUser(null)); }, []);
  if (user === undefined) return <main><p>Cargando sesión…</p></main>;
  if (user === null) return <Login onLogin={enter} />;
  return <><header><div><strong>Control dimensional</strong><small>{user.username}</small></div><button onClick={async () => { await api.auth.logout(); setUser(null); }}>Cerrar sesión</button></header>
    <nav aria-label="Navegación principal">{tabs[user.role].map(([key, label]) => <button role="tab" aria-selected={page === key} key={key} onClick={() => setPage(key)}>{label}</button>)}</nav>
    <main>{page === "users" ? <Users /> : page === "catalog" ? <Catalog role={user.role} /> : <section><h2>{tabs[user.role].find(([key]) => key === page)?.[1]}</h2><p>Disponible en la siguiente fase.</p></section>}</main>
  </>;
}
