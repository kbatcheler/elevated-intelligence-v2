import { and, asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import {
  benchmarkConsentEventsTable,
  benchmarkStatsTable,
  committedActionsTable,
  db,
  derivedSignalsTable,
  edgeAgentsTable,
  layersTable,
  orgTenantsTable,
  outcomeMeasurementsTable,
  tenantLayersTable,
  tenantPipelineRunsTable,
  tenantProfileTable,
  tenantsTable,
} from "@workspace/db";
import { z } from "zod";
import { createAgentCredential } from "../lib/agent/agentCredential";
import {
  listFindingChallenges,
  runFindingChallenge,
  serializeChallenge,
} from "../lib/challenge/findingChallenge";
import { isOwner, isProvider } from "../lib/auth/access";
import {
  linkForecastToCommittedAction,
  resolveForecastsForMeasurement,
} from "../lib/calibration/forecastResolution";
import { computeLayerConfidenceAdvisory } from "../lib/calibration/layerConfidence";
import { getBenchmarkMinCohort } from "../lib/benchmarks/benchmarks";
import { segmentKeyFor } from "../lib/benchmarks/benchmarkMath";
import { logger } from "../lib/logger";
import {
  computeOutcomeSummary,
  computeVariance,
  deriveMeasurementStatus,
  toNum,
} from "../lib/outcomes/outcomeMath";
import { parsePredictedValueUsd } from "../lib/outcomes/predictedValue";
import { assertSeedWithinBudget, BudgetExceededError } from "../lib/pipeline/budget";
import { seedTenant } from "../lib/pipeline/orchestrator";
import { readDecryptedSignalsForMachine } from "../lib/security/signalRead";
import { CryptoShreddedError, SignalEncryptionError } from "../lib/security/errors";
import { requireTenantAccess } from "../middleware/auth";
import { asBasis, asNumber, asObjectArray, asString } from "../lib/overview/overviewProjection";
import { loadTenantOverview } from "../lib/overview/overview";

export const tenantsRouter: Router = Router();

// ── Phase X: a tenant's own cohort benchmark for a layer ────────────────────
// Either an unlocked verified-cohort distribution (the layer's metrics, each with
// the tenant's own value positioned against the cohort percentiles) or a lock
// (the cohort has not yet reached the k-anonymity floor). NEVER a contributor
// list: the only tenant value present is the requester's OWN, read in-boundary
// from their own data.
interface CohortMetric {
  signalKey: string;
  window: string | null;
  // The requester's own value for this metric, or null when they have no scalar
  // for it (or their key is crypto-shredded). Their own data, never a peer's.
  self: number | null;
  p25: number;
  p50: number;
  p75: number;
  // Distinct tenants behind this distribution (always >= the k floor).
  sampleCount: number;
  // True when bounded privacy noise was applied; the portal labels it honestly.
  noised: boolean;
}
interface CohortBenchmark {
  basis: "verified_cohort";
  sector: string;
  revenueBand: string;
  metrics: CohortMetric[];
}
interface CohortLock {
  sector: string;
  revenueBand: string;
  // Opted-in peers currently sharing the requester's segment (the requester
  // included), counted live at read time, and the k floor it must reach.
  currentCount: number;
  unlocksAt: number;
}

// Build the cohort view for one tenant and layer. Returns both null when the
// tenant has not opted in or has no eligible segment: benchmarking is strictly
// consensual and structurally de-identified. The recompute already enforced the
// k floor when it wrote stats, so the presence of any stat row for this segment
// and layer means it is unlocked; the lock path counts live opted-in peers so a
// tenant sees an honest, immediate "growing cohort" number before the next run.
async function buildLayerCohort(
  tenantId: string,
  layerKey: string,
): Promise<{ cohortBenchmark: CohortBenchmark | null; cohortLock: CohortLock | null }> {
  const tRows = await db
    .select({
      optIn: tenantsTable.benchmarkOptIn,
      sector: tenantsTable.sector,
      revenueBand: tenantsTable.revenueBand,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const t = tRows[0];
  if (!t || !t.optIn) return { cohortBenchmark: null, cohortLock: null };
  const seg = segmentKeyFor(t.sector, t.revenueBand);
  if (!seg) return { cohortBenchmark: null, cohortLock: null };

  const stats = await db
    .select()
    .from(benchmarkStatsTable)
    .where(
      and(
        eq(benchmarkStatsTable.cohortSegmentKey, seg.segmentKey),
        eq(benchmarkStatsTable.layerKey, layerKey),
      ),
    );

  // Re-gate at read time against the CURRENT k-anonymity floor. Each stat row
  // carries the distinct-tenant count behind it (sampleCount); the recompute
  // enforced the floor in force when it wrote the row, but if an operator
  // tightens BENCHMARK_MIN_COHORT between recomputes a row written under the
  // looser floor would otherwise stay visible until the next run. Dropping it
  // here can only ever be more conservative, never fabricate a cohort, and a
  // segment left with no eligible stat falls through to the honest lock below.
  const minCohort = getBenchmarkMinCohort();
  const eligibleStats = stats.filter((s) => s.sampleCount >= minCohort);

  if (eligibleStats.length > 0) {
    // Position the requester's OWN value in each band. An in-boundary machine
    // read of their own data; a crypto-shredded tenant simply has no self marker
    // (caught, not fatal). Dedupe to one latest scalar per (signal, window), the
    // same shape the recompute pools on, so self lines up with the distribution.
    const selfByKey = new Map<string, { value: number; computedAt: string }>();
    try {
      const rows = await readDecryptedSignalsForMachine(tenantId);
      for (const r of rows) {
        if (r.layerKey !== layerKey) continue;
        if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
        const k = r.signalKey + "\u0000" + (r.window ?? "");
        const prev = selfByKey.get(k);
        if (!prev || r.computedAt > prev.computedAt) {
          selfByKey.set(k, { value: r.value, computedAt: r.computedAt });
        }
      }
    } catch (err) {
      // A crypto-shredded or otherwise unreadable key means the requester simply
      // has no self marker for this metric: an honest null, not a fault to raise,
      // and the cohort distribution still shows. Anything else is unexpected and
      // is logged loudly here rather than silently masked, so a real bug in the
      // read path cannot hide behind a blank-self benchmark.
      if (!(err instanceof CryptoShreddedError) && !(err instanceof SignalEncryptionError)) {
        logger.error(
          { tenantId, layerKey, err: err instanceof Error ? err.message : String(err) },
          "cohort self-marker read failed unexpectedly",
        );
      }
    }
    const metrics: CohortMetric[] = eligibleStats.map((s) => {
      const self = selfByKey.get(s.signalKey + "\u0000" + (s.window ?? ""));
      return {
        signalKey: s.signalKey,
        window: s.window,
        self: self ? self.value : null,
        p25: Number(s.p25),
        p50: Number(s.p50),
        p75: Number(s.p75),
        sampleCount: s.sampleCount,
        noised: s.noised,
      };
    });
    return {
      cohortBenchmark: {
        basis: "verified_cohort",
        sector: seg.sector,
        revenueBand: seg.revenueBand,
        metrics,
      },
      cohortLock: null,
    };
  }

  // Locked: no stat cleared the floor for this layer yet. Count live opted-in
  // peers sharing this exact normalized segment so the lock shows a real,
  // current number, not a stale cohort row. Normalization is in JS, so match in
  // JS over the opted-in set rather than trusting a raw-string GROUP BY.
  const optedIn = await db
    .select({ sector: tenantsTable.sector, revenueBand: tenantsTable.revenueBand })
    .from(tenantsTable)
    .where(eq(tenantsTable.benchmarkOptIn, true));
  let currentCount = 0;
  for (const o of optedIn) {
    const os = segmentKeyFor(o.sector, o.revenueBand);
    if (os && os.segmentKey === seg.segmentKey) currentCount += 1;
  }
  return {
    cohortBenchmark: null,
    cohortLock: {
      sector: seg.sector,
      revenueBand: seg.revenueBand,
      currentCount,
      unlocksAt: getBenchmarkMinCohort(),
    },
  };
}

// The tenants the caller may see. Provider seats see every tenant; client and
// portfolio seats see only the tenants their org is bound to through
// org_tenants. This is the portal's entry point: it picks a default tenant and
// renders the tenant switcher from this list.
//
// This is a deliberate reversal of the phase-D posture, which had no non-admin
// tenant list so nothing was enumerable. It is recorded in the phase-E drift
// report: the product cannot function without the caller knowing which tenants
// are theirs, and the list is strictly access-filtered, so a caller can only
// ever enumerate tenants already inside their own access scope.
tenantsRouter.get("/tenants", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const columns = {
      id: tenantsTable.id,
      name: tenantsTable.name,
      url: tenantsTable.url,
      sector: tenantsTable.sector,
      tagline: tenantsTable.tagline,
      status: tenantsTable.status,
      lastSeededAt: tenantsTable.lastSeededAt,
    };
    if (isProvider(user.role)) {
      const rows = await db.select(columns).from(tenantsTable).orderBy(asc(tenantsTable.name));
      res.json({ tenants: rows });
      return;
    }
    if (!user.orgId) {
      res.json({ tenants: [] });
      return;
    }
    const rows = await db
      .select(columns)
      .from(tenantsTable)
      .innerJoin(orgTenantsTable, eq(orgTenantsTable.tenantId, tenantsTable.id))
      .where(eq(orgTenantsTable.orgId, user.orgId))
      .orderBy(asc(tenantsTable.name));
    res.json({ tenants: rows });
  } catch (err) {
    next(err);
  }
});

// Seed mode selects the full nine-stage adversarial chain on every layer
// (default) or the express reduced chain, which runs the full chain only on the
// priority layers and skips the confound and challenge sub-stages elsewhere.
const seedTenantSchema = z.object({
  url: z.string().url().max(2000),
  mode: z.enum(["full", "express"]).default("full"),
  // Owner-only: proceed past the global monthly budget ceiling for a prioritised
  // seed. Honoured only for the owner role (checked below); never bypasses a
  // per-tenant ceiling.
  priorityOverride: z.boolean().optional(),
});
const refreshTenantSchema = z.object({
  mode: z.enum(["full", "express"]).default("full"),
  priorityOverride: z.boolean().optional(),
});

// Create a tenant from a URL and seed it through the cortex. Provider-only:
// seeding spends real model budget and produces a tenant the bound orgs can see.
// The long fan-out (profile then the registry layers) runs in the background, so
// the request returns 202 with the seeding shell immediately and the portal
// polls the run surface for progress. A failed seed is recorded honestly on the
// tenant status and the per-layer runs, never swallowed.
tenantsRouter.post("/tenants", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = seedTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const { url, mode } = parsed.data;
    const priorityOverride = isOwner(user.role) && parsed.data.priorityOverride === true;
    // Pre-create (or reclaim) the shell so the caller gets an id at once and the
    // tenant shows as seeding in the switcher. seedTenant upserts this same row
    // by URL once the profile stage resolves the real name and scalars.
    const host = new URL(url).hostname;
    const existing = await db
      .select({ id: tenantsTable.id, status: tenantsTable.status })
      .from(tenantsTable)
      .where(eq(tenantsTable.url, url))
      .limit(1);

    // Budget gate, before any shell is created or any model budget is spent. A
    // brand-new URL has no tenant yet, so only the global monthly ceiling
    // applies; reclaiming an existing shell also checks that tenant's ceiling.
    // The owner may override the global refusal for a prioritised seed.
    try {
      await assertSeedWithinBudget({
        tenantId: existing[0]?.id ?? null,
        priorityOverride,
        log: logger,
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        res.status(402).json({ error: "budget_exceeded", scope: err.scope, message: err.message });
        return;
      }
      throw err;
    }

    let tenantId: string;
    if (existing[0]) {
      // A seed is already in flight for this URL. Re-triggering would delete the
      // claimed jobs and drain the same layers twice (double model spend plus
      // racing writes to one run). Refuse rather than stack seeds.
      if (existing[0].status === "seeding") {
        res.status(409).json({ error: "seed_in_progress", tenantId: existing[0].id });
        return;
      }
      tenantId = existing[0].id;
      await db.update(tenantsTable).set({ status: "seeding" }).where(eq(tenantsTable.id, tenantId));
    } else {
      const inserted = await db
        .insert(tenantsTable)
        .values({ url, name: host, status: "seeding" })
        .returning({ id: tenantsTable.id });
      tenantId = inserted[0]!.id;
    }
    void seedTenant(url, { log: logger, mode, priorityOverride }).catch(async (err) => {
      logger.error(
        { url, err: err instanceof Error ? err.message : String(err) },
        "background tenant seed failed",
      );
      // The orchestrator marks the tenant failed itself once its shell exists and
      // a budget check or a layer fails, but a throw BEFORE that (e.g. the profile
      // stage) would leave the route-created shell stuck "seeding" forever. Flip
      // it to failed honestly, guarded to touch only a row still seeding so a
      // terminal status the orchestrator already wrote is never clobbered.
      try {
        await db
          .update(tenantsTable)
          .set({ status: "failed", lastSeededAt: new Date() })
          .where(and(eq(tenantsTable.id, tenantId), eq(tenantsTable.status, "seeding")));
      } catch (cleanupErr) {
        logger.error(
          {
            tenantId,
            err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          },
          "failed to mark stuck tenant failed after background seed error",
        );
      }
    });
    res.status(202).json({ tenantId, status: "seeding", mode });
  } catch (err) {
    next(err);
  }
});

// Re-seed an existing tenant. Provider-only for the same budget reason. In full
// mode this is also the express->full upgrade path: runLayer rebuilds any layer
// previously built on the reduced chain while leaving full layers untouched.
tenantsRouter.post("/tenants/:id/refresh", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = refreshTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const rows = await db
      .select({ url: tenantsTable.url, status: tenantsTable.status })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    const tenant = rows[0];
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    // A seed already running for this tenant: refuse rather than delete its
    // claimed jobs and double-spend (same reason as create above).
    if (tenant.status === "seeding") {
      res.status(409).json({ error: "seed_in_progress", tenantId });
      return;
    }
    const { mode } = parsed.data;
    const priorityOverride = isOwner(user.role) && parsed.data.priorityOverride === true;

    // Same budget gate as create: the tenant is known here, so both the global
    // and this tenant's monthly ceiling are checked before any spend.
    try {
      await assertSeedWithinBudget({ tenantId, priorityOverride, log: logger });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        res.status(402).json({ error: "budget_exceeded", scope: err.scope, message: err.message });
        return;
      }
      throw err;
    }

    await db.update(tenantsTable).set({ status: "seeding" }).where(eq(tenantsTable.id, tenantId));
    void seedTenant(tenant.url, { log: logger, mode, priorityOverride }).catch(async (err) => {
      logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "background tenant refresh failed",
      );
      // Same honest-failed guarantee as create: a throw before the orchestrator
      // writes its own terminal status would otherwise leave this tenant stuck
      // "seeding". Guarded to touch only a row still seeding.
      try {
        await db
          .update(tenantsTable)
          .set({ status: "failed", lastSeededAt: new Date() })
          .where(and(eq(tenantsTable.id, tenantId), eq(tenantsTable.status, "seeding")));
      } catch (cleanupErr) {
        logger.error(
          {
            tenantId,
            err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          },
          "failed to mark stuck tenant failed after background refresh error",
        );
      }
    });
    res.status(202).json({ tenantId, status: "seeding", mode });
  } catch (err) {
    next(err);
  }
});

// Provision a per-tenant credential for the in-client extraction agent.
// Provider-only: a credential lets its holder post derived signals for the
// tenant, so issuing one is a trust decision the provider makes. The full token
// is returned exactly once, here, and only its scrypt hash is stored; it cannot
// be recovered later, so the operator must capture it now.
const createAgentSchema = z.object({ label: z.string().min(1).max(120) });

tenantsRouter.post("/tenants/:id/agents", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const exists = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!exists[0]) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const credential = await createAgentCredential();
    await db.insert(edgeAgentsTable).values({
      id: credential.agentId,
      tenantId,
      label: parsed.data.label,
      tokenHash: credential.tokenHash,
    });
    res
      .status(201)
      .json({ agentId: credential.agentId, label: parsed.data.label, token: credential.token });
  } catch (err) {
    next(err);
  }
});

// List a tenant's agents. Provider-only. The token hash is never returned; this
// is the issued-and-revoked ledger the console renders, not a way to recover a
// credential.
tenantsRouter.get("/tenants/:id/agents", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const agents = await db
      .select({
        id: edgeAgentsTable.id,
        label: edgeAgentsTable.label,
        status: edgeAgentsTable.status,
        lastSeenAt: edgeAgentsTable.lastSeenAt,
        createdAt: edgeAgentsTable.createdAt,
        revokedAt: edgeAgentsTable.revokedAt,
      })
      .from(edgeAgentsTable)
      .where(eq(edgeAgentsTable.tenantId, tenantId))
      .orderBy(desc(edgeAgentsTable.createdAt));
    res.json({ agents });
  } catch (err) {
    next(err);
  }
});

// Revoke an agent credential. Provider-only. Revocation takes effect on the
// agent's next call because requireAgent reloads the row every time and rejects
// any status other than active.
tenantsRouter.post("/tenants/:id/agents/:agentId/revoke", async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isProvider(user.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const tenantId = String(req.params.id);
    const agentId = String(req.params.agentId);
    const updated = await db
      .update(edgeAgentsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(edgeAgentsTable.id, agentId), eq(edgeAgentsTable.tenantId, tenantId)))
      .returning({ id: edgeAgentsTable.id });
    if (!updated[0]) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json({ ok: true, agentId, status: "revoked" });
  } catch (err) {
    next(err);
  }
});

// Pipeline runs for a tenant, one per layer, each carrying the nine sub-stage
// states with their per-seat telemetry. This is the window the owner uses to
// confirm the three-model engine actually ran: the confound and challenge
// stages report the grounder seat and its search-call count. The bulky stage
// output is omitted here; fetch a layer to see its content.
tenantsRouter.get("/tenants/:id/runs", requireTenantAccess, async (req, res, next) => {
  try {
    const tenantId = String(req.params.id);
    const runs = await db
      .select()
      .from(tenantPipelineRunsTable)
      .where(eq(tenantPipelineRunsTable.tenantId, tenantId))
      .orderBy(asc(tenantPipelineRunsTable.layerKey));

    res.json({
      runs: runs.map((run) => ({
        id: run.id,
        layerKey: run.layerKey,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
        subStages: run.subStages.map((s) => ({
          name: s.name,
          status: s.status,
          durationMs: s.durationMs,
          error: s.error,
          telemetry: s.telemetry,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// A compact per-layer overview for one tenant: every registry layer left-joined
// with its generated content, projected to the few real fields the Morning Brief
// and Board Pack assemble from. The only computation is honest selection (the
// lead metric, the first action, the highest-lift gap); no figure is derived or
// fabricated. Layers not generated for this tenant return generated:false so the
// surfaces render their designed "not generated" state rather than inventing one.
tenantsRouter.get("/tenants/:id/overview", requireTenantAccess, async (req, res, next) => {
  try {
    const tenantId = String(req.params.id);
    // The authed overview and the public shareable diagnosis project through the
    // same loadTenantOverview, so the two surfaces can never drift.
    res.json({ overview: await loadTenantOverview(tenantId) });
  } catch (err) {
    next(err);
  }
});

// A per-layer SIGNAL projection for one tenant: the real fields the derived
// surfaces (anomaly inbox, dependency map, Ask Different Day, war room) reason
// over. Like /overview it left-joins the registry to generated content and
// projects only persisted values, but it carries the FULL gaps, actions,
// confounders, hypotheses and causes (not just the top of each) plus the
// verified/modelled claim counts. The Morning Brief and Board Pack keep using
// the lighter /overview; these two requests together cover every Phase E
// surface without fanning out fourteen detail fetches. No figure is computed
// here: the derivation lives in pure, unit-tested portal functions.
tenantsRouter.get("/tenants/:id/signals", requireTenantAccess, async (req, res, next) => {
  try {
    const tenantId = String(req.params.id);
    const rows = await db
      .select({
        key: layersTable.key,
        name: layersTable.name,
        moduleGroup: layersTable.moduleGroup,
        feeds: layersTable.feeds,
        sortOrder: layersTable.sortOrder,
        ownerPersona: layersTable.ownerPersona,
        content: tenantLayersTable.content,
        confoundersCol: tenantLayersTable.confounders,
        verifiedClaims: tenantLayersTable.verifiedClaims,
        modelledClaims: tenantLayersTable.modelledClaims,
        generatedAt: tenantLayersTable.generatedAt,
        generatorModel: tenantLayersTable.generatorModel,
      })
      .from(layersTable)
      .leftJoin(
        tenantLayersTable,
        and(
          eq(tenantLayersTable.layerKey, layersTable.key),
          eq(tenantLayersTable.tenantId, tenantId),
        ),
      )
      .orderBy(asc(layersTable.sortOrder));

    res.json({
      signals: rows.map((r) => {
        const c = r.content;
        const verified = r.verifiedClaims as Record<string, unknown> | null;
        const modelled = r.modelledClaims as Record<string, unknown> | null;
        return {
          key: r.key,
          name: r.name,
          moduleGroup: r.moduleGroup,
          feeds: r.feeds,
          sortOrder: r.sortOrder,
          ownerPersona: r.ownerPersona,
          generated: c != null,
          headlineFinding: c ? asString(c.headline_finding) : null,
          headlineImpact: c ? asString(c.headline_impact) : null,
          headlineLever: c ? asString(c.headline_lever) : null,
          confidence: c ? asNumber(c.confidence) : null,
          confidenceGap: c ? asNumber(c.confidence_gap) : null,
          causes: c ? asObjectArray(c.causes).map(projectCause) : [],
          actions: c ? asObjectArray(c.actions).map(projectAction) : [],
          gaps: c ? asObjectArray(c.gaps).map(projectGap) : [],
          hypotheses: c ? asObjectArray(c.hypotheses).map(projectHypothesis) : [],
          confounders: asObjectArray(r.confoundersCol).map(projectConfounder),
          verifiedCount: asObjectArray(verified?.items).length,
          modelledCount: asObjectArray(modelled?.items).length,
          generatedAt: r.generatedAt,
          generatorModel: r.generatorModel,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// The full generated content for one tenant layer, including the genuine
// Confounder output (ranked alternative explanations with verdicts) and the
// verified/modelled claim split.
tenantsRouter.get("/tenants/:id/layers/:key", requireTenantAccess, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const key = String(req.params.key);
    const rows = await db
      .select()
      .from(tenantLayersTable)
      .where(and(eq(tenantLayersTable.tenantId, id), eq(tenantLayersTable.layerKey, key)))
      .limit(1);

    const layer = rows[0];
    if (!layer) {
      res.status(404).json({ error: "Layer not generated for this tenant" });
      return;
    }

    // Phase X: the real cohort benchmark sits ALONGSIDE the modelled peerBenchmark,
    // never replacing it. cohortBenchmark is the verified-cohort distribution (basis
    // "verified_cohort") when the cohort has cleared the k floor; cohortLock is the
    // honest "growing cohort" state below it; both null when the tenant has not
    // opted in. No contributor identity is ever returned.
    const { cohortBenchmark, cohortLock } = await buildLayerCohort(id, key);

    // Phase AJ: a display-only confidence advisory disciplined by this layer's
    // own Brier track record. The raw confidence in content is never overwritten;
    // the advisory carries the adjusted value, the resolved sample, the layer
    // Brier, and an honest label so the portal shows the raw pill until the layer
    // has enough resolved forecasts to earn the disciplined one. Null when the
    // content carries no numeric overall confidence.
    const rawConfidence =
      layer.content !== null &&
      typeof layer.content === "object" &&
      typeof (layer.content as { confidence?: unknown }).confidence === "number"
        ? (layer.content as { confidence: number }).confidence
        : null;
    const confidenceCalibration =
      rawConfidence === null ? null : await computeLayerConfidenceAdvisory(id, key, rawConfidence);

    res.json({
      tenantId: layer.tenantId,
      layerKey: layer.layerKey,
      content: layer.content,
      heroPanel: layer.heroPanel,
      peerBenchmark: layer.peerBenchmark,
      cohortBenchmark,
      cohortLock,
      supplementBlocks: layer.supplementBlocks,
      confounders: layer.confounders,
      verifiedClaims: layer.verifiedClaims,
      modelledClaims: layer.modelledClaims,
      reducedMode: layer.reducedMode,
      generatorModel: layer.generatorModel,
      generatedAt: layer.generatedAt,
      confidenceCalibration,
    });
  } catch (err) {
    next(err);
  }
});

// ── Phase AA: Interactive Challenge (tenant-scoped) ─────────────────────────
// A seat challenges ONE finding in a layer's diagnosis; the engine re-reasons it
// through the Confounder and Synthesist seats and records an append-only verdict
// (uphold-or-revise) plus, on success, one hash-chained provenance entry. The
// user's objection is context, never an override: a challenge can never delete a
// finding, and a revise re-bases the challenge row only, never the layer content.
// requireTenantAccess has already fenced the tenant for the seat.
const challengeSchema = z.object({
  findingRef: z
    .string()
    .regex(/^(causes|actions|hypotheses|metrics)\[\d+\]$/, "invalid_finding_ref"),
  // A challenge is a real objection, not whitespace: bound the raw length, trim,
  // then reject an empty-after-trim body so a blank submission never spends a
  // model call or stores a meaningless row.
  challengeText: z
    .string()
    .min(1)
    .max(2000)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "empty_challenge"),
});

tenantsRouter.post(
  "/tenants/:id/layers/:key/challenges",
  requireTenantAccess,
  async (req, res, next) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    // A client-viewer is a read-only seat: it reads the challenge history but
    // never spends model calls to challenge a finding, the same posture as
    // committing an action.
    if (user.role === "client-viewer") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const result = await runFindingChallenge({
        tenantId: String(req.params.id),
        layerKey: String(req.params.key),
        findingRef: parsed.data.findingRef,
        challengeText: parsed.data.challengeText,
        userId: user.id,
        log: logger,
      });
      if (result.kind === "layer_not_found") {
        res.status(404).json({ error: "layer_not_found" });
        return;
      }
      if (result.kind === "finding_not_found") {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }
      if (result.kind === "profile_missing") {
        res.status(409).json({ error: "profile_missing" });
        return;
      }
      // Return the SAME serialized contract the history does, with this seat's
      // email as the challenger. The challenge was just recorded against the live
      // finding and never mutates the layer content, so it is the current version.
      res.status(201).json({
        challenge: serializeChallenge(result.challenge, user.email, true),
      });
    } catch (err) {
      next(err);
    }
  },
);

// The tenant's challenge history, newest first, each annotated with whether it
// still addresses the live version of its finding.
tenantsRouter.get(
  "/tenants/:id/challenges",
  requireTenantAccess,
  async (req, res, next) => {
    try {
      const challenges = await listFindingChallenges(String(req.params.id));
      res.json({ challenges });
    } catch (err) {
      next(err);
    }
  },
);

// ── Phase X: per-tenant benchmark consent (tenant-scoped) ───────────────────
// Reading and changing a tenant's participation in the data network is a
// tenant-scoped action: requireTenantAccess has already fenced the tenant for
// the seat. Consent is default-off and every change is logged to an append-only
// audit, so "consent state is logged" is structural, not a promise.
tenantsRouter.get(
  "/tenants/:id/benchmark-consent",
  requireTenantAccess,
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const rows = await db
        .select({ optIn: tenantsTable.benchmarkOptIn })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, id))
        .limit(1);
      if (!rows[0]) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      // The consent audit for this tenant, newest first. It carries who changed
      // the state and why, never any benchmark figure.
      const events = await db
        .select()
        .from(benchmarkConsentEventsTable)
        .where(eq(benchmarkConsentEventsTable.tenantId, id))
        .orderBy(desc(benchmarkConsentEventsTable.createdAt));
      res.json({ optIn: rows[0].optIn, events });
    } catch (err) {
      next(err);
    }
  },
);

const benchmarkConsentSchema = z.object({
  optIn: z.boolean(),
  reason: z.string().max(2000).optional(),
});

// Set a tenant's benchmark participation. A client-viewer is a read-only seat and
// cannot change consent (the same posture as committing an action). The opt state
// and the audit row are written in ONE transaction, and an unchanged state writes
// no audit row (honest: nothing changed).
tenantsRouter.post(
  "/tenants/:id/benchmark-consent",
  requireTenantAccess,
  async (req, res, next) => {
    const parsed = benchmarkConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (user.role === "client-viewer") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const id = String(req.params.id);
      const next_ = parsed.data.optIn;
      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select({ optIn: tenantsTable.benchmarkOptIn })
          .from(tenantsTable)
          .where(eq(tenantsTable.id, id))
          .limit(1);
        const current = rows[0];
        if (!current) return { notFound: true as const };
        if (current.optIn === next_) {
          // No change: do not write a spurious audit row.
          return { optIn: current.optIn, changed: false as const };
        }
        await tx
          .update(tenantsTable)
          .set({ benchmarkOptIn: next_ })
          .where(eq(tenantsTable.id, id));
        await tx.insert(benchmarkConsentEventsTable).values({
          tenantId: id,
          action: next_ ? "opt_in" : "opt_out",
          authorityUserId: user.id,
          authorityRole: user.role,
          reason: parsed.data.reason ?? null,
        });
        return { optIn: next_, changed: true as const };
      });
      if ("notFound" in result) {
        res.status(404).json({ error: "tenant_not_found" });
        return;
      }
      logger.info(
        { tenantId: id, optIn: result.optIn, changed: result.changed, authorityUserId: user.id },
        "benchmark consent set",
      );
      res.json({ optIn: result.optIn, changed: result.changed });
    } catch (err) {
      next(err);
    }
  },
);

// The body of a commit: the real action fields captured from the layer at the
// moment a user commits to it. predictedImpact, basis and confidence come
// straight from the generated action so the track record cannot drift from what
// the intelligence said.
const commitActionSchema = z.object({
  layerKey: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  detail: z.string().max(4000).optional(),
  predictedImpact: z.string().max(1000).optional(),
  timing: z.string().max(200).optional(),
  owner: z.string().max(200).optional(),
  basis: z.enum(["verified", "modelled"]),
  confidence: z.number().int().min(0).max(100),
  // Optional, connected-mode only: name a derived signal to snapshot as the
  // baseline this action sets out to move. The route only snapshots it when a
  // real scalar signal exists; outside-in commits leave the baseline null.
  baselineSignalKey: z.string().min(1).max(200).optional(),
  baselineWindow: z.string().min(1).max(200).optional(),
  // Optional, Phase AJ: explicitly bind this commit to the action_outcome
  // forecast it acts on, by the forecast's own id or its (layer, sourcePath)
  // anchor. The link is always explicit so a forecast resolves against the
  // action a user actually committed, never one inferred from a matching title.
  forecastId: z.string().uuid().optional(),
  forecastSourcePath: z.string().min(1).max(200).optional(),
});

const updateActionStatusSchema = z.object({
  status: z.enum(["committed", "in_progress", "done", "dismissed"]),
  note: z.string().max(2000).optional(),
});

// Commit an action from a layer to the tenant's track record. There is no
// fabricated outcome here: the action starts in the "committed" state and a
// human advances it. Outcome verification against actuals is a later phase.
tenantsRouter.post("/tenants/:id/actions", requireTenantAccess, async (req, res, next) => {
  const parsed = commitActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  // A client-viewer is a read-only seat: it sees the track record but never
  // writes to it. Provider roles and a client-admin acting on their own tenant
  // may commit; requireTenantAccess has already fenced the tenant for the seat.
  if (user.role === "client-viewer") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const d = parsed.data;
    const tenantId = String(req.params.id);
    // Snapshot the numeric prediction from the real impact string. Null when the
    // impact carries no parseable dollar figure; the platform never invents one.
    const predicted = parsePredictedValueUsd(d.predictedImpact);
    // Snapshot the baseline metric only when a real scalar derived signal is
    // named and present (connected mode). Otherwise the baseline stays null,
    // which is the honest state for an outside-in tenant.
    let baselineMetric: string | null = null;
    let baselineAt: Date | null = null;
    if (d.baselineSignalKey) {
      const signalRows = await db
        .select()
        .from(derivedSignalsTable)
        .where(
          and(
            eq(derivedSignalsTable.tenantId, tenantId),
            eq(derivedSignalsTable.layerKey, d.layerKey),
            eq(derivedSignalsTable.signalKey, d.baselineSignalKey),
            ...(d.baselineWindow ? [eq(derivedSignalsTable.window, d.baselineWindow)] : []),
          ),
        )
        .orderBy(desc(derivedSignalsTable.computedAt))
        .limit(1);
      const row = signalRows[0];
      // A baseline must be a single finite number. An encrypted envelope or a
      // numeric vector is not a scalar baseline, so it is left null rather than
      // coerced.
      if (row && typeof row.value === "number" && Number.isFinite(row.value)) {
        baselineMetric = String(row.value);
        baselineAt = row.computedAt;
      }
    }
    const inserted = await db
      .insert(committedActionsTable)
      .values({
        tenantId,
        layerKey: d.layerKey,
        title: d.title,
        detail: d.detail ?? null,
        predictedImpact: d.predictedImpact ?? null,
        predictedValueUsd: predicted === null ? null : predicted.toFixed(2),
        baselineMetric,
        baselineAt,
        timing: d.timing ?? null,
        actionOwner: d.owner ?? null,
        basis: d.basis,
        confidence: d.confidence,
        committedBy: user.id,
      })
      .returning();
    const action = inserted[0];
    // Phase AJ: bind the action_outcome forecast to this committed action when
    // the client named one explicitly. The link is what lets a later outcome
    // measurement resolve the forecast and score it; an unbound commit simply
    // leaves the forecast resolvable by owner adjudication.
    let linkedForecastId: string | null = null;
    if (d.forecastId || d.forecastSourcePath) {
      linkedForecastId = await linkForecastToCommittedAction({
        tenantId,
        actionId: action.id,
        layerKey: d.layerKey,
        forecastId: d.forecastId ?? null,
        sourcePath: d.forecastSourcePath ?? null,
      });
    }
    res.status(201).json({ action, linkedForecastId });
  } catch (err) {
    next(err);
  }
});

// The tenant's committed actions, newest first: the track record of every
// action a user committed, each with its predicted recovery and its honest
// current state.
tenantsRouter.get("/tenants/:id/actions", requireTenantAccess, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(committedActionsTable)
      .where(eq(committedActionsTable.tenantId, String(req.params.id)))
      .orderBy(desc(committedActionsTable.committedAt));
    res.json({ actions: rows });
  } catch (err) {
    next(err);
  }
});

// Advance a committed action through its honest lifecycle. This records the
// human's progress, not a fabricated result.
tenantsRouter.post(
  "/tenants/:id/actions/:actionId/status",
  requireTenantAccess,
  async (req, res, next) => {
    const parsed = updateActionStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    // Advancing an action is a write; a client-viewer is read-only here too.
    if (user.role === "client-viewer") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const updated = await db
        .update(committedActionsTable)
        .set({ status: parsed.data.status, note: parsed.data.note ?? null })
        .where(
          and(
            eq(committedActionsTable.id, String(req.params.actionId)),
            eq(committedActionsTable.tenantId, String(req.params.id)),
          ),
        )
        .returning();
      if (updated.length === 0) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ action: updated[0] });
    } catch (err) {
      next(err);
    }
  },
);

// The body of a measurement: what an action actually realized. At least one of a
// realized dollar value, an observed metric, or a signal to read must be present;
// an empty measurement records nothing. "final" marks the closing measurement,
// the only one that can grade an action as a miss.
const recordMeasurementSchema = z
  .object({
    realizedValueUsd: z.number().finite().optional(),
    actualMetric: z.number().finite().optional(),
    signalKey: z.string().min(1).max(200).optional(),
    window: z.string().min(1).max(200).optional(),
    note: z.string().max(2000).optional(),
    final: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.realizedValueUsd !== undefined || b.actualMetric !== undefined || b.signalKey !== undefined,
    { message: "empty_measurement" },
  );

// Record a measurement against a committed action. This is a provider action:
// only a provider seat grades the track record. The basis is "measured" only
// when a real scalar derived signal backs the metric; an operator estimate is
// "modelled" and is never presented as measured fact. The status and variance
// are derived from the numbers here, never accepted from the client.
tenantsRouter.post(
  "/tenants/:id/actions/:actionId/measurements",
  requireTenantAccess,
  async (req, res, next) => {
    const parsed = recordMeasurementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!isProvider(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const tenantId = String(req.params.id);
      const actionId = String(req.params.actionId);
      const actionRows = await db
        .select()
        .from(committedActionsTable)
        .where(
          and(
            eq(committedActionsTable.id, actionId),
            eq(committedActionsTable.tenantId, tenantId),
          ),
        )
        .limit(1);
      const action = actionRows[0];
      if (!action) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const d = parsed.data;
      let basis: "measured" | "modelled" = "modelled";
      let actualMetric: number | null = d.actualMetric ?? null;
      if (d.signalKey) {
        const signalRows = await db
          .select()
          .from(derivedSignalsTable)
          .where(
            and(
              eq(derivedSignalsTable.tenantId, tenantId),
              eq(derivedSignalsTable.layerKey, action.layerKey),
              eq(derivedSignalsTable.signalKey, d.signalKey),
              ...(d.window ? [eq(derivedSignalsTable.window, d.window)] : []),
            ),
          )
          .orderBy(desc(derivedSignalsTable.computedAt))
          .limit(1);
        const sig = signalRows[0];
        // A measured basis is only honest when a real scalar signal backs it. A
        // missing signal, an encrypted envelope, or a vector is rejected rather
        // than silently downgraded to a modelled estimate the caller did not ask
        // for.
        if (!sig || typeof sig.value !== "number" || !Number.isFinite(sig.value)) {
          res.status(400).json({ error: "signal_not_found" });
          return;
        }
        actualMetric = sig.value;
        basis = "measured";
      }

      const predicted = toNum(action.predictedValueUsd);
      const realized = d.realizedValueUsd ?? null;
      const final = d.final ?? false;
      const status = deriveMeasurementStatus({
        predictedValueUsd: predicted,
        realizedValueUsd: realized,
        final,
      });
      const variance = computeVariance(realized, predicted);

      const inserted = await db
        .insert(outcomeMeasurementsTable)
        .values({
          actionId,
          actualMetric: actualMetric === null ? null : String(actualMetric),
          realizedValueUsd: realized === null ? null : realized.toFixed(2),
          varianceVsPrediction: variance === null ? null : variance.toFixed(2),
          basis,
          status,
          note: d.note ?? null,
          recordedBy: user.id,
        })
        .returning();
      const measurement = inserted[0];
      // Phase AJ: a terminal measurement (realized or missed) resolves every
      // open forecast bound to this action and scores it. A pending or on_track
      // measurement resolves nothing, so a forecast is never graded on a guess.
      const resolvedForecasts = await resolveForecastsForMeasurement({
        actionId,
        measurementId: measurement.id,
        status,
        basis,
      });
      res.status(201).json({ measurement, resolvedForecasts });
    } catch (err) {
      next(err);
    }
  },
);

// The measurements recorded against one action, newest first. A read scoped to
// the tenant; the action must belong to it.
tenantsRouter.get(
  "/tenants/:id/actions/:actionId/measurements",
  requireTenantAccess,
  async (req, res, next) => {
    try {
      const tenantId = String(req.params.id);
      const actionId = String(req.params.actionId);
      const actionRows = await db
        .select({ id: committedActionsTable.id })
        .from(committedActionsTable)
        .where(
          and(
            eq(committedActionsTable.id, actionId),
            eq(committedActionsTable.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!actionRows[0]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rows = await db
        .select()
        .from(outcomeMeasurementsTable)
        .where(eq(outcomeMeasurementsTable.actionId, actionId))
        .orderBy(desc(outcomeMeasurementsTable.measuredAt));
      res.json({ measurements: rows });
    } catch (err) {
      next(err);
    }
  },
);

// The tenant's outcome summary: cumulative value identified versus value
// realized, plus the simple calibration grade, and the measurements behind them.
// Every figure is computed from persisted rows, so it reconciles exactly to a
// direct database sum.
tenantsRouter.get("/tenants/:id/outcomes", requireTenantAccess, async (req, res, next) => {
  try {
    const tenantId = String(req.params.id);
    const actionRows = await db
      .select({
        id: committedActionsTable.id,
        predictedValueUsd: committedActionsTable.predictedValueUsd,
        status: committedActionsTable.status,
      })
      .from(committedActionsTable)
      .where(eq(committedActionsTable.tenantId, tenantId));

    const measurementRows = await db
      .select({
        id: outcomeMeasurementsTable.id,
        actionId: outcomeMeasurementsTable.actionId,
        actualMetric: outcomeMeasurementsTable.actualMetric,
        realizedValueUsd: outcomeMeasurementsTable.realizedValueUsd,
        varianceVsPrediction: outcomeMeasurementsTable.varianceVsPrediction,
        basis: outcomeMeasurementsTable.basis,
        status: outcomeMeasurementsTable.status,
        note: outcomeMeasurementsTable.note,
        measuredAt: outcomeMeasurementsTable.measuredAt,
        createdAt: outcomeMeasurementsTable.createdAt,
      })
      .from(outcomeMeasurementsTable)
      .innerJoin(
        committedActionsTable,
        eq(outcomeMeasurementsTable.actionId, committedActionsTable.id),
      )
      .where(eq(committedActionsTable.tenantId, tenantId))
      .orderBy(desc(outcomeMeasurementsTable.measuredAt));

    const summary = computeOutcomeSummary(
      actionRows.map((a) => ({
        id: a.id,
        predictedValueUsd: toNum(a.predictedValueUsd),
        status: a.status,
      })),
      measurementRows.map((m) => ({
        actionId: m.actionId,
        realizedValueUsd: toNum(m.realizedValueUsd),
        status: m.status,
        measuredAt: m.measuredAt.getTime(),
        createdAt: m.createdAt.getTime(),
      })),
    );
    res.json({ outcomes: { summary, measurements: measurementRows } });
  } catch (err) {
    next(err);
  }
});

// A tenant summary plus its stored profile, handy for confirming the profile
// stage populated the shell from real homepage ground truth.
tenantsRouter.get("/tenants/:id", requireTenantAccess, async (req, res, next) => {
  try {
    const tenantId = String(req.params.id);
    const rows = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    const tenant = rows[0];
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const profileRows = await db
      .select({ profile: tenantProfileTable.profile })
      .from(tenantProfileTable)
      .where(eq(tenantProfileTable.tenantId, tenantId))
      .limit(1);

    res.json({ tenant, profile: profileRows[0]?.profile ?? null });
  } catch (err) {
    next(err);
  }
});

// Defensive projectors for the signals endpoint. asString, asNumber,
// asObjectArray and asBasis are shared with the overview builder and imported
// from lib/overview/overviewProjection; asGapKind and asVerdict are
// signals-specific. A malformed value becomes null rather than a fabricated
// stand-in.
function asGapKind(v: unknown): "DATA" | "SIGNAL" | "INTEG" | "MODEL" | "FLOW" | null {
  return v === "DATA" || v === "SIGNAL" || v === "INTEG" || v === "MODEL" || v === "FLOW" ? v : null;
}
function asVerdict(v: unknown): "ruled_out" | "partial" | "unresolved" | null {
  return v === "ruled_out" || v === "partial" || v === "unresolved" ? v : null;
}

// Full-array projectors for the signals endpoint. Each maps one stored jsonb
// item to its real fields, nulling anything malformed rather than inventing a
// stand-in. snake_case stored keys become camelCase on the wire.
function projectGap(g: Record<string, unknown>) {
  return {
    kind: asGapKind(g.kind),
    description: asString(g.description),
    closes: asString(g.closes),
    confidenceLiftPp: asNumber(g.confidence_lift_pp),
  };
}
function projectAction(a: Record<string, unknown>) {
  return {
    title: asString(a.title),
    impact: asString(a.impact),
    timing: asString(a.timing),
    owner: asString(a.owner),
    basis: asBasis(a.basis),
    confidence: asNumber(a.confidence),
  };
}
function projectCause(c: Record<string, unknown>) {
  return {
    title: asString(c.title),
    impact: asString(c.impact),
    confidence: asNumber(c.confidence),
    basis: asBasis(c.basis),
  };
}
function projectHypothesis(h: Record<string, unknown>) {
  return {
    statement: asString(h.statement),
    confidence: asNumber(h.confidence),
    basis: asBasis(h.basis),
  };
}
function projectConfounder(c: Record<string, unknown>) {
  return {
    rank: asNumber(c.rank),
    name: asString(c.name),
    mechanism: asString(c.mechanism),
    directionalImpact: asString(c.directional_impact),
    verdict: asVerdict(c.verdict),
    reason: asString(c.reason),
  };
}

