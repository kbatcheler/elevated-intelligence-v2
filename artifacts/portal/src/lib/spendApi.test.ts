import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSpendSummary } from "./spendApi";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("spendApi.fetchSpendSummary", () => {
  it("returns ready with the spend payload and reads the owner-only route", async () => {
    const spend = { total: { costUsd: 1, calls: 2 } };
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ spend }) });
    expect(await fetchSpendSummary()).toEqual({ state: "ready", data: spend });
    expect(fn).toHaveBeenCalledWith("/api/spend/summary");
  });

  it("returns unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchSpendSummary()).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok, non-401 status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchSpendSummary()).toEqual({ state: "error" });
  });

  it("returns error on a malformed body with no spend field", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    expect(await fetchSpendSummary()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchSpendSummary()).toEqual({ state: "error" });
  });
});
