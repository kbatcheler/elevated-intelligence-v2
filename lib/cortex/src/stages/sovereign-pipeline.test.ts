// Sovereign mode (Phase AF): EVERY stage runs in-boundary on the local seat and
// the deployment makes ZERO external model calls anywhere. Proven with an injected
// ExtractionZoneRuntime plus hard-failing stubs on BOTH external clients, so any
// external call is a visible test failure rather than a silent fallback. No live
// model of any kind is used; the suite is fully hermetic.

import { describe, expect, it, vi, beforeEach } from "vitest";

// Both external seats are stubbed to a loud failure. The contract under test is
// that in sovereign mode neither is ever consulted; if one is, the spy assertion
// fails (and the stub's failure would also surface), never a quiet fallback. The
// spies are declared via vi.hoisted so they exist before the hoisted vi.mock
// factories reference them.
const { anthropicSpy, geminiSpy } = vi.hoisted(() => ({
  anthropicSpy: vi.fn(() =>
    Promise.resolve({
      ok: false as const,
      reason: "external Anthropic seat must never be called in sovereign mode",
      durationMs: 0,
    }),
  ),
  geminiSpy: vi.fn(() =>
    Promise.resolve({
      ok: false as const,
      reason: "external Gemini seat must never be called in sovereign mode",
      durationMs: 0,
    }),
  ),
}));
vi.mock("../clients/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../clients/anthropic")>();
  return { ...actual, callClaudeJson: anthropicSpy };
});
vi.mock("../clients/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../clients/gemini")>();
  return { ...actual, callGeminiJson: geminiSpy };
});

import {
  runProfile,
  runPerceive,
  runHypothesise,
  runConfound,
  runChallenge,
  runNarrate,
  runScore,
  runEnrichment,
  runFindingChallengeConfound,
  runFindingChallengeDecision,
} from "./runners";
import type { ExtractionRequest, ExtractionResult, ExtractionZoneRuntime, StageContext } from "./extractionZone";
import type { StageResult, StageTelemetry } from "./types";
import { silentLogger } from "../logger";
import type { LayerDescriptor } from "../prompts/shared";
import type { FindingChallengeInput } from "../prompts/findingChallenge";
import type { HomepageContext } from "../grounding/homepageContext";
import type { ProfileOutput } from "../schemas/profile";
import type {
  ChallengeOutput,
  ConfounderOutput,
  HypothesisedLayer,
  NarrateOutput,
  PerceiveOutput,
  ScoreOutput,
} from "../schemas/stages";
import type { FindingChallengeConfound } from "../schemas/findingChallenge";

const profile: ProfileOutput = {
  name: "Acme Industrial",
  url: "https://acme.example",
  sector: "Industrial Manufacturing",
  logoMonogram: "AC",
};

const layer: LayerDescriptor = {
  key: "demand",
  name: "Demand",
  description: "How demand is forming across the pipeline.",
  diagnosticQuestion: "Is demand strengthening or softening, and why?",
};

// The prior-stage objects are only JSON-serialised into later prompts, so minimal
// casts are sufficient to exercise the routing; the injected runtime returns a
// fixed value regardless of schema (the runtime, not the runner, owns parsing).
const homepage = { ok: false, errorReason: "test (no fetch in unit)" } as unknown as HomepageContext;
const perceiveValue = { signals: [], named_entities: [], sector_context: "" } as unknown as PerceiveOutput;
const hypothesisedValue = { content: {} } as unknown as HypothesisedLayer;
const confoundValue = { confounders: [] } as unknown as ConfounderOutput;
const challengeValue = { findings: [], alternative_hypotheses: [] } as unknown as ChallengeOutput;
const narrateValue = { content: {}, verified_claims: [], modelled_claims: [] } as unknown as NarrateOutput;
const scoreValue = { confidence: 0, confidence_gap: 0, gaps: [], claims: [] } as unknown as ScoreOutput;
const findingConfoundValue = { introduces_confounder: false, note: "" } as unknown as FindingChallengeConfound;
const findingDecisionValue = { outcome: "upheld", reasoning: "" } as unknown as Record<string, unknown>;

const challengeInput: FindingChallengeInput = {
  profile,
  layer,
  finding: { ref: "causes[0]", kind: "cause", title: "A cause", confidence: 50, basis: "modelled" },
  userChallenge: "I disagree.",
};

const LOCAL_MODEL = "local-boundary-model";

// A recording runtime: captures every in-boundary request and returns a fixed
// value, standing in for the local seat (and the future TEE runner).
function recordingRuntime<T>(value: T): ExtractionZoneRuntime & { calls: ExtractionRequest<unknown>[] } {
  const calls: ExtractionRequest<unknown>[] = [];
  return {
    model: LOCAL_MODEL,
    endpoint: "http://boundary.local/v1/chat/completions",
    calls,
    callJson<R>(req: ExtractionRequest<R>): Promise<ExtractionResult<R>> {
      calls.push(req as ExtractionRequest<unknown>);
      return Promise.resolve({ ok: true, value: value as unknown as R, durationMs: 3, model: LOCAL_MODEL, inputTokens: 5, outputTokens: 9 });
    },
  };
}

function sovereignCtx<T>(value: T): StageContext & { runtime: ReturnType<typeof recordingRuntime<T>> } {
  const runtime = recordingRuntime(value);
  return { dataMode: "sovereign", extractionRuntime: runtime, runtime };
}

// Every sovereign stage result carries the honesty markers and the real local
// model that ran, and no external seat was consulted for it.
function expectSovereignMarkers(telemetry: StageTelemetry): void {
  expect(telemetry.executionMode).toBe("sovereign");
  expect(telemetry.groundingAvailable).toBe(false);
  expect(telemetry.webSearchAvailable).toBe(false);
  expect(telemetry.model).toBe(LOCAL_MODEL);
}

function expectNoExternalCalls(): void {
  expect(anthropicSpy).not.toHaveBeenCalled();
  expect(geminiSpy).not.toHaveBeenCalled();
}

describe("sovereign mode routes every stage in-boundary with zero external calls", () => {
  beforeEach(() => {
    anthropicSpy.mockClear();
    geminiSpy.mockClear();
  });

  it("profile runs on the local seat (not the external reasoner)", async () => {
    const ctx = sovereignCtx(profile);
    const res = await runProfile("https://acme.example", homepage, silentLogger, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("perceive (Lens) runs on the local seat", async () => {
    const ctx = sovereignCtx(perceiveValue);
    const res = await runPerceive(profile, layer, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("hypothesise (Lens) runs on the local seat", async () => {
    const ctx = sovereignCtx(hypothesisedValue);
    const res = await runHypothesise(profile, layer, perceiveValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("confound (Confounder) runs on the local seat, never the external grounder", async () => {
    const ctx = sovereignCtx(confoundValue);
    const res = await runConfound(profile, layer, hypothesisedValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("challenge (Challenger) runs on the local seat, never the external grounder", async () => {
    const ctx = sovereignCtx(challengeValue);
    const res = await runChallenge(profile, layer, hypothesisedValue, confoundValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("narrate (Synthesist) runs on the local seat", async () => {
    const ctx = sovereignCtx(narrateValue);
    const res = await runNarrate(profile, layer, hypothesisedValue, confoundValue, challengeValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("score (Evaluator) runs on the local seat", async () => {
    const ctx = sovereignCtx(scoreValue);
    const res = await runScore(profile, layer, narrateValue, confoundValue, challengeValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("enrichment (hero/peers/supplements) runs on the local seat", async () => {
    const ctx = sovereignCtx({ hero: {}, peers: {}, supplements: {} });
    const res = await runEnrichment(profile, layer, narrateValue, silentLogger, undefined, ctx);
    expect(res.ok).toBe(true);
    expect(ctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(res.telemetry);
    expectNoExternalCalls();
  });

  it("interactive challenge (Confounder + Synthesist seats) runs on the local seat", async () => {
    const cctx = sovereignCtx(findingConfoundValue);
    const cres = await runFindingChallengeConfound(challengeInput, silentLogger, cctx);
    expect(cres.ok).toBe(true);
    expect(cctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(cres.telemetry);

    const dctx = sovereignCtx(findingDecisionValue);
    const dres = await runFindingChallengeDecision(challengeInput, findingConfoundValue, silentLogger, dctx);
    expect(dres.ok).toBe(true);
    expect(dctx.runtime.calls).toHaveLength(1);
    expectSovereignMarkers(dres.telemetry);

    expectNoExternalCalls();
  });
});

describe("sovereign mode fails loud, never silently external, when the local seat is unconfigured", () => {
  it("returns 'available, not connected' with no runtime and no env, with the sovereign markers", async () => {
    const prevBase = process.env["LOCAL_MODEL_BASE_URL"];
    const prevModel = process.env["LOCAL_MODEL_MODEL"];
    delete process.env["LOCAL_MODEL_BASE_URL"];
    delete process.env["LOCAL_MODEL_MODEL"];
    anthropicSpy.mockClear();
    geminiSpy.mockClear();
    try {
      const ctx: StageContext = { dataMode: "sovereign" };
      const res: StageResult<PerceiveOutput> = await runPerceive(profile, layer, silentLogger, undefined, ctx);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toContain("available, not connected");
      // Honest even in failure: the markers still record that this was a sovereign
      // run with no grounding, and no external seat was used as a fallback.
      expect(res.telemetry.executionMode).toBe("sovereign");
      expect(res.telemetry.groundingAvailable).toBe(false);
      expectNoExternalCalls();
    } finally {
      if (prevBase !== undefined) process.env["LOCAL_MODEL_BASE_URL"] = prevBase;
      if (prevModel !== undefined) process.env["LOCAL_MODEL_MODEL"] = prevModel;
    }
  });
});
