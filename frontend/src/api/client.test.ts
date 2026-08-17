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
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: 7, code: "PT-100", image_path: null, active: true }))));
    vi.stubGlobal("fetch", fetchMock);
    await api.catalog.createPart({ code: "PT-100" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/part-types", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "PT-100" }) }));
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
    await api.inspections.start({ part_type_id: 7, serial: "SER-1", characteristic_ids: [8] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections", expect.objectContaining({ method: "POST", body: JSON.stringify({ part_type_id: 7, serial: "SER-1", characteristic_ids: [8] }) }));
    await api.inspections.record(20, { characteristic_id: 8, actual_value: 10.1 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/measurements", expect.objectContaining({ method: "POST", body: JSON.stringify({ characteristic_id: 8, actual_value: 10.1 }) }));
    await api.inspections.complete(20);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/complete", expect.objectContaining({ method: "POST" }));
  });

  it("uses deviation, annulment, detail, and authorized PDF contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 30, status: "REJECTED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 20, status: "REJECTED" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 20, annulled_at: "now" })))
      .mockResolvedValueOnce(new Response(new Blob(["pdf"], { type: "application/pdf" })));
    vi.stubGlobal("fetch", fetchMock);
    await api.deviations.list();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/deviations", expect.objectContaining({ credentials: "include" }));
    await api.deviations.dispose(30, { action: "reject", text: "Fuera de límite" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/measurements/30/disposition", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "reject", text: "Fuera de límite" }) }));
    await api.inspections.detail(20);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20", expect.any(Object));
    await api.inspections.annul(20, "Serie incorrecta");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/annul", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Serie incorrecta" }) }));
    await expect(api.inspections.report(20)).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inspections/20/report.pdf", expect.objectContaining({ credentials: "include" }));
  });
});
