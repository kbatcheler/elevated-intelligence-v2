// The Phase C orchestrator. The cortex is pure (no database); this module owns
// every side effect: it fetches grounding, runs the profile stage to fill the
// tenant shell, fans out across the registry layers with bounded concurrency,
// drives the nine sub-stages per layer in order, and persists per-stage output
// and per-seat telemetry after every stage. It is resumable: a fully built
// layer is skipped, and a partially built layer continues from its first
// unfinished sub-stage using the persisted upstream outputs.
//
// There are no stubs and no silent fallbacks. A stage that fails to produce
// valid output records the error and aborts that layer loudly.

import { and, asc, eq } from "drizzle-orm";
import pLimit from "p-limit";
import {
  assembleLayerContent,
  fetchHomepageContext,
  LAYER_STAGES,
  modelForStage,
  runChallenge,
  runConfound,
  runHero,
  runHypothesise,
  runNarrate,
  runPeers,
  runPerceive,
  runProfile,
  runScore,
  runSupplements,
  type ChallengeOutput,
  type ConfounderOutput,
  type HeroPanel,
  type HypothesisedLayer,
  type LayerDescriptor,
  type NarrateOutput,
  type PeerBenchmark,
  type PerceiveOutput,
  type Logger,
  type ProfileOutput,
  type ScoreOutput,
  type StageResult,
  type SupplementBlocks,
} from "@workspace/cortex";
import {
  db,
  layersTable,
  PIPELINE_SUB_STAGES,
  tenantLayersTable,
  tenantPipelineRunsTable,
  tenantProfileTable,
  tenantsTable,
  type PipelineSubStage,
  type PipelineSubStageName,
} from "@workspace/db";

const LAYER_CONCURRENCY = 4;

export interface SeedOptions {
  log: Logger;
  // When false, an already-built layer is rebuilt instead of skipped. Defaults
  // to true (resume).
  resume?: boolean;
}

export interface LayerOutcome {
  layerKey: string;
  status: "built" | "skipped" | "error";
  reason?: string;
  telemetry: Array<{ stage: PipelineSubStageName; seat?: string; model?: string; latencyMs?: number; searchCalls?: number }>;
}

export interface SeedResult {
  tenantId: string;
  name: string;
  url: string;
  profileTelemetry: { seat?: string; model?: string; latencyMs?: number; searchCalls?: number };
  layers: LayerOutcome[];
}

class StageError extends Error {
  constructor(
    public stage: PipelineSubStageName,
    reason: string,
  ) {
    super(reason);
    this.name = "StageError";
  }
}

// ── tenant shell ─────────────────────────────────────────────────────────────
async function ensureTenant(rawUrl: string, profile: ProfileOutput): Promise<string> {
  const existing = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.url, rawUrl))
    .limit(1);

  const scalars = {
    name: profile.name,
    sector: profile.sector ?? null,
    hqCity: profile.hqCity ?? null,
    hqState: profile.hqState ?? null,
    revenueBand: profile.revenueBand ?? null,
    ownership: profile.ownership ?? null,
    founded: profile.founded ?? null,
    tagline: profile.tagline ?? null,
    status: "seeding" as const,
  };

  let tenantId: string;
  if (existing[0]) {
    tenantId = existing[0].id;
    await db.update(tenantsTable).set(scalars).where(eq(tenantsTable.id, tenantId));
  } else {
    const inserted = await db
      .insert(tenantsTable)
      .values({ url: rawUrl, ...scalars })
      .returning({ id: tenantsTable.id });
    tenantId = inserted[0]!.id;
  }

  await db
    .insert(tenantProfileTable)
    .values({ tenantId, profile })
    .onConflictDoUpdate({ target: tenantProfileTable.tenantId, set: { profile } });

  return tenantId;
}

// ── pipeline run row (resumable) ─────────────────────────────────────────────
function freshSubStages(): PipelineSubStage[] {
  return PIPELINE_SUB_STAGES.map((name) => ({ name, status: "pending" as const }));
}

// Guarantee every canonical sub-stage is present and in canonical order while
// preserving any already-completed state from a prior run.
function normalizeSubStages(prior: PipelineSubStage[]): PipelineSubStage[] {
  const byName = new Map(prior.map((s) => [s.name, s]));
  return PIPELINE_SUB_STAGES.map((name) => byName.get(name) ?? { name, status: "pending" as const });
}

interface RunCtx {
  runId: string;
  tenantId: string;
  layerKey: string;
  subStages: PipelineSubStage[];
}

async function ensureRun(tenantId: string, layerKey: string, resume: boolean): Promise<RunCtx> {
  const existing = await db
    .select()
    .from(tenantPipelineRunsTable)
    .where(and(eq(tenantPipelineRunsTable.tenantId, tenantId), eq(tenantPipelineRunsTable.layerKey, layerKey)))
    .limit(1);

  if (existing[0]) {
    const subStages = resume ? normalizeSubStages(existing[0].subStages) : freshSubStages();
    await db
      .update(tenantPipelineRunsTable)
      .set({ status: "running", error: null, finishedAt: null, subStages })
      .where(eq(tenantPipelineRunsTable.id, existing[0].id));
    return { runId: existing[0].id, tenantId, layerKey, subStages };
  }

  const subStages = freshSubStages();
  const inserted = await db
    .insert(tenantPipelineRunsTable)
    .values({ tenantId, layerKey, status: "running", subStages })
    .returning({ id: tenantPipelineRunsTable.id });
  return { runId: inserted[0]!.id, tenantId, layerKey, subStages };
}

async function persistSubStages(ctx: RunCtx): Promise<void> {
  await db
    .update(tenantPipelineRunsTable)
    .set({ subStages: ctx.subStages })
    .where(eq(tenantPipelineRunsTable.id, ctx.runId));
}

// Run (or resume) one sub-stage. On resume, returns the persisted output.
async function executeStage<T>(
  ctx: RunCtx,
  stage: PipelineSubStageName,
  run: () => Promise<StageResult<T>>,
): Promise<T> {
  const node = ctx.subStages.find((s) => s.name === stage);
  if (!node) throw new Error(`unknown sub-stage ${stage}`);

  if (node.status === "done" && node.output !== undefined) {
    return node.output as T;
  }

  node.status = "running";
  node.error = undefined;
  await persistSubStages(ctx);

  const result = await run();
  node.telemetry = result.telemetry;
  node.durationMs = result.telemetry.latencyMs;
  if (!result.ok) {
    node.status = "error";
    node.error = result.reason;
    await persistSubStages(ctx);
    throw new StageError(stage, result.reason);
  }
  node.status = "done";
  node.output = result.output;
  await persistSubStages(ctx);
  return result.output;
}

// ── one layer: nine sub-stages, then persist tenant_layers ───────────────────
async function runLayer(
  tenantId: string,
  profile: ProfileOutput,
  layer: LayerDescriptor,
  opts: SeedOptions,
): Promise<LayerOutcome> {
  const resume = opts.resume !== false;

  if (resume) {
    const built = await db
      .select({ id: tenantLayersTable.id })
      .from(tenantLayersTable)
      .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layer.key)))
      .limit(1);
    if (built[0]) {
      return { layerKey: layer.key, status: "skipped", telemetry: [] };
    }
  }

  const ctx = await ensureRun(tenantId, layer.key, resume);
  const log = opts.log;

  try {
    const perceive = await executeStage<PerceiveOutput>(ctx, "perceive", () => runPerceive(profile, layer, log));
    const hypothesise = await executeStage<HypothesisedLayer>(ctx, "hypothesise", () =>
      runHypothesise(profile, layer, perceive, log),
    );
    const confound = await executeStage<ConfounderOutput>(ctx, "confound", () =>
      runConfound(profile, layer, hypothesise, log),
    );
    const challenge = await executeStage<ChallengeOutput>(ctx, "challenge", () =>
      runChallenge(profile, layer, hypothesise, confound, log),
    );
    const narrate = await executeStage<NarrateOutput>(ctx, "narrate", () =>
      runNarrate(profile, layer, hypothesise, confound, challenge, log),
    );
    const score = await executeStage<ScoreOutput>(ctx, "score", () =>
      runScore(layer, narrate, confound, challenge, log),
    );
    const hero = await executeStage<HeroPanel>(ctx, "hero", () => runHero(layer, narrate, log));
    const peers = await executeStage<PeerBenchmark>(ctx, "peers", () => runPeers(profile, layer, narrate, log));
    const supplements = await executeStage<SupplementBlocks>(ctx, "supplements", () =>
      runSupplements(layer, narrate, log),
    );

    // The Evaluator (score) is the single writer of confidence and basis; the
    // assembler copies its numbers onto the Synthesist's content.
    const assembled = assembleLayerContent(narrate, score);
    if (!assembled.ok) {
      throw new StageError("score", assembled.reason);
    }

    const row = {
      content: assembled.content as unknown as Record<string, unknown>,
      heroPanel: hero as unknown as Record<string, unknown>,
      peerBenchmark: peers as unknown as Record<string, unknown>,
      supplementBlocks: supplements as unknown as Record<string, unknown>,
      confounders: confound.confounders as unknown as unknown[],
      verifiedClaims: { items: narrate.verified_claims } as Record<string, unknown>,
      modelledClaims: { items: narrate.modelled_claims } as Record<string, unknown>,
      generatorModel: modelForStage("narrate"),
    };

    await db
      .insert(tenantLayersTable)
      .values({ tenantId, layerKey: layer.key, ...row })
      .onConflictDoUpdate({
        target: [tenantLayersTable.tenantId, tenantLayersTable.layerKey],
        set: { ...row, generatedAt: new Date() },
      });

    await db
      .update(tenantPipelineRunsTable)
      .set({ status: "done", finishedAt: new Date(), error: null })
      .where(eq(tenantPipelineRunsTable.id, ctx.runId));

    return {
      layerKey: layer.key,
      status: "built",
      telemetry: ctx.subStages.map((s) => ({
        stage: s.name,
        seat: s.telemetry?.seat,
        model: s.telemetry?.model,
        latencyMs: s.telemetry?.latencyMs,
        searchCalls: s.telemetry?.searchCalls,
      })),
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await db
      .update(tenantPipelineRunsTable)
      .set({ status: "error", finishedAt: new Date(), error: reason })
      .where(eq(tenantPipelineRunsTable.id, ctx.runId));
    log.error({ tenantId, layerKey: layer.key, reason }, "layer run failed");
    return {
      layerKey: layer.key,
      status: "error",
      reason,
      telemetry: ctx.subStages.map((s) => ({
        stage: s.name,
        seat: s.telemetry?.seat,
        model: s.telemetry?.model,
        latencyMs: s.telemetry?.latencyMs,
        searchCalls: s.telemetry?.searchCalls,
      })),
    };
  }
}

async function loadRegistry(): Promise<LayerDescriptor[]> {
  const rows = await db
    .select({
      key: layersTable.key,
      name: layersTable.name,
      description: layersTable.description,
      diagnosticQuestion: layersTable.diagnosticQuestion,
    })
    .from(layersTable)
    .orderBy(asc(layersTable.sortOrder));
  return rows;
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function seedTenant(rawUrl: string, opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log;

  log.info({ url: rawUrl }, "seed: fetching homepage ground truth");
  const homepage = await fetchHomepageContext(rawUrl, log);

  log.info({ url: rawUrl, grounded: homepage.ok }, "seed: running profile stage");
  const profileResult = await runProfile(rawUrl, homepage, log);
  if (!profileResult.ok) {
    throw new Error(`profile stage failed: ${profileResult.reason}`);
  }
  const profile = profileResult.output;

  const tenantId = await ensureTenant(rawUrl, profile);
  log.info({ tenantId, name: profile.name }, "seed: tenant shell ready");

  const registry = await loadRegistry();
  if (registry.length === 0) {
    throw new Error("layer registry is empty; seed the registry before seeding a tenant");
  }
  log.info({ tenantId, layers: registry.length }, "seed: fanning out across layers");

  const limit = pLimit(LAYER_CONCURRENCY);
  const outcomes = await Promise.all(registry.map((layer) => limit(() => runLayer(tenantId, profile, layer, opts))));

  const anyError = outcomes.some((o) => o.status === "error");
  await db
    .update(tenantsTable)
    .set({
      status: anyError ? "failed" : "ready",
      lastSeededAt: new Date(),
    })
    .where(eq(tenantsTable.id, tenantId));

  return {
    tenantId,
    name: profile.name,
    url: rawUrl,
    profileTelemetry: {
      seat: profileResult.telemetry.seat,
      model: profileResult.telemetry.model,
      latencyMs: profileResult.telemetry.latencyMs,
      searchCalls: profileResult.telemetry.searchCalls,
    },
    layers: outcomes,
  };
}
