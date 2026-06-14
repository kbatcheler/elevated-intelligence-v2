import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGrant,
  fetchAccessEvents,
  fetchGrants,
  fetchHumanSignals,
  fetchKeyStatus,
  provisionTenantKey,
  revokeGrant,
  revokeTenantKey,
  verifyProvenance,
} from "./securityApi";

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

describe("securityApi.fetchKeyStatus", () => {
  it("returns the key status payload on success from the tenant key route", async () => {
    const payload = {
      tenantId: "t1",
      provisioned: true,
      status: "active",
      revokedAt: null,
      kms: { provider: "local", connected: true, detail: "local" },
      customerKms: { provider: "customer-kms", connected: false, detail: "available, not connected" },
    };
    const fn = mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await fetchKeyStatus("t1")).toEqual({ ok: true, data: payload });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/key");
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchKeyStatus("t1")).toEqual({ unauthorized: true });
  });

  it("surfaces the server error code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "tenant_not_found" }) });
    expect(await fetchKeyStatus("t1")).toEqual({ error: "tenant_not_found" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchKeyStatus("t1")).toEqual({ error: "failed" });
  });
});

describe("securityApi.provisionTenantKey", () => {
  it("posts to the provision route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 201 });
    expect(await provisionTenantKey("t1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/key/provision", { method: "POST" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await provisionTenantKey("t1")).toEqual({ unauthorized: true });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await provisionTenantKey("t1")).toEqual({ error: "failed" });
  });
});

describe("securityApi.revokeTenantKey", () => {
  it("posts to the revoke route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await revokeTenantKey("t1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/key/revoke", { method: "POST" });
  });

  it("surfaces no_key_to_revoke on a 404 body", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "no_key_to_revoke" }) });
    expect(await revokeTenantKey("t1")).toEqual({ error: "no_key_to_revoke" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await revokeTenantKey("t1")).toEqual({ unauthorized: true });
  });
});

describe("securityApi.fetchGrants", () => {
  it("returns ready with the grants when the list is non-empty", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ grants: [{ id: "g1" }] }) });
    expect(await fetchGrants("t1")).toEqual({ state: "ready", items: [{ id: "g1" }] });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/grants");
  });

  it("returns empty when there are no grants", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ grants: [] }) });
    expect(await fetchGrants("t1")).toEqual({ state: "empty", items: [] });
  });

  it("treats a missing list field as empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    expect(await fetchGrants("t1")).toEqual({ state: "empty", items: [] });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchGrants("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchGrants("t1")).toEqual({ state: "error" });
  });
});

describe("securityApi.createGrant", () => {
  it("posts the grant payload and returns ok", async () => {
    const input = { userId: "u1", reason: "incident triage", expiresInMinutes: 30 };
    const fn = mockFetch({ ok: true, status: 201 });
    expect(await createGrant("t1", input)).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("surfaces the server error code on a non-ok body", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "invalid_input" }) });
    expect(await createGrant("t1", { userId: "u1", reason: "x", expiresInMinutes: 5 })).toEqual({
      error: "invalid_input",
    });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await createGrant("t1", { userId: "u1", reason: "x", expiresInMinutes: 5 })).toEqual({
      unauthorized: true,
    });
  });
});

describe("securityApi.revokeGrant", () => {
  it("posts to the grant revoke route and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200 });
    expect(await revokeGrant("g1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/security/grants/g1/revoke", { method: "POST" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await revokeGrant("g1")).toEqual({ unauthorized: true });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await revokeGrant("g1")).toEqual({ error: "failed" });
  });
});

describe("securityApi.fetchAccessEvents", () => {
  it("returns ready with the events from the access-events route", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ events: [{ id: "e1" }] }) });
    expect(await fetchAccessEvents("t1")).toEqual({ state: "ready", items: [{ id: "e1" }] });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/access-events");
  });

  it("returns empty when there are no events", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ events: [] }) });
    expect(await fetchAccessEvents("t1")).toEqual({ state: "empty", items: [] });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchAccessEvents("t1")).toEqual({ state: "error" });
  });
});

describe("securityApi.verifyProvenance", () => {
  it("returns a clean verify payload", async () => {
    const payload = { ok: true, length: 12 };
    const fn = mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await verifyProvenance("t1")).toEqual({ ok: true, data: payload });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/provenance/verify");
  });

  it("returns a broken-chain verify payload faithfully", async () => {
    const payload = { ok: false, length: 7, brokenAt: 3, detail: "content hash mismatch (tampered entry)" };
    mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await verifyProvenance("t1")).toEqual({ ok: true, data: payload });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await verifyProvenance("t1")).toEqual({ unauthorized: true });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await verifyProvenance("t1")).toEqual({ error: "failed" });
  });
});

describe("securityApi.fetchHumanSignals", () => {
  it("returns ready with the decrypted signals on success", async () => {
    const signals = [{ layerKey: "l1", signalKey: "s1", value: 1, window: null, sourceConnectorKey: null, computedAt: "2026-01-01T00:00:00.000Z" }];
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ tenantId: "t1", signals }) });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "ready", signals });
    expect(fn).toHaveBeenCalledWith("/api/security/tenants/t1/signals");
  });

  it("returns empty when the tenant has no signals", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ tenantId: "t1", signals: [] }) });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "empty", signals: [] });
  });

  it("maps a 403 break_glass_required to its own state with the detail", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "break_glass_required", detail: "no active grant" }) });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "break_glass_required", detail: "no active grant" });
  });

  it("maps a 409 crypto_shredded to its own state", async () => {
    mockFetch({ ok: false, status: 409, json: async () => ({ error: "crypto_shredded", detail: "key revoked" }) });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "crypto_shredded", detail: "key revoked" });
  });

  it("maps a 422 signal_unreadable to its own state", async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ error: "signal_unreadable", detail: "no active key" }) });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "signal_unreadable", detail: "no active key" });
  });

  it("returns unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchHumanSignals("t1")).toEqual({ unauthorized: true });
  });

  it("returns a generic error on an unexpected non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchHumanSignals("t1")).toEqual({ state: "error" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchHumanSignals("t1")).toEqual({ state: "error" });
  });
});
