// Pure per-stage runner functions. Each builds its prompt, calls the right seat
// (model resolved from CORTEX config), validates the output, and returns the
// typed result with telemetry. No database, no persistence: the orchestrator
// owns those.

import { callClaudeJson, type SystemBlock } from "../clients/anthropic";
import { callGeminiJson } from "../clients/gemini";
import { modelForStage, STAGE_CONFIG, type StageName } from "../config";
import type { HomepageContext } from "../grounding/homepageContext";
import { silentLogger, type Logger } from "../logger";
import { buildProfileUser, PROFILE_SYSTEM_PROMPT } from "../prompts/profile";
import {
  buildChallenge,
  buildConfound,
  buildHero,
  buildHypothesise,
  buildNarrate,
  buildPeers,
  buildPerceive,
  buildScore,
  buildSupplements,
} from "../prompts/layerStages";
import type { LayerDescriptor } from "../prompts/shared";
import { profileSchema, type ProfileOutput } from "../schemas/profile";
import {
  challengeOutputSchema,
  confounderOutputSchema,
  heroPanelSchema,
  hypothesisedLayerSchema,
  narrateOutputSchema,
  peerBenchmarkSchema,
  perceiveOutputSchema,
  scoreOutputSchema,
  supplementBlocksSchema,
  type ChallengeOutput,
  type ConfounderOutput,
  type HeroPanel,
  type HypothesisedLayer,
  type NarrateOutput,
  type PeerBenchmark,
  type PerceiveOutput,
  type ScoreOutput,
  type SupplementBlocks,
} from "../schemas/stages";
import type { StageResult, StageTelemetry } from "./types";
import type { ZodType } from "zod/v4";

function buildTelemetry(
  stage: StageName,
  p: { durationMs: number; inputTokens?: number | null; outputTokens?: number | null; searchCallCount?: number },
): StageTelemetry {
  return {
    seat: STAGE_CONFIG[stage].role,
    model: modelForStage(stage),
    latencyMs: p.durationMs,
    ...(p.inputTokens != null ? { inputTokens: p.inputTokens } : {}),
    ...(p.outputTokens != null ? { outputTokens: p.outputTokens } : {}),
    ...(p.searchCallCount != null ? { searchCalls: p.searchCallCount } : {}),
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
  if (!res.ok) return { ok: false, reason: res.reason, telemetry: buildTelemetry(stage, { durationMs: res.durationMs }) };
  return { ok: true, output: res.value, telemetry: buildTelemetry(stage, res) };
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
  if (!res.ok) return { ok: false, reason: res.reason, telemetry: buildTelemetry(stage, { durationMs: res.durationMs }) };
  return { ok: true, output: res.value, telemetry: buildTelemetry(stage, res) };
}

// ── profile (tenant scope) ──────────────────────────────────────────────────
export async function runProfile(
  rawUrl: string,
  ctx: HomepageContext,
  log: Logger = silentLogger,
): Promise<StageResult<ProfileOutput>> {
  const res = await runAnthropicStage("profile", {
    system: [{ text: PROFILE_SYSTEM_PROMPT, cache: true }],
    user: buildProfileUser(rawUrl, ctx),
    schema: profileSchema,
    maxTokens: 4096,
    log,
  });
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
): Promise<StageResult<PerceiveOutput>> {
  const { system, user } = buildPerceive(profile, layer);
  return runAnthropicStage("perceive", { system, user, schema: perceiveOutputSchema, log });
}

export function runHypothesise(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  perceive: PerceiveOutput,
  log: Logger = silentLogger,
): Promise<StageResult<HypothesisedLayer>> {
  const { system, user } = buildHypothesise(profile, layer, perceive);
  return runAnthropicStage("hypothesise", { system, user, schema: hypothesisedLayerSchema, log });
}

export function runConfound(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  log: Logger = silentLogger,
): Promise<StageResult<ConfounderOutput>> {
  const { system, user } = buildConfound(profile, layer, hypothesised);
  return runGeminiStage("confound", { system, user, schema: confounderOutputSchema, log });
}

export function runChallenge(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
  log: Logger = silentLogger,
): Promise<StageResult<ChallengeOutput>> {
  const { system, user } = buildChallenge(profile, layer, hypothesised, confounders);
  return runGeminiStage("challenge", { system, user, schema: challengeOutputSchema, log });
}

export function runNarrate(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
  log: Logger = silentLogger,
): Promise<StageResult<NarrateOutput>> {
  const { system, user } = buildNarrate(profile, layer, hypothesised, confounders, challenge);
  return runAnthropicStage("narrate", { system, user, schema: narrateOutputSchema, log });
}

export function runScore(
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
  log: Logger = silentLogger,
): Promise<StageResult<ScoreOutput>> {
  const { system, user } = buildScore(layer, narrate, confounders, challenge);
  return runAnthropicStage("score", { system, user, schema: scoreOutputSchema, log });
}

export function runHero(
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  log: Logger = silentLogger,
): Promise<StageResult<HeroPanel>> {
  const { system, user } = buildHero(layer, narrate);
  return runAnthropicStage("hero", { system, user, schema: heroPanelSchema, log });
}

export function runPeers(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  log: Logger = silentLogger,
): Promise<StageResult<PeerBenchmark>> {
  const { system, user } = buildPeers(profile, layer, narrate);
  return runAnthropicStage("peers", { system, user, schema: peerBenchmarkSchema, log });
}

export function runSupplements(
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  log: Logger = silentLogger,
): Promise<StageResult<SupplementBlocks>> {
  const { system, user } = buildSupplements(layer, narrate);
  return runAnthropicStage("supplements", { system, user, schema: supplementBlocksSchema, log });
}
