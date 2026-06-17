import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortfolioSummary } from "../types";
import { fetchPortfolioSummary } from "./portfolioApi";

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

const portfolio = { tenants: [], rollup: {} } as unknown as PortfolioSummary;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("portfolioApi.fetchPortfolioSummary", () => {
  it("returns ready with the portfolio and reads the summary route", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ portfolio }) });
    expect(await fetchPortfolioSummary()).toEqual({ state: "ready", data: portfolio });
    expect(fn).toHaveBeenCalledWith("/api/portfolio/summary");
  });

  it("returns unauthorized on 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchPortfolioSummary()).toEqual({ unauthorized: true });
  });

  it("returns the distinct forbidden state on 403, not a generic error", async () => {
    mockFetch({ ok: false, status: 403 });
    expect(await fetchPortfolioSummary()).toEqual({ forbidden: true });
  });

  it("returns error on a non-ok, non-auth status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchPortfolioSummary()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("offline"));
    expect(await fetchPortfolioSummary()).toEqual({ state: "error" });
  });
});
