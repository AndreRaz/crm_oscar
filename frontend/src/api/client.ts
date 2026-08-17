export type Role = "admin" | "inspector";
export type User = { id: number; username: string; role: Role; active: boolean };
export type PartType = { id: number; code: string; image_path: string | null; active: boolean };
export type Characteristic = {
  id: number; part_type_id: number; code: string; name: string | null; unit: string | null;
  tol_type: "SYMMETRIC" | "LIMITS"; nominal: number | null; tol_plus: number | null;
  min_limit: number | null; max_limit: number | null; sort_order: number;
};
export type CharacteristicInput = Omit<Characteristic, "id" | "part_type_id">;
export type Balloon = { id: number; part_type_id: number; number: number; characteristic_id: number; x: number; y: number };
export type BalloonInput = Omit<Balloon, "id" | "part_type_id">;
export type Measurement = {
  id: number; characteristic_id: number; actual_value: number; status: "IN_TOLERANCE" | "PENDING";
  nominal_snapshot?: number | null; lower_limit_snapshot?: number | null; upper_limit_snapshot?: number | null;
};
export type Inspection = {
  id: number; part_type_id: number; serial: string; inspector: string;
  status: "CONFORMING" | "PENDING" | "ACCEPTED_WITH_DEVIATIONS" | "REJECTED";
  started_at: string; completed_at: string | null; annulled_at: string | null;
  characteristic_ids: number[]; measurements: Measurement[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: "include",
    headers: init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error HTTP ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
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
    createPart: (input: { code: string }) => request<PartType>("/api/part-types", json("POST", input)),
    patchPart: (id: number, input: { active: boolean }) => request<PartType>(`/api/part-types/${id}`, json("PATCH", input)),
    uploadImage: (id: number, file: File) => { const body = new FormData(); body.append("file", file); return request<PartType>(`/api/part-types/${id}/image`, { method: "POST", body }); },
    imageUrl: (id: number) => `/api/part-types/${id}/image`,
    characteristics: (id: number) => request<Characteristic[]>(`/api/part-types/${id}/characteristics`),
    createCharacteristic: (id: number, input: CharacteristicInput) => request<Characteristic>(`/api/part-types/${id}/characteristics`, json("POST", input)),
    patchCharacteristic: (id: number, input: CharacteristicInput) => request<Characteristic>(`/api/characteristics/${id}`, json("PATCH", input)),
    deleteCharacteristic: (id: number) => request<void>(`/api/characteristics/${id}`, { method: "DELETE" }),
    balloons: (id: number) => request<Balloon[]>(`/api/part-types/${id}/balloons`),
    createBalloon: (id: number, input: BalloonInput) => request<Balloon>(`/api/part-types/${id}/balloons`, json("POST", input)),
    deleteBalloon: (id: number) => request<void>(`/api/balloons/${id}`, { method: "DELETE" }),
  },
  inspections: {
    start: (input: { part_type_id: number; serial: string; characteristic_ids: number[] }) => request<Inspection>("/api/inspections", json("POST", input)),
    record: (id: number, input: { characteristic_id: number; actual_value: number }) => request<Measurement>(`/api/inspections/${id}/measurements`, json("POST", input)),
    complete: (id: number) => request<Inspection>(`/api/inspections/${id}/complete`, json("POST")),
  },
};
