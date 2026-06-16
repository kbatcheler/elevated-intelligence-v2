import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalibrationSummary } from "../types";
import { fetchCalibrationSummary } from "./calibrationApi";

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

// A minimal but well-formed summary: the helper only asserts headline + scope are
// present, so the rest can be empty without being malformed.
const summary: CalibrationSummary = {
  scope: { kind: "system" },
  baseline: 0.25,
  headline: { meanBrier: 0.18, n: 24, sample: { established: true, label: "established" } },
  curve: [],
  byLayer: [],
  byKind: [],
  bySeat: [],
  ledger: [],
} as unknown as CalibrationSummary;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("calibrationApi.fetchCalibrationSummary", () => {
  it("returns ready with the summary and reads the system-wide route by default", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => summary });
    expect(await fetchCalibrationSummary()).toEqual({ state: "ready", data: summary });
    expect(fn).toHaveBeenCalledWith("/api/calibration");
  });

  it("scopes the route to a tenant when given a tenantId", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => summary });
    await fetchCalibrationSummary("ten ant/id");
    expect(fn).toHaveBeenCalledWith("/api/calibration?tenantId=ten%20ant%2Fid");
  });

  it("returns unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchCalibrationSummary()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchCalibrationSummary()).toEqual({ state: "error" });
  });

  it("returns error on a malformed body missing headline or scope", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ scope: { kind: "system" } }) });
    expect(await fetchCalibrationSummary()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchCalibrationSummary()).toEqual({ state: "error" });
  });
});
