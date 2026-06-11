import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindTenant,
  createOrg,
  fetchOrgs,
  fetchPins,
  fetchTenants,
  fetchUsers,
  mintPin,
  revokePin,
  setUserStatus,
} from "./adminApi";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("adminApi list loaders", () => {
  it("fetchPins returns ready with the items when the list is non-empty", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ pins: [{ id: "p1" }] }) });
    expect(await fetchPins()).toEqual({ state: "ready", items: [{ id: "p1" }] });
    expect(fn).toHaveBeenCalledWith("/api/admin/pins");
  });

  it("fetchPins returns empty when the list is empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ pins: [] }) });
    expect(await fetchPins()).toEqual({ state: "empty", items: [] });
  });

  it("treats a missing list field as empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    expect(await fetchUsers()).toEqual({ state: "empty", items: [] });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchOrgs()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchOrgs()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchTenants()).toEqual({ state: "error" });
  });

  it("reads each loader from its own route and field", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ orgs: [{ id: "o1" }] }) });
    expect(await fetchOrgs()).toEqual({ state: "ready", items: [{ id: "o1" }] });
    expect(fn).toHaveBeenCalledWith("/api/admin/orgs");
  });
});

describe("adminApi.mintPin", () => {
  it("returns the minted code on success and posts the payload", async () => {
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ pin: { code: "ABCD" } }) });
    const payload = { label: "batch", maxUses: 1, expiresInDays: 14, scopeRole: "client-viewer", scopeOrgId: "o1" };
    expect(await mintPin(payload)).toEqual({ code: "ABCD" });
    expect(fn).toHaveBeenCalledWith("/api/admin/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await mintPin({ label: "", maxUses: 1, expiresInDays: 14, scopeRole: "client-viewer" })).toEqual({
      unauthorized: true,
    });
  });

  it("surfaces the server error code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "scope_org_required" }) });
    expect(await mintPin({ label: "", maxUses: 1, expiresInDays: 14, scopeRole: "client-viewer" })).toEqual({
      error: "scope_org_required",
    });
  });

  it("falls back to a generic error when the body has none", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({}) });
    expect(await mintPin({ label: "", maxUses: 1, expiresInDays: 14, scopeRole: "client-viewer" })).toEqual({
      error: "failed",
    });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await mintPin({ label: "", maxUses: 1, expiresInDays: 14, scopeRole: "client-viewer" })).toEqual({
      error: "failed",
    });
  });
});

describe("adminApi.revokePin", () => {
  it("posts to the revoke route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await revokePin("p1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/admin/pins/p1/revoke", { method: "POST" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await revokePin("p1")).toEqual({ unauthorized: true });
  });

  it("returns an error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await revokePin("p1")).toEqual({ error: "failed" });
  });

  it("returns an error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await revokePin("p1")).toEqual({ error: "failed" });
  });
});

describe("adminApi.setUserStatus", () => {
  it("posts to the action route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await setUserStatus("u1", "disable")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/admin/users/u1/disable", { method: "POST" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await setUserStatus("u1", "enable")).toEqual({ unauthorized: true });
  });

  it("surfaces the server guard code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "cannot_disable_last_owner" }) });
    expect(await setUserStatus("u1", "disable")).toEqual({ error: "cannot_disable_last_owner" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await setUserStatus("u1", "disable")).toEqual({ error: "failed" });
  });
});

describe("adminApi.createOrg", () => {
  it("posts the org and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 201 });
    expect(await createOrg({ name: "Acme", type: "client" })).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/admin/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Acme", type: "client" }),
    });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await createOrg({ name: "Acme", type: "client" })).toEqual({ unauthorized: true });
  });

  it("returns an error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 400 });
    expect(await createOrg({ name: "Acme", type: "client" })).toEqual({ error: "failed" });
  });
});

describe("adminApi.bindTenant", () => {
  it("posts the binding and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await bindTenant("o1", "t1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/admin/orgs/o1/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t1" }),
    });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await bindTenant("o1", "t1")).toEqual({ unauthorized: true });
  });

  it("surfaces the server error code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "provider_org_needs_no_bindings" }) });
    expect(await bindTenant("o1", "t1")).toEqual({ error: "provider_org_needs_no_bindings" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await bindTenant("o1", "t1")).toEqual({ error: "failed" });
  });
});
