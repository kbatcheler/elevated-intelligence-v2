import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantEfficacy } from "../types";
import { fetchTenantEfficacy } from "./efficacyApi";

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

// A minimal but well-formed rollup: the helper only asserts that the payload
// carries an efficacy object with a rollup and a layers array, so the rest can
// be empty without being malformed.
const efficacy: TenantEfficacy = {
  dataMode: "connected",
  modeCeiling: 100,
  rollup: { score: 72, n: 5 },
  layers: [],
} as unknown as TenantEfficacy;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("efficacyApi.fetchTenantEfficacy", () => {
  it("returns ready with the efficacy and reads the tenant route", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ efficacy }) });
    expect(await fetchTenantEfficacy("abc")).toEqual({ state: "ready", data: efficacy });
    expect(fn).toHaveBeenCalledWith("/api/tenants/abc/efficacy");
  });

  it("encodes the tenant id in the route", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ efficacy }) });
    await fetchTenantEfficacy("ten ant/id");
    expect(fn).toHaveBeenCalledWith("/api/tenants/ten%20ant%2Fid/efficacy");
  });

  it("returns unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchTenantEfficacy("abc")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchTenantEfficacy("abc")).toEqual({ state: "error" });
  });

  it("returns error on a malformed body missing the rollup or layers", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ efficacy: { dataMode: "connected" } }) });
    expect(await fetchTenantEfficacy("abc")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchTenantEfficacy("abc")).toEqual({ state: "error" });
  });
});
