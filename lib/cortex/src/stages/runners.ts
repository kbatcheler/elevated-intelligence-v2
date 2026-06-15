// Pure per-stage runner functions. Each builds its prompt, calls the right seat
// (model resolved from CORTEX config), validates the output, and returns the
// typed result with telemetry. No database, no persistence: the orchestrator
// owns those.

import { callClaudeJson, type SystemBlock } from "../clients/anthropic";
import { callGeminiJson } from "../clients/gemini";
import { getExtractionRuntime } from "../clients/local";
import { modelForStage, runsOnLocal, STAGE_CONFIG, type StageName } from "../config";
import type { HomepageContext } from "../grounding/homepageContext";
import { DEFAULT_STAGE_CONTEXT, type StageContext } from "./extractionZone";
import { silentLogger, type Logger } from "../logger";
import { buildProfileUser, PROFILE_SYSTEM_PROMPT } from "../prompts/profile";
import {
  buildChallenge,
  buildConfound,
  buildEnrichment,
  buildHypothesise,
  buildNarrate,
  buildPerceive,
  buildScore,
} from "../prompts/layerStages";
import {
  buildFindingChallengeConfound,
  buildFindingChallengeDecision,
  type FindingChallengeInput,
} from "../prompts/findingChallenge";
import type { LayerDescriptor, LayerGrounding } from "../prompts/shared";
import { profileSchema, type ProfileOutput } from "../schemas/profile";
import {
  challengeOutputSchema,
  confounderOutputSchema,
  enrichmentOutputSchema,
  hypothesisedLayerSchema,
  narrateOutputSchema,
  perceiveOutputSchema,
  scoreOutputSchema,
  type ChallengeOutput,
  type ConfounderOutput,
  type EnrichmentOutput,
  type HypothesisedLayer,
  type NarrateOutput,
  type PerceiveOutput,
  type ScoreOutput,
} from "../schemas/stages";
import {
  findingChallengeConfoundSchema,
  findingChallengeDecisionSchema,
  type FindingChallengeConfound,
  type FindingChallengeDecision,
} from "../schemas/findingChallenge";
import type { StageResult, StageTelemetry } from "./types";
import type { ZodType } from "zod/v4";

function buildTelemetry(
  stage: StageName,
  p: {
    durationMs: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheCreationTokens?: number | null;
    searchCallCount?: number;
    // True only when a real, token-billed provider response was received. Left
    // false (the default) for a no-call failure so the ledger never costs it.
    billed?: boolean;
    // Phase AF sovereign-mode honesty markers. Set ONLY on a sovereign stage (by
    // runLocalStage), spread conditionally so outside_in and connected telemetry
    // payloads are byte-for-byte unchanged.
    executionMode?: "sovereign";
    groundingAvailable?: boolean;
    webSearchAvailable?: boolean;
  },
  // The model that actually ran. The external seats resolve it from config; the
  // in-boundary Lens passes its env-supplied local model so telemetry honestly
  // records which model interpreted the signals.
  modelOverride?: string,
): StageTelemetry {
  return {
    seat: STAGE_CONFIG[stage].role,
    model: modelOverride ?? modelForStage(stage),
    latencyMs: p.durationMs,
    billed: p.billed === true,
    ...(p.inputTokens != null ? { inputTokens: p.inputTokens } : {}),
    ...(p.outputTokens != null ? { outputTokens: p.outputTokens } : {}),
    ...(p.cacheReadTokens != null ? { cacheReadTokens: p.cacheReadTokens } : {}),
    ...(p.cacheCreationTokens != null ? { cacheCreationTokens: p.cacheCreationTokens } : {}),
    ...(p.searchCallCount != null ? { searchCalls: p.searchCallCount } : {}),
    ...(p.executionMode != null ? { executionMode: p.executionMode } : {}),
    ...(p.groundingAvailable != null ? { groundingAvailable: p.groundingAvailable } : {}),
    ...(p.webSearchAvailable != null ? { webSearchAvailable: p.webSearchAvailable } : {}),
  };
}

async function runAnthropicStage<T>(
  stage: StageName,
  args: { system: string | SystemBlock[]; user: string; schema: ZodType<T>; maxTokens?: number; log: Logger },
): Promise<StageResult<T>> {
  const res = await callClaudeJson<T>({
    model: modelForStage(stage),
    system: args.system,
    user: args.user,
    schema: args.schema,
    maxTokens: args.maxTokens,
    useWebSearch: STAGE_CONFIG[stage].webSearch ?? false,
    log: args.log,
    context: stage,
  });
  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      telemetry: buildTelemetry(stage, {
        durationMs: res.durationMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        cacheReadTokens: res.cacheReadTokens,
        cacheCreationTokens: res.cacheCreationTokens,
        searchCallCount: res.searchCallCount,
        billed: res.billed,
      }),
    };
  }
  return {
    ok: true,
    output: res.value,
    telemetry: buildTelemetry(stage, {
      durationMs: res.durationMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      cacheReadTokens: res.cacheReadTokens,
      cacheCreationTokens: res.cacheCreationTokens,
      searchCallCount: res.searchCallCount,
      billed: true,
    }),
  };
}

async function runGeminiStage<T>(
  stage: StageName,
  args: { system: string; user: string; schema: ZodType<T>; maxTokens?: number; log: Logger },
): Promise<StageResult<T>> {
  const res = await callGeminiJson<T>({
    model: modelForStage(stage),
    systemPrompt: args.system,
    userPrompt: args.user,
    schema: args.schema,
    maxTokens: args.maxTokens,
    useGrounding: STAGE_CONFIG[stage].grounding ?? false,
    log: args.log,
    context: stage,
  });
  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      telemetry: buildTelemetry(stage, {
        durationMs: res.durationMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        searchCallCount: res.searchCallCount,
        billed: res.billed,
      }),
    };
  }
  return {
    ok: true,
    output: res.value,
    telemetry: buildTelemetry(stage, {
      durationMs: res.durationMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      searchCallCount: res.searchCallCount,
      billed: true,
    }),
  };
}

// The honest unconfigured state: connected mode routes the Lens here, but no
// in-boundary model is configured, so the run fails loudly rather than leaking
// the sensitive stage to an external provider.
const LOCAL_SEAT_UNCONFIGURED =
  "local extraction seat available, not connected: set LOCAL_MODEL_BASE_URL and LOCAL_MODEL_MODEL to run the Lens in-boundary";

// Run a Lens stage in-boundary (Tier 2, the split pipeline). Uses the injected
// runtime when present (tests and the future TEE runner), otherwise the
// configured local runtime. There is no web search: the in-boundary Lens grounds
// on the client's own derived signals, not the public web.
async function runLocalStage<T>(
  stage: StageName,
  ctx: StageContext,
  args: { system: string | SystemBlock[]; user: string; schema: ZodType<T>; maxTokens?: number; log: Logger },
): Promise<StageResult<T>> {
  // Sovereign-only honesty markers: the whole run is in-boundary, so no external
  // grounding or web-search verification channel was available. Connected
  // in-boundary Lens stages carry no marker (their run still has the external
  // adversarial seats), so the connected path stays byte-for-byte unchanged.
  const marker =
    ctx.dataMode === "sovereign"
      ? { executionMode: "sovereign" as const, groundingAvailable: false, webSearchAvailable: false }
      : {};
  const runtime = ctx.extractionRuntime ?? getExtractionRuntime();
  if (!runtime) {
    return {
      ok: false,
      reason: LOCAL_SEAT_UNCONFIGURED,
      telemetry: buildTelemetry(stage, { durationMs: 0, ...marker }, "local: not connected"),
    };
  }
  // The in-boundary adapter takes a single system string; flatten any cached
  // system blocks (provider-specific cache markers do not apply locally).
  const system = typeof args.system === "string" ? args.system : args.system.map((b) => b.text).join("\n\n");
  const res = await runtime.callJson<T>({
    system,
    user: args.user,
    schema: args.schema,
    maxTokens: args.maxTokens,
    log: args.log,
    context: stage,
  });
  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      telemetry: buildTelemetry(
        stage,
        {
          durationMs: res.durationMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          billed: res.billed,
          ...marker,
        },
        runtime.model,
      ),
    };
  }
  return {
    ok: true,
    output: res.value,
    telemetry: buildTelemetry(
      stage,
      {
        durationMs: res.durationMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        billed: true,
        ...marker,
      },
      runtime.model,
    ),
  };
}

// ── profile (tenant scope) ──────────────────────────────────────────────────
export async function runProfile(
  rawUrl: string,
  ctx: HomepageContext,
  log: Logger = silentLogger,
  // outside_in (the default) keeps the profile on the external reasoner. Sovereign
  // routes it in-boundary onto the local seat, with the rest of the pipeline.
  stageCtx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<ProfileOutput>> {
  const args = {
    system: [{ text: PROFILE_SYSTEM_PROMPT, cache: true }],
    user: buildProfileUser(rawUrl, ctx),
    schema: profileSchema,
    maxTokens: 4096,
    log,
  };
  const res = runsOnLocal("profile", stageCtx.dataMode)
    ? await runLocalStage("profile", stageCtx, args)
    : await runAnthropicStage("profile", args);
  // The URL is authoritative input, never a model guess: inject the canonical
  // (post-redirect) URL we fetched, falling back to the raw seed URL.
  if (res.ok) res.output.url = ctx.ok ? ctx.finalUrl : rawUrl;
  return res;
}

// ── per-layer stages ─────────────────────────────────────────────────────────
export function runPerceive(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  // outside_in (the default) keeps the Lens on the external reasoner, unchanged.
  // connected routes it in-boundary onto the local seat.
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<PerceiveOutput>> {
  const { system, user } = buildPerceive(profile, layer, grounding);
  if (runsOnLocal("perceive", ctx.dataMode)) {
    return runLocalStage("perceive", ctx, { system, user, schema: perceiveOutputSchema, log });
  }
  return runAnthropicStage("perceive", { system, user, schema: perceiveOutputSchema, log });
}

export function runHypothesise(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  perceive: PerceiveOutput,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<HypothesisedLayer>> {
  const { system, user } = buildHypothesise(profile, layer, perceive, grounding);
  if (runsOnLocal("hypothesise", ctx.dataMode)) {
    return runLocalStage("hypothesise", ctx, { system, user, schema: hypothesisedLayerSchema, log });
  }
  return runAnthropicStage("hypothesise", { system, user, schema: hypothesisedLayerSchema, log });
}

export function runConfound(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  // Sovereign routes the Confounder in-boundary too, with its Google Search
  // grounding dropped (honest, never a faked search); outside_in and connected
  // keep it on the external grounder seat exactly as before.
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<ConfounderOutput>> {
  const { system, user } = buildConfound(profile, layer, hypothesised, grounding);
  if (runsOnLocal("confound", ctx.dataMode)) {
    return runLocalStage("confound", ctx, { system, user, schema: confounderOutputSchema, log });
  }
  return runGeminiStage("confound", { system, user, schema: confounderOutputSchema, log });
}

export function runChallenge(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<ChallengeOutput>> {
  const { system, user } = buildChallenge(profile, layer, hypothesised, confounders, grounding);
  if (runsOnLocal("challenge", ctx.dataMode)) {
    return runLocalStage("challenge", ctx, { system, user, schema: challengeOutputSchema, log });
  }
  return runGeminiStage("challenge", { system, user, schema: challengeOutputSchema, log });
}

export function runNarrate(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<NarrateOutput>> {
  const { system, user } = buildNarrate(profile, layer, hypothesised, confounders, challenge, grounding);
  if (runsOnLocal("narrate", ctx.dataMode)) {
    return runLocalStage("narrate", ctx, { system, user, schema: narrateOutputSchema, log });
  }
  return runAnthropicStage("narrate", { system, user, schema: narrateOutputSchema, log });
}

// Interactive Challenge (Phase AA). A challenge re-reasons ONE finding via two
// dedicated, finding-scoped calls that reuse the Confounder and Synthesist seats
// (so telemetry and cost record exactly as a layer build does) without rebuilding
// the whole layer. The Confounder (Gemini, grounded) re-tests whether the user's
// objection introduces a confounder.
export function runFindingChallengeConfound(
  input: FindingChallengeInput,
  log: Logger = silentLogger,
  // Sovereign routes the interactive challenge's Confounder in-boundary too, so a
  // sovereign deployment makes no external call anywhere. outside_in and connected
  // keep it on the external grounder seat exactly as before.
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<FindingChallengeConfound>> {
  const { system, user } = buildFindingChallengeConfound(input);
  if (runsOnLocal("confound", ctx.dataMode)) {
    return runLocalStage("confound", ctx, { system, user, schema: findingChallengeConfoundSchema, log });
  }
  return runGeminiStage("confound", { system, user, schema: findingChallengeConfoundSchema, log });
}

// The Synthesist (Claude) decides uphold-or-revise for the single finding,
// folding in the Confounder's re-examination. The user's input is context, never
// an override; the finding can never be deleted.
export function runFindingChallengeDecision(
  input: FindingChallengeInput,
  confound: FindingChallengeConfound,
  log: Logger = silentLogger,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<FindingChallengeDecision>> {
  const { system, user } = buildFindingChallengeDecision(input, confound);
  if (runsOnLocal("narrate", ctx.dataMode)) {
    return runLocalStage("narrate", ctx, { system, user, schema: findingChallengeDecisionSchema, log });
  }
  return runAnthropicStage("narrate", { system, user, schema: findingChallengeDecisionSchema, log });
}

export function runScore(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<ScoreOutput>> {
  const { system, user } = buildScore(profile, layer, narrate, confounders, challenge, grounding);
  if (runsOnLocal("score", ctx.dataMode)) {
    return runLocalStage("score", ctx, { system, user, schema: scoreOutputSchema, log });
  }
  return runAnthropicStage("score", { system, user, schema: scoreOutputSchema, log });
}

// The three Enrichment artefacts (hero, peers, supplements) share the Evaluator
// seat and the same inputs, so they run as ONE Haiku call. The representative
// stage is "hero": modelForStage and the cached prefix are identical for all
// three. The orchestrator splits the composite output into three persisted
// sub-stage records and records cost once (see executeEnrichment).
export function runEnrichment(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  log: Logger = silentLogger,
  grounding?: LayerGrounding,
  ctx: StageContext = DEFAULT_STAGE_CONTEXT,
): Promise<StageResult<EnrichmentOutput>> {
  const { system, user } = buildEnrichment(profile, layer, narrate, grounding);
  if (runsOnLocal("hero", ctx.dataMode)) {
    return runLocalStage("hero", ctx, { system, user, schema: enrichmentOutputSchema, log });
  }
  return runAnthropicStage("hero", { system, user, schema: enrichmentOutputSchema, log });
}
