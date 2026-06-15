import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicDiagnosis } from "../types";
import { fetchPublicDiagnosis } from "./publicApi";

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

function diagnosis(): PublicDiagnosis {
  return {
    layers: [],
    caseStudy: null,
    poweredBy: { label: "Powered by Elevated Intelligence", href: "/" },
  };
}

describe("fetchPublicDiagnosis", () => {
  it("returns ready with the diagnosis and encodes the token", async () => {
    const d = diagnosis();
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ diagnosis: d }) });
    expect(await fetchPublicDiagnosis("a b/c")).toEqual({ state: "ready", diagnosis: d });
    expect(fn).toHaveBeenCalledWith("/api/public/diagnosis/a%20b%2Fc");
  });

  it("maps a 404 to a uniform unavailable state", async () => {
    mockFetch({ ok: false, status: 404 });
    expect(await fetchPublicDiagnosis("gone")).toEqual({ state: "unavailable" });
  });

  it("returns error on a non-404 failure (for example a rate limit)", async () => {
    mockFetch({ ok: false, status: 429 });
    expect(await fetchPublicDiagnosis("x")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchPublicDiagnosis("x")).toEqual({ state: "error" });
  });
});
