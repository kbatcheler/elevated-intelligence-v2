import { afterEach, describe, expect, it, vi } from "vitest";
import type { FindingChallenge } from "../types";
import { fetchChallenges, groupChallengesByRef, submitChallenge } from "./challengeApi";

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

function challenge(overrides: Partial<FindingChallenge> = {}): FindingChallenge {
  return {
    id: "c1",
    layerKey: "revenue",
    findingRef: "causes[0]",
    findingTitle: "Pipeline stalls",
    challengerEmail: "owner@acme.test",
    challengeText: "This ignores seasonality.",
    status: "completed",
    outcome: "upheld",
    originalConfidence: 78,
    originalBasis: "modelled",
    revisedConfidence: null,
    revisedBasis: null,
    confounderNote: "Seasonality examined and ruled out.",
    reasoning: "The finding holds after re-examination.",
    error: null,
    provenanceContentHash: "sha256:abc123",
    isCurrentVersion: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fetchChallenges", () => {
  it("returns ready with the challenge list", async () => {
    const challenges = [challenge()];
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ challenges }) });
    expect(await fetchChallenges("t1")).toEqual({ state: "ready", challenges });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/challenges");
  });

  it("surfaces unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchChallenges("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchChallenges("t1")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchChallenges("t1")).toEqual({ state: "error" });
  });
});

describe("submitChallenge", () => {
  it("posts the finding ref and text and returns the recorded challenge", async () => {
    const recorded = challenge({ outcome: "revised", revisedConfidence: 61, revisedBasis: "modelled_user_informed" });
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ challenge: recorded }) });
    expect(await submitChallenge("t1", "revenue", "causes[0]", "This ignores seasonality.")).toEqual({
      ok: true,
      challenge: recorded,
    });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/layers/revenue/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingRef: "causes[0]", challengeText: "This ignores seasonality." }),
    });
  });

  it("returns ok with a failed-status row when the engine fails but HTTP succeeds", async () => {
    const failed = challenge({ status: "failed", outcome: null, reasoning: null, error: "model_unavailable" });
    mockFetch({ ok: true, status: 201, json: async () => ({ challenge: failed }) });
    expect(await submitChallenge("t1", "revenue", "causes[0]", "x")).toEqual({ ok: true, challenge: failed });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await submitChallenge("t1", "revenue", "causes[0]", "x")).toEqual({ unauthorized: true });
  });

  it("extracts the server error code on a forbidden seat", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    expect(await submitChallenge("t1", "revenue", "causes[0]", "x")).toEqual({ error: "forbidden" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await submitChallenge("t1", "revenue", "causes[0]", "x")).toEqual({ error: "failed" });
  });
});

describe("groupChallengesByRef", () => {
  it("groups by finding ref preserving input order within each ref", async () => {
    const a2 = challenge({ id: "a2", findingRef: "causes[0]", createdAt: "2026-01-03T00:00:00.000Z" });
    const a1 = challenge({ id: "a1", findingRef: "causes[0]", createdAt: "2026-01-02T00:00:00.000Z" });
    const b1 = challenge({ id: "b1", findingRef: "actions[1]" });
    const grouped = groupChallengesByRef([a2, a1, b1]);
    expect(grouped.get("causes[0]")?.map((c) => c.id)).toEqual(["a2", "a1"]);
    expect(grouped.get("actions[1]")?.map((c) => c.id)).toEqual(["b1"]);
    expect(grouped.size).toBe(2);
  });

  it("returns an empty map for an empty list", async () => {
    expect(groupChallengesByRef([]).size).toBe(0);
  });
});
