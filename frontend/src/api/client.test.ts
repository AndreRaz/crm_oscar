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
});
