import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends JSON login data with the session cookie enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, username: "ana", role: "admin", active: true })));
    vi.stubGlobal("fetch", fetchMock);
    await api.auth.login("ana", "secreto123");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      credentials: "include", method: "POST", body: JSON.stringify({ username: "ana", password: "secreto123" }),
    }));
  });

  it("surfaces the server detail when a request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid credentials" }), { status: 401 })));
    await expect(api.auth.me()).rejects.toThrow("Invalid credentials");
  });

  it("uses typed catalog JSON endpoints and preserves multipart image headers", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: 7, part_number: "PT-100", image_path: null, active: true }))));
    vi.stubGlobal("fetch", fetchMock);
    await api.catalog.createPart({ part_number: "PT-100", part_description: "Body" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/part-types", expect.objectContaining({ method: "POST", body: JSON.stringify({ part_number: "PT-100", part_description: "Body" }) }));
    const file = new File(["image"], "pieza.png", { type: "image/png" });
    await api.catalog.uploadImage(7, file);
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/part-types/7/image");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });

  it("uses the inspection start, measurement, and completion contracts", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: 20, status: "PENDING" }))));
    vi.stubGlobal("fetch", fetchMock);
    await api.inspections.start({ part_type_id: 7, characteristic_ids: [8] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections", expect.objectContaining({ method: "POST", body: JSON.stringify({ part_type_id: 7, characteristic_ids: [8] }) }));
    await api.inspections.record(20, { characteristic_id: 8, actual_value: 10.1 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/measurements", expect.objectContaining({ method: "POST", body: JSON.stringify({ characteristic_id: 8, actual_value: 10.1 }) }));
    await api.inspections.complete(20);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/complete", expect.objectContaining({ method: "POST" }));
  });

  it("keeps owner-scoped inspection discovery as the default and opts into shared discovery", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]))));
    vi.stubGlobal("fetch", fetchMock);

    await api.inspections.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections", expect.objectContaining({ credentials: "include" }));
    await api.inspections.list("shared");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections?scope=shared", expect.objectContaining({ credentials: "include" }));
  });

  it("uses deviation, approved-catalog, annulment, and persisted-report contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 7, code: "DEV-7", active: true }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 50, status: "ACCEPTED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 20, status: "REJECTED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 20, annulled_at: "now" })))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 90, inspection_id: 20 })))
      .mockResolvedValueOnce(new Response(new Blob(["pdf"], { type: "application/pdf" })));
    vi.stubGlobal("fetch", fetchMock);
    await api.deviations.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations", expect.objectContaining({ credentials: "include" }));
    await api.approvedDeviations.listActive();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/approved-deviations?active_only=true", expect.any(Object));
    await api.deviations.resolve(50, { action: "accept", approved_deviation_id: 7 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations/50/resolution", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "accept", approved_deviation_id: 7 }) }));
    await api.inspections.detail(20);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20", expect.any(Object));
    await api.inspections.annul(20, "Inspección duplicada");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/annul", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Inspección duplicada" }) }));
    await api.reports.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/reports", expect.any(Object));
    await api.reports.generate(20);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/reports", expect.objectContaining({ method: "POST" }));
    await expect(api.reports.download(90)).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/reports/90/download", expect.objectContaining({ credentials: "include" }));
  });

  it("requests stability for exactly one part type and characteristic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ characteristic: {}, points: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await api.stability.analysis(7, 8);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stability?part_type_id=7&characteristic_id=8",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("opts into persisted deviation history without changing the default pending queue", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ groups: [] }))));
    vi.stubGlobal("fetch", fetchMock);
    await api.deviations.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations", expect.objectContaining({ credentials: "include" }));
    await api.deviations.list(false);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations", expect.objectContaining({ credentials: "include" }));
    await expect(api.deviations.list(true)).resolves.toEqual({ groups: [] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations?include_resolved=true", expect.objectContaining({ credentials: "include" }));
  });

  it("lists immutable revisions and posts an admin restore without rewriting the snapshot", async () => {
    const revision = { id: 42, part_type_id: 7, revision_no: 4, definition_json: '{"part_number":"PT-100"}', created_by: 1, created_at: "2026-09-01T10:00:00Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([revision])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...revision, id: 43, revision_no: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.catalog.revisions(7)).resolves.toEqual([revision]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/part-types/7/revisions", expect.objectContaining({ credentials: "include" }));
    await expect(api.catalog.restoreRevision(7, 4)).resolves.toEqual({ ...revision, id: 43, revision_no: 5 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/part-types/7/revisions/4/restore", expect.objectContaining({ credentials: "include", method: "POST", body: undefined }));
  });

  it("surfaces a denied revision restore", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 })));
    await expect(api.catalog.restoreRevision(7, 1)).rejects.toThrow("Forbidden");
  });
});
