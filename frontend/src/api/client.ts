export type Role = "admin" | "inspector";
export type User = { id: number; username: string; role: Role; active: boolean };
export type PartType = { id: number; part_number: string; part_description: string; image_path: string | null; revision_no: number; active: boolean };
export type Characteristic = {
  id: number; part_type_id: number; control_plan: string; name: string | null; unit: string | null;
  measurement_method: string; tol_type: "SYMMETRIC" | "LIMITS"; nominal: number; tol_plus: number | null; tol_minus: number | null;
  min_limit: number; max_limit: number; sort_order: number;
};
export type CharacteristicInput = {
  control_plan: string; name: string | null; unit: string | null; measurement_method: string;
  tol_type: Characteristic["tol_type"]; nominal: number; tol_plus: number | null; tol_minus: number | null;
  min_limit: number | null; max_limit: number | null; sort_order: number;
};
export type Balloon = { id: number; part_type_id: number; characteristic_id: number; x: number; y: number };
export type BalloonInput = Omit<Balloon, "id" | "part_type_id">;
export type PartRevision = {
  id: number; part_type_id: number; revision_no: number; definition_json: string;
  created_by: number | null; created_at: string;
};
export type RevisionCharacteristic = Omit<Characteristic, "part_type_id"> & {
  active: boolean; balloon: { x: number; y: number } | null;
};
export type PartDefinition = Pick<PartType, "part_number" | "part_description" | "image_path" | "active"> & {
  characteristics: RevisionCharacteristic[];
};
export type Measurement = {
  id: number; characteristic_id: number; actual_value: number; status: "IN_TOLERANCE" | "PENDING" | "DEVIATION_ACCEPTED" | "REJECTED";
  nominal_snapshot?: number | null; min_limit_snapshot?: number | null; max_limit_snapshot?: number | null;
  measurement_method_snapshot?: string | null;
  deviation?: number | null; disposition_note?: string | null;
};
export type Deviation = {
  id: number; measurement_id: number; origin: "AUTO" | "MANUAL"; status: "PENDING" | "ACCEPTED" | "REJECTED";
  description: string | null; created_by: number | null; created_at: string;
  approved_deviation_id: number | null; approved_deviation_code_snapshot: string | null;
  approved_deviation_description_snapshot: string | null; rejection_reason: string | null;
  resolved_by: number | null; resolved_at: string | null;
};
export type ApprovedDeviation = { id: number; code: string; description: string; active: boolean; created_at: string };
export type DeviationResolutionInput =
  | { action: "accept"; approved_deviation_id: number }
  | { action: "reject"; rejection_reason: string };
export type QueueInspection = { id: number; part_number: string; inspector: string; completed_at: string | null; annulled_at: string | null; status: Inspection["status"] };
export type DeviationGroup = { inspection: QueueInspection; deviations: Deviation[]; measurements: Measurement[] };
export type Inspection = {
  id: number; part_type_id: number; part_revision_id: number; inspector: string;
  status: "CONFORMING" | "PENDING" | "ACCEPTED_WITH_DEVIATIONS" | "REJECTED";
  started_at: string; completed_at: string | null; annulled_at: string | null;
  characteristic_ids: number[]; measurements: Measurement[];
};
export type StabilityPoint = {
  inspection_id: number; completed_at: string; actual: number;
  deviation: number | null; status: Measurement["status"];
};
export type StabilityAnalysis = {
  characteristic: { control_plan: string; name: string | null; unit: string | null; nominal: number | null; lower_limit: number | null; upper_limit: number | null };
  points: StabilityPoint[];
};
export type GeneratedReport = {
  id: number; inspection_id: number; part_revision_id: number; content_hash: string;
  file_path: string; generated_by: number; generated_at: string;
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

async function download(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error HTTP ${response.status}`);
  }
  return response.blob();
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
    revisions: (id: number) => request<PartRevision[]>(`/api/part-types/${id}/revisions`),
    restoreRevision: (id: number, revisionNo: number) => request<PartRevision>(`/api/part-types/${id}/revisions/${revisionNo}/restore`, json("POST")),
    createPart: (input: Pick<PartType, "part_number" | "part_description">) => request<PartType>("/api/part-types", json("POST", input)),
    patchPart: (id: number, input: Partial<Pick<PartType, "part_number" | "part_description" | "active">>) => request<PartType>(`/api/part-types/${id}`, json("PATCH", input)),
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
    list: (scope?: "shared") => request<Inspection[]>(`/api/inspections${scope ? `?scope=${scope}` : ""}`),
    start: (input: { part_type_id: number; characteristic_ids: number[] }) => request<Inspection>("/api/inspections", json("POST", input)),
    record: (id: number, input: { characteristic_id: number; actual_value: number }) => request<Measurement>(`/api/inspections/${id}/measurements`, json("POST", input)),
    createDeviation: (inspectionId: number, measurementId: number, description: string) => request<Deviation>(`/api/inspections/${inspectionId}/measurements/${measurementId}/deviations`, json("POST", { description })),
    complete: (id: number) => request<Inspection>(`/api/inspections/${id}/complete`, json("POST")),
    detail: (id: number) => request<Inspection>(`/api/inspections/${id}`),
    annul: (id: number, reason: string) => request<Inspection>(`/api/inspections/${id}/annul`, json("POST", { reason })),
  },
  approvedDeviations: {
    listActive: () => request<ApprovedDeviation[]>("/api/approved-deviations?active_only=true"),
  },
  deviations: {
    list: (includeResolved = false) => request<{ groups: DeviationGroup[] }>(`/api/deviations${includeResolved ? "?include_resolved=true" : ""}`),
    resolve: (id: number, input: DeviationResolutionInput) => request<Deviation>(`/api/deviations/${id}/resolution`, json("POST", input)),
  },
  reports: {
    list: () => request<GeneratedReport[]>("/api/reports"),
    generate: (inspectionId: number) => request<GeneratedReport>(`/api/inspections/${inspectionId}/reports`, json("POST")),
    download: (reportId: number) => download(`/api/reports/${reportId}/download`),
  },
  stability: {
    analysis: (partTypeId: number, characteristicId: number) => request<StabilityAnalysis>(`/api/stability?part_type_id=${partTypeId}&characteristic_id=${characteristicId}`),
  },
};
