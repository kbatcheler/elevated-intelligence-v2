// Phase AJ: the Evaluator elicits binary-resolvable forecasts as part of its
// score output. This proves an INJECTED Evaluator running in-boundary on the
// local seat returns the forecasts field intact, so a sovereign deployment
// produces a real per-seat forecast ledger with ZERO external model calls. The
// external seats are stubbed to a loud failure so any external call is a visible
// test failure, never a quiet fallback. Persistence of these forecasts is
// covered by the calibration integration path; this pins the elicitation half.

import { describe, expect, it, vi } from "vitest";

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

import { runScore } from "./runners";
import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionZoneRuntime,
  StageContext,
} from "./extractionZone";
import { silentLogger } from "../logger";
import type { LayerDescriptor } from "../prompts/shared";
import type { ProfileOutput } from "../schemas/profile";
import type {
  ChallengeOutput,
  ConfounderOutput,
  NarrateOutput,
  ScoreOutput,
} from "../schemas/stages";

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

// The prior-stage objects are only JSON-serialised into the Evaluator prompt, so
// minimal casts are sufficient; the injected runtime returns a fixed value.
const narrateValue = { content: {}, verified_claims: [], modelled_claims: [] } as unknown as NarrateOutput;
const confoundValue = { confounders: [] } as unknown as ConfounderOutput;
const challengeValue = { findings: [], alternative_hypotheses: [] } as unknown as ChallengeOutput;

// A schema-valid score output carrying one genuine, binary-resolvable forecast.
const scoreWithForecasts: ScoreOutput = {
  confidence: 62,
  confidence_gap: 18,
  gaps: [],
  claims: [],
  forecasts: [
    {
      kind: "action_outcome",
      subject_seat: "Evaluator",
      source_path: "actions[0]",
      statement: "Staged dunning lifts recovered renewals measurably within the quarter.",
      probability: 0.6,
      horizon_days: 90,
    },
  ],
};

const LOCAL_MODEL = "local-boundary-model";

function recordingRuntime<T>(
  value: T,
): ExtractionZoneRuntime & { calls: ExtractionRequest<unknown>[] } {
  const calls: ExtractionRequest<unknown>[] = [];
  return {
    model: LOCAL_MODEL,
    endpoint: "http://boundary.local/v1/chat/completions",
    calls,
    callJson<R>(req: ExtractionRequest<R>): Promise<ExtractionResult<R>> {
      calls.push(req as ExtractionRequest<unknown>);
      return Promise.resolve({
        ok: true,
        value: value as unknown as R,
        durationMs: 3,
        model: LOCAL_MODEL,
        inputTokens: 5,
        outputTokens: 9,
      });
    },
  };
}

describe("injected Evaluator emits forecasts in-boundary (Phase AJ)", () => {
  it("returns the forecasts the Evaluator elicited on the local seat, no external call", async () => {
    const runtime = recordingRuntime(scoreWithForecasts);
    const ctx: StageContext = { dataMode: "sovereign", extractionRuntime: runtime };

    const res = await runScore(
      profile,
      layer,
      narrateValue,
      confoundValue,
      challengeValue,
      silentLogger,
      undefined,
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.telemetry.executionMode).toBe("sovereign");
    expect(res.telemetry.model).toBe(LOCAL_MODEL);
    expect(runtime.calls).toHaveLength(1);

    const forecasts = res.output.forecasts;
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0]?.kind).toBe("action_outcome");
    expect(forecasts[0]?.probability).toBe(0.6);
    expect(forecasts[0]?.horizon_days).toBe(90);

    // The external seats were stubbed to fail loudly; neither was consulted.
    expect(anthropicSpy).not.toHaveBeenCalled();
    expect(geminiSpy).not.toHaveBeenCalled();
  });
});
