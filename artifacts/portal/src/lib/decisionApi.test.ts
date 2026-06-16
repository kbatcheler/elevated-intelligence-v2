import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionTimeline, PreMortem, PreMortemIndicator } from "../types";
import {
  fetchDecisionTimeline,
  recordDecision,
  runPreMortem,
  setIndicatorStatus,
} from "./decisionApi";

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

function timeline(): DecisionTimeline {
  return {
    entries: [],
    summary: {
      totalDecisions: 0,
      commits: 0,
      defers: 0,
      rejects: 0,
      overruledRight: 0,
      overruledWrong: 0,
      overruledPending: 0,
      totalIdentifiedValueUsd: 0,
      totalRealizedValueUsd: 0,
    },
  };
}

function preMortem(overrides: Partial<PreMortem> = {}): PreMortem {
  return {
    id: "pm1",
    status: "completed",
    failureModes: [
      { rank: 1, title: "Adoption stalls", mechanism: "Users ignore it", likelihood: "medium", earlyWarning: "Low logins" },
    ],
    residualRiskNote: "Residual risk acceptable.",
    error: null,
    provenanceContentHash: "sha256:abc",
    indicators: [],
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function indicator(overrides: Partial<PreMortemIndicator> = {}): PreMortemIndicator {
  return {
    id: "ind1",
    failureModeRank: 1,
    failureModeTitle: "Adoption stalls",
    label: "Weekly active below 40%",
    status: "active",
    triggeredAt: null,
    clearedAt: null,
    ...overrides,
  };
}

describe("fetchDecisionTimeline", () => {
  it("returns ready with the timeline", async () => {
    const t = timeline();
    const fn = mockFetch({ ok: true, status: 200, json: async () => t });
    expect(await fetchDecisionTimeline("t1")).toEqual({ state: "ready", timeline: t });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/decisions/timeline");
  });

  it("surfaces unauthorized on a 401 so the caller can log out", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await fetchDecisionTimeline("t1")).toEqual({ unauthorized: true });
  });

  it("returns error on a non-ok status", async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await fetchDecisionTimeline("t1")).toEqual({ state: "error" });
  });

  it("returns error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await fetchDecisionTimeline("t1")).toEqual({ state: "error" });
  });
});

describe("recordDecision", () => {
  it("posts the defer or reject and returns ok", async () => {
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ decisionRecord: { id: "d1" } }) });
    expect(
      await recordDecision("t1", { layerKey: "revenue", actionRef: "actions[0]", decision: "defer", rationale: "Wait a quarter." }),
    ).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layerKey: "revenue", actionRef: "actions[0]", decision: "defer", rationale: "Wait a quarter." }),
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(
      await recordDecision("t1", { layerKey: "revenue", actionRef: "actions[0]", decision: "reject", rationale: "No." }),
    ).toEqual({ unauthorized: true });
  });

  it("extracts the server error code on a non-action ref", async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ error: "not_an_action" }) });
    expect(
      await recordDecision("t1", { layerKey: "revenue", actionRef: "causes[0]", decision: "reject", rationale: "No." }),
    ).toEqual({ error: "not_an_action" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(
      await recordDecision("t1", { layerKey: "revenue", actionRef: "actions[0]", decision: "defer", rationale: "x" }),
    ).toEqual({ error: "failed" });
  });
});

describe("runPreMortem", () => {
  it("posts and returns the recorded pre-mortem", async () => {
    const pm = preMortem();
    const fn = mockFetch({ ok: true, status: 201, json: async () => ({ preMortem: pm }) });
    expect(await runPreMortem("t1", "d1")).toEqual({ ok: true, preMortem: pm });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/decisions/d1/pre-mortem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("returns ok with a failed-status pre-mortem when the model fails but HTTP succeeds", async () => {
    const failed = preMortem({ status: "failed", failureModes: [], residualRiskNote: null, error: "model_unavailable" });
    mockFetch({ ok: true, status: 201, json: async () => ({ preMortem: failed }) });
    expect(await runPreMortem("t1", "d1")).toEqual({ ok: true, preMortem: failed });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await runPreMortem("t1", "d1")).toEqual({ unauthorized: true });
  });

  it("extracts the server error code when the decision is gone", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "decision_not_found" }) });
    expect(await runPreMortem("t1", "d1")).toEqual({ error: "decision_not_found" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await runPreMortem("t1", "d1")).toEqual({ error: "failed" });
  });
});

describe("setIndicatorStatus", () => {
  it("posts the observed status and returns the updated indicator", async () => {
    const updated = indicator({ status: "triggered", triggeredAt: "2026-02-02T00:00:00.000Z" });
    const fn = mockFetch({ ok: true, status: 200, json: async () => ({ indicator: updated }) });
    expect(await setIndicatorStatus("t1", "ind1", "triggered")).toEqual({ ok: true, indicator: updated });
    expect(fn).toHaveBeenCalledWith("/api/tenants/t1/pre-mortem-indicators/ind1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "triggered" }),
    });
  });

  it("surfaces unauthorized on a 401", async () => {
    mockFetch({ ok: false, status: 401 });
    expect(await setIndicatorStatus("t1", "ind1", "cleared")).toEqual({ unauthorized: true });
  });

  it("extracts the server error code when the indicator is gone", async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    expect(await setIndicatorStatus("t1", "ind1", "active")).toEqual({ error: "not_found" });
  });

  it("returns a generic error when fetch throws", async () => {
    mockFetch(new Error("network"));
    expect(await setIndicatorStatus("t1", "ind1", "triggered")).toEqual({ error: "failed" });
  });
});
