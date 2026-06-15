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

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  assembleLayerContent,
  deepStripDashes,
  evaluateNarrativeVoice,
  fetchHomepageContext,
  sovereignNoFetchHomepageContext,
  LAYER_STAGES,
  applySovereignNarrateCalibration,
  applySovereignScoreCalibration,
  modelForStage,
  profileSchema,
  resolveCortexDataMode,
  runChallenge,
  runConfound,
  runEnrichment,
  runHypothesise,
  runNarrate,
  runPerceive,
  runProfile,
  runScore,
  stripDashes,
  STAGE_CONFIG,
  type ChallengeOutput,
  type ConfounderOutput,
  type CortexDataMode,
  type EnrichmentOutput,
  type HypothesisedLayer,
  type LayerDescriptor,
  type LayerGrounding,
  type StageContext,
  type NarrateOutput,
  type PerceiveOutput,
  type Logger,
  type ProfileOutput,
  type ScoreOutput,
  type StageResult,
} from "@workspace/cortex";
import {
  db,
  derivedSignalsTable,
  layersTable,
  PIPELINE_SUB_STAGES,
  tenantLayersTable,
  tenantPipelineRunsTable,
  tenantProfileTable,
  tenantsTable,
  type PipelineSubStage,
  type PipelineSubStageName,
} from "@workspace/db";
import { refreshConnectedTenant } from "../connectors/connectedRefresh";
import { readDecryptedSignalsForMachine } from "../security/signalRead";
import { appendEntry } from "../provenance/ledger";
import { getAlerter } from "../alerts/alerter";
import { captureError } from "../observability/sentryReporter";
import { assertSeedWithinBudget } from "./budget";
import { claimNextSeedJob, enqueueSeedLayers, layerConcurrency, markSeedJob } from "./queue";
import { runnableLayerCondition } from "../layers/customLayer";
import { isReducedLayer } from "./reduceDecision";
import { recordModelUsageSafe } from "./usage";

export interface SeedOptions {
  log: Logger;
  // When false, an already-built layer is rebuilt instead of skipped. Defaults
  // to true (resume).
  resume?: boolean;
  // full (default) drives the full nine-stage adversarial chain on every layer;
  // express runs that full chain only on the priority layers and a reduced
  // chain elsewhere. The queue carries the mode on each job; runLayer applies
  // the reduced behaviour.
  mode?: "full" | "express";
  // Owner-only escape hatch from the GLOBAL monthly budget ceiling for a
  // deliberately prioritised seed. Never bypasses a per-tenant ceiling. Threaded
  // from the seed/refresh routes so the background backstop honours the same
  // decision the route already approved.
  priorityOverride?: boolean;
}

export interface LayerOutcome {
  layerKey: string;
  status: "built" | "skipped" | "error";
  // True when this layer ran (or, for a skipped layer, was previously built on)
  // the reduced express chain. Lets the seed script and callers report which
  // layers carry the lighter, adversary-free build.
  reduced?: boolean;
  reason?: string;
  // The per-layer run row this outcome produced, when one was created. Carried
  // back so the queue can point its job at the run.
  runId?: string;
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

  // Enforce the long-dash ban on the persisted profile (the models occasionally
  // emit one despite the prompt instruction). The cleaned profile feeds both the
  // tenant scalars and the stored profile jsonb.
  const clean = deepStripDashes(profile);
  const scalars = {
    name: clean.name,
    sector: clean.sector ?? null,
    hqCity: clean.hqCity ?? null,
    hqState: clean.hqState ?? null,
    revenueBand: clean.revenueBand ?? null,
    ownership: clean.ownership ?? null,
    founded: clean.founded ?? null,
    tagline: clean.tagline ?? null,
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
    .values({ tenantId, profile: clean })
    .onConflictDoUpdate({ target: tenantProfileTable.tenantId, set: { profile: clean } });

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
  // The injected logger, carried on the context so the usage-ledger taps inside
  // executeStage and executeEnrichment can report a failed cost write without
  // every call site threading a logger through.
  log: Logger;
}

async function ensureRun(
  tenantId: string,
  layerKey: string,
  resume: boolean,
  log: Logger,
): Promise<RunCtx> {
  const existing = await db
    .select()
    .from(tenantPipelineRunsTable)
    .where(and(eq(tenantPipelineRunsTable.tenantId, tenantId), eq(tenantPipelineRunsTable.layerKey, layerKey)))
    .limit(1);

  if (existing[0]) {
    const subStages = resume ? normalizeSubStages(existing[0].subStages) : freshSubStages();
    await db
      .update(tenantPipelineRunsTable)
      .set({ status: "running", error: null, finishedAt: null, subStages: deepStripDashes(subStages) })
      .where(eq(tenantPipelineRunsTable.id, existing[0].id));
    return { runId: existing[0].id, tenantId, layerKey, subStages, log };
  }

  const subStages = freshSubStages();
  const inserted = await db
    .insert(tenantPipelineRunsTable)
    .values({ tenantId, layerKey, status: "running", subStages })
    .returning({ id: tenantPipelineRunsTable.id });
  return { runId: inserted[0]!.id, tenantId, layerKey, subStages, log };
}

async function persistSubStages(ctx: RunCtx): Promise<void> {
  // Enforce the long-dash ban on the per-stage outputs persisted in the run row.
  // These are raw model outputs (the reasoning strip reads them back), so they
  // get the same deterministic sanitization as the assembled tenant_layers row.
  await db
    .update(tenantPipelineRunsTable)
    .set({ subStages: deepStripDashes(ctx.subStages) })
    .where(eq(tenantPipelineRunsTable.id, ctx.runId));
}

// Run (or resume) one sub-stage. On resume, returns the persisted output.
//
// `calibrate` is an optional pure transform applied to the stage output BEFORE
// it is persisted to the sub-stage JSONB and BEFORE it is returned, so the
// persisted record can never expose an output the caller would only sanitise
// later. Phase AF uses it to downgrade sovereign verified claims to modelled at
// the narrate and score stages; it is the identity transform (a strict no-op,
// returning the same object) in outside_in and connected mode, so the persisted
// output is byte-for-byte unchanged there. On resume the already-persisted
// output is already calibrated, so it is returned as is.
async function executeStage<T>(
  ctx: RunCtx,
  stage: PipelineSubStageName,
  run: () => Promise<StageResult<T>>,
  calibrate: (output: T) => T = (o) => o,
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
  // Record the real cost of this single call. A billed call that failed schema
  // validation is recorded too (its tokens were really spent); a no-call failure
  // (no in-boundary model configured, missing provider env, a transport error
  // before any response) carries billed:false and recordModelUsage skips it, so
  // we never fabricate a zero-cost row for a call that never happened. Recorded
  // only here, after run() actually fired, so a resumed (already done) sub-stage
  // is never double-counted.
  await recordModelUsageSafe(
    {
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      stage,
      layerKey: ctx.layerKey,
      telemetry: result.telemetry,
    },
    ctx.log,
  );
  if (!result.ok) {
    node.status = "error";
    node.error = result.reason;
    await persistSubStages(ctx);
    throw new StageError(stage, result.reason);
  }
  node.status = "done";
  // Calibrate BEFORE persisting and returning, so the sub-stage JSONB and every
  // downstream consumer only ever see the calibrated form (a strict no-op, the
  // same object, in outside_in and connected mode).
  const output = calibrate(result.output);
  node.output = output;
  await persistSubStages(ctx);
  return output;
}

// Mark a sub-stage as deliberately skipped by the reduced express chain. No
// model call is made, so the node carries no telemetry and no output: an honest
// record that the stage did not run, distinct from a completed stage. The
// caller persists once after marking the skipped pair.
function markSkipped(ctx: RunCtx, stage: PipelineSubStageName): void {
  const node = ctx.subStages.find((s) => s.name === stage);
  if (!node) throw new Error(`unknown sub-stage ${stage}`);
  node.status = "skipped";
  node.error = undefined;
  node.telemetry = undefined;
  node.durationMs = undefined;
  node.output = undefined;
}

// Run (or resume) the batched Enrichment call. hero, peers and supplements come
// from ONE Haiku call (see runEnrichment), but the rest of the pipeline and the
// reasoning strip expect three distinct persisted sub-stage records, so we split
// the composite back out. Real cost (tokens + latency) is recorded once, on
// hero; peers and supplements carry seat/model only with batched:true so the
// Intelligence Architecture summation never triple-counts the Evaluator.
async function executeEnrichment(
  ctx: RunCtx,
  run: () => Promise<StageResult<EnrichmentOutput>>,
): Promise<EnrichmentOutput> {
  const nodes = (["hero", "peers", "supplements"] as const).map((name) => {
    const node = ctx.subStages.find((s) => s.name === name);
    if (!node) throw new Error(`unknown sub-stage ${name}`);
    return [name, node] as const;
  });

  // Resume: every artefact already persisted from a prior run.
  if (nodes.every(([, n]) => n.status === "done" && n.output !== undefined)) {
    const byName = new Map(nodes);
    return {
      hero: byName.get("hero")!.output as EnrichmentOutput["hero"],
      peers: byName.get("peers")!.output as EnrichmentOutput["peers"],
      supplements: byName.get("supplements")!.output as EnrichmentOutput["supplements"],
    };
  }

  for (const [, node] of nodes) {
    node.status = "running";
    node.error = undefined;
  }
  await persistSubStages(ctx);

  const result = await run();
  // hero, peers and supplements are ONE batched Evaluator call, so cost is
  // recorded exactly once here, under a synthetic "enrichment" stage. The folded
  // peers and supplements sub-stages (telemetry batched:true) are never recorded,
  // so the Evaluator is never double- or triple-counted. Recorded for a failed
  // call too: the batched call's tokens were still spent.
  await recordModelUsageSafe(
    {
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      stage: "enrichment",
      layerKey: ctx.layerKey,
      telemetry: result.telemetry,
    },
    ctx.log,
  );
  if (!result.ok) {
    // One call failed, so all three artefacts failed: mark them together and
    // carry the real telemetry of the failing call on each.
    for (const [, node] of nodes) {
      node.status = "error";
      node.error = result.reason;
      node.telemetry = result.telemetry;
    }
    await persistSubStages(ctx);
    throw new StageError("hero", result.reason);
  }

  const output = result.output;
  for (const [name, node] of nodes) {
    node.status = "done";
    node.output = output[name];
    if (name === "hero") {
      node.telemetry = result.telemetry;
      node.durationMs = result.telemetry.latencyMs;
    } else {
      // peers and supplements are folded out of the single batched call, so they
      // carry the model that ACTUALLY ran and any sovereign honesty markers from
      // that call, with batched:true and NO token fields so the Evaluator is
      // counted exactly once. In outside_in and connected mode result.telemetry.model
      // is the evaluator model (identical to the prior modelForStage(name)) and
      // there are no markers, so those payloads stay byte-for-byte unchanged; in
      // sovereign mode this reflects the local seat instead of falsely naming the
      // external evaluator model with no markers.
      node.telemetry = {
        seat: STAGE_CONFIG[name].role,
        model: result.telemetry.model,
        latencyMs: 0,
        batched: true,
        ...(result.telemetry.executionMode !== undefined ? { executionMode: result.telemetry.executionMode } : {}),
        ...(result.telemetry.groundingAvailable !== undefined
          ? { groundingAvailable: result.telemetry.groundingAvailable }
          : {}),
        ...(result.telemetry.webSearchAvailable !== undefined
          ? { webSearchAvailable: result.telemetry.webSearchAvailable }
          : {}),
      };
      node.durationMs = 0;
    }
  }
  await persistSubStages(ctx);
  return output;
}

// ── one layer: nine sub-stages, then persist tenant_layers ───────────────────
async function runLayer(
  tenantId: string,
  profile: ProfileOutput,
  layer: LayerDescriptor,
  opts: SeedOptions,
  // Connected-mode derived-signal grounding for this layer. Undefined in
  // outside_in mode, where it must change nothing: the runners append a
  // grounding block only when this is present, so the prompts stay identical.
  grounding?: LayerGrounding,
  // The grounding regime for this run. outside_in (the default) keeps every stage
  // external and the call path byte-for-byte unchanged; connected routes the two
  // Lens stages in-boundary onto the local seat while the external Synthesist and
  // adversarial seats stay external on de-identified signals.
  dataMode: CortexDataMode = "outside_in",
): Promise<LayerOutcome> {
  const resume = opts.resume !== false;
  const mode = opts.mode ?? "full";
  // Sovereign mode never reduces: every stage, including the two adversarial
  // ones, runs in-boundary, so isReducedLayer returns false there regardless of
  // the seed mode (see reduceDecision). outside_in and connected keep the
  // express priority-layer policy unchanged.
  const reduced = isReducedLayer(mode, layer.key, dataMode);

  // Resume and the express->full upgrade share one skip decision. A built layer
  // satisfies this run unless it must be upgraded: an existing full build (the
  // most complete form) is always honoured, and an existing reduced build is
  // honoured only while this run is itself reduced. The single case that falls
  // through is a reduced build a full run must upgrade; it is rebuilt from
  // scratch (effectiveResume false) so narrate and score re-run with the
  // now-present confounders rather than reusing their adversary-free output.
  let effectiveResume = resume;
  if (resume) {
    const built = await db
      .select({ reducedMode: tenantLayersTable.reducedMode })
      .from(tenantLayersTable)
      .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layer.key)))
      .limit(1);
    if (built[0]) {
      if (built[0].reducedMode === false || reduced) {
        return { layerKey: layer.key, status: "skipped", reduced: built[0].reducedMode, telemetry: [] };
      }
      effectiveResume = false;
    }
  }

  const log = opts.log;
  const ctx = await ensureRun(tenantId, layer.key, effectiveResume, log);

  // The sensitivity routing for the two Lens stages. In connected mode runsInBoundary
  // (inside the runners) sends these to the local seat resolved from the env; in
  // outside_in mode dataMode is "outside_in" and the runners take the external path
  // unchanged. The runtime is left to default resolution; tests inject their own.
  const stageCtx: StageContext = { dataMode };

  try {
    const perceive = await executeStage<PerceiveOutput>(ctx, "perceive", () =>
      runPerceive(profile, layer, log, grounding, stageCtx),
    );
    const hypothesise = await executeStage<HypothesisedLayer>(ctx, "hypothesise", () =>
      runHypothesise(profile, layer, perceive, log, grounding, stageCtx),
    );
    // The reduced express chain skips the two adversarial sub-stages on a
    // non-priority layer. narrate and score still run, but with empty confounder
    // and challenge inputs: the persisted layer therefore carries no confounders
    // and the two nodes are honestly marked skipped, never faked as done.
    let confound: ConfounderOutput;
    let challenge: ChallengeOutput;
    if (reduced) {
      confound = { confounders: [] };
      challenge = { findings: [], alternative_hypotheses: [] };
      markSkipped(ctx, "confound");
      markSkipped(ctx, "challenge");
      await persistSubStages(ctx);
    } else {
      confound = await executeStage<ConfounderOutput>(ctx, "confound", () =>
        runConfound(profile, layer, hypothesise, log, grounding, stageCtx),
      );
      challenge = await executeStage<ChallengeOutput>(ctx, "challenge", () =>
        runChallenge(profile, layer, hypothesise, confound, log, grounding, stageCtx),
      );
    }
    // Sovereign-mode honesty calibration. In sovereign mode no external grounding
    // or web-search channel ran, so a claim can never be honestly verified: the
    // narrate calibration downgrades any verified claim to modelled (used for the
    // stored verifiedClaims array and the provenance ledger), and the score
    // calibration downgrades any per-claim basis the Evaluator marked verified, so
    // the assembled, displayed content carries no verified badge. Both are no-ops
    // in outside_in and connected mode, leaving those paths byte-for-byte unchanged.
    //
    // The calibration is passed INTO executeStage so it runs before the sub-stage
    // output is persisted to the JSONB, never after: the raw, uncalibrated narrate
    // and score outputs (which a sovereign local model could mark verified) are
    // never written to tenant_pipeline_runs.subStages, only the calibrated form.
    const narrate = await executeStage<NarrateOutput>(
      ctx,
      "narrate",
      () => runNarrate(profile, layer, hypothesise, confound, challenge, log, grounding, stageCtx),
      (output) => applySovereignNarrateCalibration(output, dataMode),
    );
    const score = await executeStage<ScoreOutput>(
      ctx,
      "score",
      () => runScore(profile, layer, narrate, confound, challenge, log, grounding, stageCtx),
      (output) => applySovereignScoreCalibration(output, dataMode),
    );
    const { hero, peers, supplements } = await executeEnrichment(ctx, () =>
      runEnrichment(profile, layer, narrate, log, grounding, stageCtx),
    );

    // The Evaluator (score) is the single writer of confidence and basis; the
    // assembler copies its numbers onto the Synthesist's content.
    const assembled = assembleLayerContent(narrate, score);
    if (!assembled.ok) {
      throw new StageError("score", assembled.reason);
    }

    // Enforce the long-dash ban on every generated string before it is
    // persisted. deepStripDashes recurses through the content, hero, benchmark,
    // supplement, confounder and claim payloads; numbers, booleans and the model
    // identifier (ASCII hyphens) pass through unchanged.
    // Editorial voice (Phase AB): measure the assembled prose deterministically
    // and record the report ON the row. This never edits the content; a below-bar
    // layer is persisted with its real (lower) band, not silently corrected.
    const voiceQuality = evaluateNarrativeVoice(assembled.content);

    // The generator model that actually produced the narrative, read from the
    // narrate sub-stage's recorded telemetry rather than assumed. In outside_in
    // and connected mode narrate ran on the external reasoner whose telemetry
    // model is modelForStage("narrate"), so this is byte-for-byte the same value;
    // in sovereign mode narrate ran on the local seat, so this honestly records
    // the env-supplied local model id instead of a frontier model that never ran.
    // Falls back to the configured narrate seat only if telemetry is somehow
    // absent, which cannot happen on a successful run (executeStage throws first).
    const narrateNode = ctx.subStages.find((s) => s.name === "narrate");
    const generatorModel = narrateNode?.telemetry?.model ?? modelForStage("narrate");

    const row = deepStripDashes({
      content: assembled.content as unknown as Record<string, unknown>,
      heroPanel: hero as unknown as Record<string, unknown>,
      peerBenchmark: peers as unknown as Record<string, unknown>,
      supplementBlocks: supplements as unknown as Record<string, unknown>,
      confounders: confound.confounders as unknown as unknown[],
      verifiedClaims: { items: narrate.verified_claims } as Record<string, unknown>,
      modelledClaims: { items: narrate.modelled_claims } as Record<string, unknown>,
      voiceQuality: voiceQuality as unknown as Record<string, unknown>,
      reducedMode: reduced,
      generatorModel,
    });

    await db
      .insert(tenantLayersTable)
      .values({ tenantId, layerKey: layer.key, ...row })
      .onConflictDoUpdate({
        target: [tenantLayersTable.tenantId, tenantLayersTable.layerKey],
        set: { ...row, generatedAt: new Date() },
      });

    // Provenance ledger: one tamper-evident, hash-chained entry per claim path,
    // recording only the source reference, never raw data. Verified and modelled
    // claims both chain in. This is the Processing Integrity evidence, written
    // here where the orchestrator owns all side effects; a failure surfaces as a
    // loud layer error, never a silent gap in the evidence. The refs are dash-
    // swept to hold the typography ban on every stored string.
    const provenanceClaims = [
      ...narrate.verified_claims.map((c) => ({
        basis: "verified",
        path: c.claim_path,
        urls: c.source_urls,
      })),
      ...narrate.modelled_claims.map((c) => ({
        basis: "modelled",
        path: c.claim_path,
        urls: c.source_urls,
      })),
    ];
    for (const claim of provenanceClaims) {
      const refs = claim.urls.length > 0 ? claim.urls.join(" ") : "(none)";
      await appendEntry({
        tenantId,
        claimPath: stripDashes(layer.key + "." + claim.path),
        sourceRef: stripDashes(claim.basis + ":" + refs),
      });
    }

    await db
      .update(tenantPipelineRunsTable)
      .set({ status: "done", finishedAt: new Date(), error: null })
      .where(eq(tenantPipelineRunsTable.id, ctx.runId));

    return {
      layerKey: layer.key,
      status: "built",
      reduced,
      runId: ctx.runId,
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
      .set({ status: "error", finishedAt: new Date(), error: stripDashes(reason) })
      .where(eq(tenantPipelineRunsTable.id, ctx.runId));
    log.error({ tenantId, layerKey: layer.key, reason }, "layer run failed");
    // Phase P: record the failure on the alert seam and capture it to the error
    // aggregator. Both are best-effort: a failure here must never mask or alter
    // the original layer failure being returned below.
    try {
      await getAlerter().emit({
        type: "seed_run_failed",
        severity: "critical",
        tenantId,
        entityType: "pipeline_run",
        entityId: ctx.runId,
        message: stripDashes("seed layer run failed: " + layer.key + ": " + reason),
        details: { layerKey: layer.key, reason: stripDashes(reason).slice(0, 500) },
      });
    } catch (alertErr) {
      log.error(
        { reason: alertErr instanceof Error ? alertErr.message : String(alertErr) },
        "seed_run_failed alert emit failed",
      );
    }
    await captureError(e, {
      subsystem: "orchestrator",
      tenantId,
      layerKey: layer.key,
      runId: ctx.runId,
      level: "error",
    });
    return {
      layerKey: layer.key,
      status: "error",
      reduced,
      reason,
      runId: ctx.runId,
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
  // Phase AG approval gate. A layer enters the seed fan-out only when it is
  // canonical (the default 14, approved by definition) OR a custom layer an owner
  // has approved (approvedAt set). An unapproved custom layer never runs the
  // nine-stage chain, so quality stays curated and "approved before first run" is
  // enforced at the one place that decides what runs. The canonical 14 are all
  // canonical, so this predicate leaves their seed byte-for-byte unchanged.
  const rows = await db
    .select({
      key: layersTable.key,
      name: layersTable.name,
      description: layersTable.description,
      diagnosticQuestion: layersTable.diagnosticQuestion,
    })
    .from(layersTable)
    .where(runnableLayerCondition())
    .orderBy(asc(layersTable.sortOrder));
  return rows;
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function seedTenant(rawUrl: string, opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log;

  // The dataMode branch is decided here, by a tenant lookup, before any work.
  // A connected tenant is refreshed in place and grounds on its own derived
  // signals, so the outside_in path below is left entirely untouched (no extra
  // step runs for an outside_in tenant beyond this single lookup).
  const existingTenant = await db
    .select({ id: tenantsTable.id, dataMode: tenantsTable.dataMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.url, rawUrl))
    .limit(1);
  if (existingTenant[0]?.dataMode === "connected") {
    return seedConnectedTenant(existingTenant[0].id, rawUrl, opts);
  }

  // Sovereign is a deployment-wide regime selected from the environment: it runs
  // EVERY stage in-boundary with no external provider. An outside_in seed under
  // sovereign therefore profiles and builds entirely on the local seat, with no
  // public-web grounding. When unset this resolves to outside_in and changes
  // nothing about the existing public-web path.
  const dataMode: CortexDataMode = resolveCortexDataMode() === "sovereign" ? "sovereign" : "outside_in";

  // In sovereign mode the deployment must not reach the public web at all, so the
  // homepage is deliberately NOT fetched: the profile runs in-boundary on the
  // local seat with an honest no-grounding context (ok:false, no network IO).
  // Every other mode fetches the homepage as the empirical anchor for profiling.
  let homepage;
  if (dataMode === "sovereign") {
    log.info({ url: rawUrl }, "seed: sovereign mode, skipping public-web homepage fetch");
    homepage = sovereignNoFetchHomepageContext(rawUrl);
  } else {
    log.info({ url: rawUrl }, "seed: fetching homepage ground truth");
    homepage = await fetchHomepageContext(rawUrl, log);
  }

  log.info({ url: rawUrl, grounded: homepage.ok, dataMode }, "seed: running profile stage");
  const profileResult = await runProfile(rawUrl, homepage, log, { dataMode });
  if (!profileResult.ok) {
    // The profile call may have consumed real tokens before failing schema
    // validation. Record that spend now (the tenant shell does not exist yet, so
    // tenantId is null) so a billed-but-failed profile lands on the ledger, then
    // fail loud. recordModelUsageSafe is a no-op when the call was not billed.
    await recordModelUsageSafe(
      {
        tenantId: null,
        runId: null,
        stage: "profile",
        layerKey: null,
        telemetry: profileResult.telemetry,
      },
      log,
    );
    throw new Error(`profile stage failed: ${profileResult.reason}`);
  }
  const profile = profileResult.output;

  const tenantId = await ensureTenant(rawUrl, profile);
  log.info({ tenantId, name: profile.name }, "seed: tenant shell ready");

  // The tenant-scope profile call has no layer run: record it once the tenant
  // shell exists, with no runId and no layerKey, so its real cost is in the
  // ledger like every other call.
  await recordModelUsageSafe(
    {
      tenantId,
      runId: null,
      stage: "profile",
      layerKey: null,
      telemetry: profileResult.telemetry,
    },
    log,
  );

  const registry = await loadRegistry();
  if (registry.length === 0) {
    throw new Error("layer registry is empty; seed the registry before seeding a tenant");
  }

  // Budget backstop before the layer fan-out (the expensive part). The seed and
  // refresh routes gate this at the HTTP boundary before any spend; this second
  // check covers the non-HTTP seed script path and marks the tenant honestly
  // failed rather than leaving it stuck "seeding" if a ceiling was reached.
  try {
    await assertSeedWithinBudget({ tenantId, priorityOverride: opts.priorityOverride, log });
  } catch (err) {
    await db
      .update(tenantsTable)
      .set({ status: "failed", lastSeededAt: new Date() })
      .where(eq(tenantsTable.id, tenantId));
    throw err;
  }
  log.info({ tenantId, layers: registry.length }, "seed: fanning out across layers");

  const layers = await runLayers(tenantId, profile, registry, opts, undefined, dataMode);

  const anyError = layers.some((o) => o.status === "error");
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
    layers,
  };
}

// Fan out across the registry layers and drain the work. The seed limiter runs
// on the Postgres-backed queue, not module memory: one job per layer is
// enqueued, then this instance drains the queue with up to LAYER_CONCURRENCY
// claim loops. Each claim is atomic (FOR UPDATE SKIP LOCKED), so concurrent
// workers and instances share the work without ever double-processing a layer,
// and a crashed worker's job is reclaimed and resumed once its lease expires.
// Both seed paths use this: outside_in passes no grounding (identical prompts),
// connected passes per-layer derived-signal grounding.
async function runLayers(
  tenantId: string,
  profile: ProfileOutput,
  registry: LayerDescriptor[],
  opts: SeedOptions,
  groundingByLayer?: Map<string, LayerGrounding>,
  // The grounding regime for this seed. outside_in (the default) leaves every
  // stage external; connected routes the two Lens stages in-boundary per layer.
  dataMode: CortexDataMode = "outside_in",
): Promise<LayerOutcome[]> {
  const mode = opts.mode ?? "full";
  const layerByKey = new Map(registry.map((l) => [l.key, l] as const));
  await enqueueSeedLayers(
    tenantId,
    registry.map((l) => l.key),
    mode,
  );

  const workerId = `${process.pid}-${randomUUID()}`;
  const outcomes = new Map<string, LayerOutcome>();
  const drain = async (): Promise<void> => {
    for (;;) {
      const job = await claimNextSeedJob(tenantId, workerId);
      if (!job) return;
      const layer = layerByKey.get(job.payload.layerKey);
      if (!layer) {
        await markSeedJob(job.id, "error", { lastError: `unknown layer ${job.payload.layerKey}` });
        continue;
      }
      const outcome = await runLayer(
        tenantId,
        profile,
        layer,
        { ...opts, mode: job.payload.mode },
        groundingByLayer?.get(layer.key),
        dataMode,
      );
      outcomes.set(layer.key, outcome);
      await markSeedJob(job.id, outcome.status === "error" ? "error" : "done", {
        runId: outcome.runId,
        lastError: outcome.status === "error" ? outcome.reason : undefined,
      });
    }
  };
  const workerCount = Math.min(layerConcurrency(), registry.length);
  await Promise.all(Array.from({ length: workerCount }, () => drain()));

  // Reassemble outcomes in registry order. A missing entry can only mean a
  // worker never reached the layer (it would otherwise be built/skipped/error),
  // which is itself a failure of the run.
  return registry.map(
    (l) =>
      outcomes.get(l.key) ?? {
        layerKey: l.key,
        status: "error" as const,
        reason: "layer was not processed by any worker",
        telemetry: [],
      },
  );
}

// Build per-layer grounding from the tenant's persisted derived signals: only
// de-identified math (scalars and numeric vectors), grouped by the layer each
// signal feeds. This is the connected-mode replacement for the homepage snippet;
// it carries no raw client content, because nothing reversible is ever stored in
// derived_signals in the first place.
async function loadLayerGrounding(tenantId: string): Promise<Map<string, LayerGrounding>> {
  // The in-boundary machine read decrypts the tenant's signals under its active
  // key and fails loud on a revoked or missing key (the crypto-shred gate lives
  // in that shared helper, so the grounding read and the Phase X benchmark read
  // can never drift apart). We then group the de-identified math by the layer each
  // signal feeds; nothing reversible is ever stored in derived_signals, so the
  // grounding carries no raw client content.
  const rows = await readDecryptedSignalsForMachine(tenantId);

  const byLayer = new Map<string, LayerGrounding>();
  for (const r of rows) {
    let grounding = byLayer.get(r.layerKey);
    if (!grounding) {
      grounding = { layerKey: r.layerKey, signals: [] };
      byLayer.set(r.layerKey, grounding);
    }
    grounding.signals.push({
      signalKey: r.signalKey,
      value: r.value,
      ...(r.window ? { window: r.window } : {}),
      ...(r.sourceConnectorKey ? { sourceConnectorKey: r.sourceConnectorKey } : {}),
      ...(r.computedAt ? { computedAt: r.computedAt } : {}),
    });
  }
  return byLayer;
}

// Connected mode is refresh-only. The tenant already exists and was profiled
// once; we never refetch the homepage or rerun the profile stage. We refresh the
// tenant's boundary connectors (deriving only math), then rebuild every layer
// grounded on those derived signals in place of public web signal. The
// outside_in seed path is left entirely untouched.
async function seedConnectedTenant(
  tenantId: string,
  rawUrl: string,
  opts: SeedOptions,
): Promise<SeedResult> {
  const log = opts.log;

  // The stored profile is required: connected mode never regenerates it, so its
  // absence is a loud failure, never a silent re-profile.
  const profileRow = await db
    .select({ profile: tenantProfileTable.profile })
    .from(tenantProfileTable)
    .where(eq(tenantProfileTable.tenantId, tenantId))
    .limit(1);
  if (!profileRow[0]) {
    throw new Error(
      `connected tenant ${tenantId} has no stored profile; seed it in outside_in mode before connecting`,
    );
  }
  const parsedProfile = profileSchema.safeParse(profileRow[0].profile);
  if (!parsedProfile.success) {
    throw new Error(`connected tenant ${tenantId} has an invalid stored profile`);
  }
  const profile = parsedProfile.data;

  log.info({ tenantId }, "connected: refreshing boundary connectors");
  const refresh = await refreshConnectedTenant(tenantId, log);
  log.info(
    {
      tenantId,
      connections: refresh.length,
      refreshed: refresh.filter((r) => r.status === "refreshed").length,
    },
    "connected: connector refresh complete",
  );

  const groundingByLayer = await loadLayerGrounding(tenantId);
  log.info(
    { tenantId, groundedLayers: groundingByLayer.size },
    "connected: derived-signal grounding built",
  );

  const registry = await loadRegistry();
  if (registry.length === 0) {
    throw new Error("layer registry is empty; seed the registry before seeding a tenant");
  }

  // Budget backstop before the connector-grounded layer fan-out, mirroring the
  // outside_in seed path. The refresh route gates this at the HTTP boundary; this
  // second check covers any non-HTTP caller and marks the tenant honestly failed
  // rather than leaving it stuck "refreshing" if a ceiling was reached.
  try {
    await assertSeedWithinBudget({ tenantId, priorityOverride: opts.priorityOverride, log });
  } catch (err) {
    await db
      .update(tenantsTable)
      .set({ status: "failed", lastSeededAt: new Date() })
      .where(eq(tenantsTable.id, tenantId));
    throw err;
  }

  // A refresh rebuilds every layer on the fresh grounding, so resume is forced
  // off here: a previously built layer must be regenerated against the new
  // signals, never skipped as already done.
  // A connected tenant under a sovereign deployment runs every stage in-boundary
  // too, while still grounding on its own derived signals; otherwise it is the
  // Tier 2 connected split (Lens in-boundary, adversarial seats external). When
  // CORTEX_DATA_MODE is unset this resolves to connected and is unchanged.
  const dataMode: CortexDataMode = resolveCortexDataMode() === "sovereign" ? "sovereign" : "connected";
  const layers = await runLayers(
    tenantId,
    profile,
    registry,
    { ...opts, resume: false },
    groundingByLayer,
    dataMode,
  );

  const anyError = layers.some((o) => o.status === "error");
  await db
    .update(tenantsTable)
    .set({ status: anyError ? "failed" : "ready", lastSeededAt: new Date() })
    .where(eq(tenantsTable.id, tenantId));

  return {
    tenantId,
    name: profile.name,
    url: rawUrl,
    // No profile stage runs in connected mode: the profile is loaded, not
    // regenerated, so there is no profile telemetry to report.
    profileTelemetry: {},
    layers,
  };
}
