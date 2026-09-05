import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { api, Role, User } from "./api/client";
import Catalog from "./Catalog";
import Inspection from "./Inspection";
import Deviations from "./Deviations";
import GeneratedReports from "./GeneratedReports";
import Dashboard from "./Dashboard";

const Stability = lazy(() => import("./Stability"));

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
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [passwordUser, setPasswordUser] = useState<User>();
  const [deactivate, setDeactivate] = useState<User>();
  useEffect(() => { api.users.list().then(setUsers).catch(() => setError("No se pudieron cargar los usuarios.")); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setPending(true); setError(""); setFeedback(""); const form = event.currentTarget; const data = new FormData(form);
    try { const created = await api.users.create({ username: String(data.get("username")), password: String(data.get("password")), role: String(data.get("role")) as Role }); setUsers((current) => [...(current || []), created]); form.reset(); }
    catch { setError("No se pudo crear el usuario."); }
    finally { lock.current = false; setPending(false); }
  }
  async function patch(user: User, changes: { active?: boolean; password?: string }) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(""); setFeedback("");
    try { const updated = await api.users.patch(user.id, changes); setUsers((current) => current?.map((item) => item.id === updated.id ? updated : item)); setPasswordUser(undefined); setDeactivate(undefined); setFeedback("Usuario actualizado."); }
    catch { setError("No se pudo actualizar el usuario."); }
    finally { lock.current = false; setPending(false); }
  }
  return <section><h2>Usuarios</h2>
    <form onSubmit={create} className="card form-card">
      <div className="form-card-header"><strong>Nuevo usuario</strong></div>
      <fieldset className="catalog-fields form-card-body" disabled={pending}><div className="field-grid">
        <label>Nuevo usuario<input name="username" autoComplete="off" required /></label>
        <label>Contraseña inicial<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <label>Rol<select name="role"><option value="inspector">Inspector</option><option value="admin">Administrador</option></select></label>
      </div></fieldset><div className="form-card-footer"><button disabled={pending}>Crear usuario</button></div>
    </form>
    {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {passwordUser && <form className="card form-card" onSubmit={(event) => { event.preventDefault(); void patch(passwordUser, { password: String(new FormData(event.currentTarget).get("password")) }); }}>
      <div className="form-card-header"><strong>Restablecer contraseña</strong></div><div className="form-card-body"><label>Nueva contraseña para {passwordUser.username}<input autoFocus name="password" type="password" autoComplete="new-password" required minLength={8} disabled={pending} /></label></div>
      <div className="form-card-footer"><button type="button" disabled={pending} onClick={() => setPasswordUser(undefined)}>Cancelar</button><button disabled={pending}>Guardar contraseña</button></div>
    </form>}
    {deactivate && <section className="card confirmation-inline" aria-label="Confirmar desactivación"><h3>Desactivar {deactivate.username}</h3><p>Este usuario dejará de tener acceso. Sus inspecciones y registros se conservarán. Podrás activarlo nuevamente.</p><div className="dialog-actions"><button autoFocus disabled={pending} onClick={() => setDeactivate(undefined)}>Cancelar</button><button className="button-danger" disabled={pending} onClick={() => patch(deactivate, { active: false })}>Confirmar desactivación</button></div></section>}
    {!users ? <p>Cargando usuarios…</p> : <ul className="list">{users.map((user) => <li key={user.id}>
      <span><strong>{user.username}</strong> · {user.role === "admin" ? "Administrador" : "Inspector"} · {user.active ? "Activo" : "Inactivo"}</span>
      <button disabled={pending} aria-label={`${user.active ? "Desactivar" : "Activar"} ${user.username}`} onClick={() => { setPasswordUser(undefined); if (user.active) setDeactivate(user); else void patch(user, { active: true }); }}>{user.active ? "Desactivar" : "Activar"}</button>
      <button disabled={pending} aria-label={`Restablecer clave de ${user.username}`} onClick={() => { setDeactivate(undefined); setPasswordUser(user); }}>Restablecer clave</button>
    </li>)}</ul>}
  </section>;
}

type Page = "home" | "users" | "catalog" | "deviations" | "stability" | "inspection" | "reports";
const tabs: Record<Role, [Page, string][]> = {
  admin: [["home", "Inicio"], ["inspection", "Inspección"], ["deviations", "Desviaciones"], ["reports", "Informes generados"], ["catalog", "Catálogo"], ["stability", "Estabilidad"], ["users", "Usuarios"]],
  inspector: [["home", "Inicio"], ["inspection", "Inspección"], ["deviations", "Desviaciones"], ["reports", "Informes generados"], ["catalog", "Catálogo"]],
};

export default function App() {
  const [user, setUser] = useState<User | null>(); const [page, setPage] = useState<Page>("home");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  function enter(next: User) { setUser(next); setPage("home"); setLogoutError(""); }
  useEffect(() => { api.auth.me().then(enter).catch(() => setUser(null)); }, []);
  if (user === undefined) return <main><p>Cargando sesión…</p></main>;
  if (user === null) return <Login onLogin={enter} />;
  return <><header className="app-header"><div><strong>Control dimensional</strong><small>{user.username} · {user.role === "admin" ? "Administrador" : "Inspector"}</small></div><button disabled={loggingOut} onClick={async () => { setLoggingOut(true); setLogoutError(""); try { await api.auth.logout(); setUser(null); } catch { setLogoutError("No se pudo cerrar la sesión. Reintenta."); } finally { setLoggingOut(false); } }}>Cerrar sesión</button></header>
    <nav aria-label="Navegación principal"><div className="app-tabs" role="tablist">{tabs[user.role].map(([key, label], index) => <button role="tab" id={`page-tab-${key}`} aria-controls="page-panel" aria-selected={page === key} tabIndex={page === key ? 0 : -1} key={key} onClick={() => setPage(key)} onKeyDown={(event) => {
      const options = tabs[user.role];
      const next = event.key === "ArrowRight" ? (index + 1) % options.length : event.key === "ArrowLeft" ? (index + options.length - 1) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault(); setPage(options[next][0]); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
    }}>{label}</button>)}</div></nav>
    <main>{logoutError && <p role="alert">{logoutError}</p>}<div id="page-panel" role="tabpanel" aria-labelledby={`page-tab-${page}`}>{page === "home" ? <Dashboard user={user} onNavigate={setPage} /> : page === "users" ? <Users /> : page === "catalog" ? <Catalog role={user.role} /> : page === "inspection" ? <Inspection role={user.role} onNavigate={setPage} /> : page === "deviations" ? <Deviations role={user.role} /> : page === "reports" ? <GeneratedReports role={user.role} onNavigate={setPage} /> : <Suspense fallback={<p role="status">Cargando estabilidad…</p>}><Stability /></Suspense>}</div></main>
  </>;
}
