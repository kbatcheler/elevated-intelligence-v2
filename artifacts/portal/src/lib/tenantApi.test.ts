import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commitAction,
  fetchActions,
  fetchArchitecture,
  fetchBenchmarkConsent,
  fetchLayers,
  fetchRuns,
  fetchSignals,
  fetchTenant,
  fetchTenantLayer,
  fetchTenants,
  setActionStatus,
  setBenchmarkConsent,
} from "./tenantApi";

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

describe("list loaders", () => {
  it("fetchTenants returns ready with items and hits the access-filtered endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ tenants: [{ id: "t1" }] }) });
    expect(await fetchTenants()).toEqual({ state: "ready", items: [{ id: "t1" }] });
    expect(fn).toHaveBeenCalledWith("/api/tenants");
  });

  it("fetchLayers returns empty when the registry list is empty", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ layers: [] }) });
    expect(await fetchLayers()).toEqual({ state: "empty", items: [] });
  });

  it("fetchRuns targets the tenant runs endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ runs: [{ id: "r1" }] }) });
    expect(await fetchRuns("t1")).toEqual({ state: "ready", items: [{ id: "r1" }] });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/runs");
  });

  it("fetchActions targets the tenant actions endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ actions: [] }) });
    expect(await fetchActions("t1")).toEqual({ state: "empty", items: [] });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/actions");
  });

  it("a 401 on a list surfaces as unauthorized, not an error", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchTenants()).toEqual({ unauthorized: true });
  });

  it("a non-ok, non-401 list response is an error state", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchTenants()).toEqual({ state: "error" });
  });

  it("a thrown fetch is an error state", async () => {
    mockFetch(new Error("network"));
    expect(await fetchActions("t1")).toEqual({ state: "error" });
  });

  it("fetchSignals targets the tenant signals endpoint", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ signals: [{ key: "finance" }] }) });
    expect(await fetchSignals("t1")).toEqual({ state: "ready", items: [{ key: "finance" }] });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/signals");
  });
});

describe("detail loaders", () => {
  it("fetchTenantLayer returns ready with the layer payload", async () => {
    const payload = { tenantId: "t1", layerKey: "finance", content: {} };
    const fn = mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await fetchTenantLayer("t1", "finance")).toEqual({ state: "ready", data: payload });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/layers/finance");
  });

  it("a 404 on a layer is the empty state, distinct from error", async () => {
    mockFetch({ ok: false, status: 404 });
    expect(await fetchTenantLayer("t1", "missing")).toEqual({ state: "empty" });
  });

  it("a 401 on a detail surfaces as unauthorized", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchTenant("t1")).toEqual({ unauthorized: true });
  });

  it("a 500 on a detail is an error state", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchTenant("t1")).toEqual({ state: "error" });
  });

  it("fetchArchitecture returns the engine config object from the global endpoint", async () => {
    const payload = { seats: { reasoner: { provider: "anthropic", model: "m" } }, stages: [] };
    const fn = mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await fetchArchitecture()).toEqual({ state: "ready", data: payload });
    expect(fn).toHaveBeenCalledWith("/api/architecture");
  });
});

describe("writes", () => {
  it("commitAction posts the action and returns the created record", async () => {
    const action = { id: "a1", title: "Cut spend" };
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ action }) });
    const out = await commitAction("t1", {
      layerKey: "finance",
      title: "Cut spend",
      basis: "modelled",
      confidence: 70,
    });
    expect(out).toEqual({ ok: true, action });
    expect(fn).toHaveBeenCalledWith(
      "/api/tenants/t1/actions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("commitAction surfaces a validation error message", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "invalid_input" }) });
    expect(
      await commitAction("t1", { layerKey: "finance", title: "x", basis: "verified", confidence: 1 }),
    ).toEqual({ error: "invalid_input" });
  });

  it("setActionStatus posts the new status", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ action: {} }) });
    expect(await setActionStatus("t1", "a1", "done", "shipped")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith(
      "/api/tenants/t1/actions/a1/status",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("a 401 on a write surfaces as unauthorized", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await setActionStatus("t1", "a1", "done")).toEqual({ unauthorized: true });
  });

  it("a 404 on a status update is a plain error", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    expect(await setActionStatus("t1", "missing", "done")).toEqual({ error: "not_found" });
  });
});

describe("benchmark consent", () => {
  it("fetchBenchmarkConsent returns the persisted opt state and audit", async () => {
    const payload = { optIn: true, events: [{ id: "e1", action: "opt_in" }] };
    const fn = mockFetch({ ok: true, status: 200, json: async () => payload });
    expect(await fetchBenchmarkConsent("t1")).toEqual({ state: "ready", data: payload });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/benchmark-consent");
  });

  it("setBenchmarkConsent posts the opt state and returns the confirmed change", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ optIn: true, changed: true }) });
    expect(await setBenchmarkConsent("t1", true, "joining the cohort")).toEqual({
      ok: true,
      optIn: true,
      changed: true,
    });
    expect(fn).toHaveBeenCalledWith(
      "/api/tenants/t1/benchmark-consent",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("setBenchmarkConsent reports an unchanged no-op honestly", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ optIn: false, changed: false }) });
    expect(await setBenchmarkConsent("t1", false)).toEqual({ ok: true, optIn: false, changed: false });
  });

  it("a forbidden read-only seat surfaces as an error, not a silent success", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    expect(await setBenchmarkConsent("t1", true)).toEqual({ error: "forbidden" });
  });

  it("a 401 on a consent write surfaces as unauthorized", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await setBenchmarkConsent("t1", true)).toEqual({ unauthorized: true });
  });
});
