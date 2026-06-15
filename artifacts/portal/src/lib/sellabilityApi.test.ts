import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaseStudy, MintedShareToken, ShareToken } from "../types";
import {
  fetchCaseStudies,
  fetchShareTokens,
  mintShareToken,
  revokeShareToken,
} from "./sellabilityApi";

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

function share(overrides: Partial<ShareToken> = {}): ShareToken {
  return {
    id: "s1",
    privacyLevel: "summary_only",
    label: "Acme prospect",
    status: "active",
    expiresAt: "2026-07-15T00:00:00.000Z",
    revokedAt: null,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

function caseStudy(overrides: Partial<CaseStudy> = {}): CaseStudy {
  return {
    segmentKey: "saas|1m-10m",
    sector: "SaaS",
    revenueBand: "1m-10m",
    contributorCount: 7,
    noised: false,
    realizedUsd: { p25: 1000, p50: 2000, p75: 3000 },
    identifiedUsd: { p25: 4000, p50: 5000, p75: 6000 },
    calibration: { hits: 4, misses: 1, resolved: 5, score: 0.8 },
    ...overrides,
  };
}

describe("fetchShareTokens", () => {
  it("returns ready with the share list", async () => {
    const shares = [share()];
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ shares }) });
    expect(await fetchShareTokens("t1")).toEqual({ state: "ready", shares });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/share-tokens");
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchShareTokens("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchShareTokens("t1")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchShareTokens("t1")).toEqual({ state: "error" });
  });
});

describe("mintShareToken", () => {
  it("posts the mint options and returns the one-time minted share", async () => {
    const minted: MintedShareToken = {
      ...share(),
      token: "opaque-token",
      diagnosisPath: "/d/opaque-token",
    };
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ share: minted }) });
    expect(await mintShareToken("t1", { label: "Acme", expiresInDays: 14 })).toEqual({
      ok: true,
      share: minted,
    });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/share-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Acme", expiresInDays: 14 }),
    });
  });

  it("defaults to an empty body when no options are given", async () => {
    const minted: MintedShareToken = {
      ...share(),
      token: "opaque-token",
      diagnosisPath: "/d/opaque-token",
    };
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ share: minted }) });
    await mintShareToken("t1");
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/share-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await mintShareToken("t1")).toEqual({ unauthorized: true });
  });

  it("extracts the server error code on a forbidden seat", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    expect(await mintShareToken("t1")).toEqual({ error: "forbidden" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await mintShareToken("t1")).toEqual({ error: "failed" });
  });
});

describe("revokeShareToken", () => {
  it("posts the revoke and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ revoked: {} }) });
    expect(await revokeShareToken("t1", "s1")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/share-tokens/s1/revoke", {
      method: "POST",
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await revokeShareToken("t1", "s1")).toEqual({ unauthorized: true });
  });

  it("maps a 404 to the server error code", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    expect(await revokeShareToken("t1", "missing")).toEqual({ error: "not_found" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await revokeShareToken("t1", "s1")).toEqual({ error: "failed" });
  });
});

describe("fetchCaseStudies", () => {
  it("returns ready with the case study list", async () => {
    const caseStudies = [caseStudy()];
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ caseStudies }) });
    expect(await fetchCaseStudies()).toEqual({ state: "ready", caseStudies });
    expect(fn).toHaveBeenCalledWith("/api/case-studies");
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchCaseStudies()).toEqual({ unauthorized: true });
  });

  it("returns error on a forbidden seat", async () => {
    mockFetch({ ok: false, status: 403 });
    expect(await fetchCaseStudies()).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchCaseStudies()).toEqual({ state: "error" });
  });
});
