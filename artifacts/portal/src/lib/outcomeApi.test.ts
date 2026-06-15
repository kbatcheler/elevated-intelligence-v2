import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOutcomes, recordMeasurement } from "./outcomeApi";

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

const summary = {
  valueIdentifiedUsd: 300,
  valueRealizedUsd: 120,
  actionsWithPrediction: 2,
  actionsMeasured: 1,
  calibration: { score: 0.5, hits: 1, misses: 1, resolved: 2 },
};

describe("fetchOutcomes", () => {
  it("returns ready with the outcomes payload from the tenant endpoint", async () => {
    const fn = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ outcomes: { summary, measurements: [] } }),
    });
    expect(await fetchOutcomes("t1")).toEqual({
      state: "ready",
      data: { summary, measurements: [] },
    });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/outcomes");
  });

  it("surfaces unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchOutcomes("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchOutcomes("t1")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchOutcomes("t1")).toEqual({ state: "error" });
  });
});

describe("recordMeasurement", () => {
  it("posts the measurement body to the per-action endpoint and returns the row", async () => {
    const measurement = { id: "m1", actionId: "a1", status: "realized" };
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ measurement }) });
    const out = await recordMeasurement("t1", "a1", { realizedValueUsd: 120, final: true });
    expect(out).toEqual({ ok: true, measurement });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/actions/a1/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ realizedValueUsd: 120, final: true }),
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await recordMeasurement("t1", "a1", { realizedValueUsd: 1 })).toEqual({
      unauthorized: true,
    });
  });

  it("extracts the server error code on a non-ok status", async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: "signal_not_found" }) });
    expect(await recordMeasurement("t1", "a1", { signalKey: "x" })).toEqual({
      error: "signal_not_found",
    });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await recordMeasurement("t1", "a1", { realizedValueUsd: 1 })).toEqual({
      error: "failed",
    });
  });
});
