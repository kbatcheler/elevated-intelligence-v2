import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStatus, login, logout, register } from "./authApi";

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

function mockFetch(result: FetchResult | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return {
      ok: result.ok,
      status: result.status,
      json: result.json ?? (async () => ({})),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const sampleUser = {
  id: "u1",
  email: "a@b.com",
  displayName: "A",
  role: "provider-owner" as const,
  orgId: "o1",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("authApi.login", () => {
  it("returns the user on a 200 and posts JSON to the login route", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ user: sampleUser }) });
    const result = await login("A@B.com", "pw");
    expect(result).toEqual({ user: sampleUser });
    expect(fn).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "A@B.com", password: "pw" }),
    });
  });

  it("maps 401 to invalid_credentials", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await login("x", "y")).toEqual({ error: "invalid_credentials" });
  });

  it("maps 403 to account_disabled", async () => {
    mockFetch({ ok: false, status: 403 });
    expect(await login("x", "y")).toEqual({ error: "account_disabled" });
  });

  it("maps any other non-ok status to invalid_input", async () => {
    mockFetch({ ok: false, status: 400 });
    expect(await login("x", "y")).toEqual({ error: "invalid_input" });
  });

  it("maps a thrown fetch to network_error", async () => {
    mockFetch(new Error("offline"));
    expect(await login("x", "y")).toEqual({ error: "network_error" });
  });
});

describe("authApi.register", () => {
  it("returns the user on success", async () => {
    mockFetch({ ok: true, status: 201, json: async () => ({ user: sampleUser }) });
    expect(await register("a@b.com", "A", "pw", "PIN")).toEqual({ user: sampleUser });
  });

  it("maps 403 to invalid_or_used_pin", async () => {
    mockFetch({ ok: false, status: 403 });
    expect(await register("a", "b", "c", "d")).toEqual({ error: "invalid_or_used_pin" });
  });

  it("maps 409 to email_taken", async () => {
    mockFetch({ ok: false, status: 409 });
    expect(await register("a", "b", "c", "d")).toEqual({ error: "email_taken" });
  });

  it("maps any other non-ok status to invalid_input", async () => {
    mockFetch({ ok: false, status: 400 });
    expect(await register("a", "b", "c", "d")).toEqual({ error: "invalid_input" });
  });

  it("maps a thrown fetch to network_error", async () => {
    mockFetch(new Error("offline"));
    expect(await register("a", "b", "c", "d")).toEqual({ error: "network_error" });
  });
});

describe("authApi.fetchStatus", () => {
  it("returns the user when authenticated", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ authenticated: true, user: sampleUser }) });
    expect(await fetchStatus()).toEqual(sampleUser);
  });

  it("returns null when not authenticated", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ authenticated: false }) });
    expect(await fetchStatus()).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchStatus()).toBeNull();
  });

  it("returns null on a thrown fetch", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchStatus()).toBeNull();
  });
});

describe("authApi.logout", () => {
  it("posts to the logout route", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    await logout();
    expect(fn).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });

  it("swallows a thrown fetch so local state can still clear", async () => {
    mockFetch(new Error("offline"));
    await expect(logout()).resolves.toBeUndefined();
  });
});
