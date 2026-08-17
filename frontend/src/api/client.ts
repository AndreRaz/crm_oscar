export type Role = "admin" | "inspector";
export type User = { id: number; username: string; role: Role; active: boolean };
export type PartType = { id: number; code: string; image_path: string | null; active: boolean };
export type Characteristic = {
  id: number; part_type_id: number; code: string; name: string | null; unit: string | null;
  tol_type: "SYMMETRIC" | "LIMITS"; nominal: number | null; tol_plus: number | null;
  min_limit: number | null; max_limit: number | null; sort_order: number;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "include",
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  auth: {
    me: () => request<User>("/api/auth/me"),
    login: (username: string, password: string) => request<User>("/api/auth/login", json("POST", { username, password })),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", json("POST")),
  },
  users: {
    list: () => request<User[]>("/api/users"),
    create: (input: { username: string; password: string; role: Role }) => request<User>("/api/users", json("POST", input)),
    patch: (id: number, input: { active?: boolean; password?: string }) => request<User>(`/api/users/${id}`, json("PATCH", input)),
  },
  catalog: {
    list: () => request<PartType[]>("/api/part-types"),
    characteristics: (id: number) => request<Characteristic[]>(`/api/part-types/${id}/characteristics`),
  },
};
