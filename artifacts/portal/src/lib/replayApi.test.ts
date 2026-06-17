import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantAsOf } from "../types";
import { diligencePackUrl, fetchTenantAsOf } from "./replayApi";

type FetchResult = { ok: boolean; status: number; json?: () => Promise<unknown> };

const originalFetch = globalThis.fetch;

function mockFetch(result: FetchResult | Error) {
  const fn = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { ok: result.ok, status: result.status, json: result.json ?? (async () => ({})) };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const asOf = { tenantId: "t1", layers: [], asOf: "2026-01-01T00:00:00.000Z" } as unknown as TenantAsOf;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("replayApi.fetchTenantAsOf", () => {
  it("returns ready and encodes both the tenant id and the instant", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ asOf }) });
    expect(await fetchTenantAsOf("t 1", "2026-01-01T00:00:00.000Z")).toEqual({ state: "ready", data: asOf });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t%201/as-of?at=2026-01-01T00%3A00%3A00.000Z");
  });

  it("surfaces a 400 as the distinct bad-date state, not a generic error", async () => {
    mockFetch({ ok: false, status: 400 });
    expect(await fetchTenantAsOf("t1", "garbage")).toEqual({ state: "bad-date" });
  });

  it("returns unauthorized on 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchTenantAsOf("t1", "x")).toEqual({ unauthorized: true });
  });

  it("returns error on a malformed body whose asOf has no layers array", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ asOf: { tenantId: "t1" } }) });
    expect(await fetchTenantAsOf("t1", "x")).toEqual({ state: "error" });
  });

  it("returns error on a non-ok, non-auth status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchTenantAsOf("t1", "x")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchTenantAsOf("t1", "x")).toEqual({ state: "error" });
  });
});

describe("replayApi.diligencePackUrl", () => {
  it("builds the html route and encodes the tenant id", () => {
    expect(diligencePackUrl("t 1/x")).toBe("/api/tenants/t%201%2Fx/diligence-pack.html");
  });
});
