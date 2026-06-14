import { and, asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import {
  committedActionsTable,
  db,
  edgeAgentsTable,
  layersTable,
  orgTenantsTable,
  tenantLayersTable,
  tenantPipelineRunsTable,
  tenantProfileTable,
  tenantsTable,
} from "@workspace/db";
import { z } from "zod";
import { createAgentCredential } from "../lib/agent/agentCredential";
import { isOwner, isProvider } from "../lib/auth/access";
import { logger } from "../lib/logger";
import { assertSeedWithinBudget, BudgetExceededError } from "../lib/pipeline/budget";
import { seedTenant } from "../lib/pipeline/orchestrator";
import { requireTenantAccess } from "../middleware/auth";

export const tenantsRouter: Router = Router();

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
    void seedTenant(url, { log: logger, mode, priorityOverride }).catch((err) => {
      logger.error(
        { url, err: err instanceof Error ? err.message : String(err) },
        "background tenant seed failed",
      );
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
    void seedTenant(tenant.url, { log: logger, mode, priorityOverride }).catch((err) => {
      logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "background tenant refresh failed",
      );
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
    const rows = await db
      .select({
        key: layersTable.key,
        name: layersTable.name,
        archetype: layersTable.archetype,
        ownerPersona: layersTable.ownerPersona,
        moduleGroup: layersTable.moduleGroup,
        sortOrder: layersTable.sortOrder,
        diagnosticQuestion: layersTable.diagnosticQuestion,
        feeds: layersTable.feeds,
        content: tenantLayersTable.content,
        heroPanel: tenantLayersTable.heroPanel,
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
      overview: rows.map((r) => {
        const c = r.content;
        const metrics = c ? asObjectArray(c.metrics) : [];
        const actions = c ? asObjectArray(c.actions) : [];
        const gaps = c ? asObjectArray(c.gaps) : [];
        const lead = metrics[0];
        const action = actions[0];
        const hp = r.heroPanel;
        return {
          key: r.key,
          name: r.name,
          archetype: r.archetype,
          ownerPersona: r.ownerPersona,
          moduleGroup: r.moduleGroup,
          sortOrder: r.sortOrder,
          diagnosticQuestion: r.diagnosticQuestion,
          feeds: r.feeds,
          generated: c != null,
          headlineFinding: c ? asString(c.headline_finding) : null,
          headlineImpact: c ? asString(c.headline_impact) : null,
          headlineLever: c ? asString(c.headline_lever) : null,
          narrative: c ? asString(c.narrative) : null,
          confidence: c ? asNumber(c.confidence) : null,
          confidenceGap: c ? asNumber(c.confidence_gap) : null,
          leadMetric: lead
            ? {
                label: asString(lead.label),
                value: asString(lead.value),
                sub: asString(lead.sub),
                tone: asTone(lead.tone),
              }
            : null,
          hero: hp
            ? {
                metricLabel: asString(hp.metric_label),
                metricValue: asString(hp.metric_value),
                metricSub: asString(hp.metric_sub),
                tone: asTone(hp.tone),
                oneLineRead: asString(hp.one_line_read),
              }
            : null,
          topAction: action
            ? {
                title: asString(action.title),
                impact: asString(action.impact),
                timing: asString(action.timing),
                confidence: asNumber(action.confidence),
                basis: asBasis(action.basis),
              }
            : null,
          topGap: pickTopGap(gaps),
          generatedAt: r.generatedAt,
          generatorModel: r.generatorModel,
        };
      }),
    });
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

    res.json({
      tenantId: layer.tenantId,
      layerKey: layer.layerKey,
      content: layer.content,
      heroPanel: layer.heroPanel,
      peerBenchmark: layer.peerBenchmark,
      supplementBlocks: layer.supplementBlocks,
      confounders: layer.confounders,
      verifiedClaims: layer.verifiedClaims,
      modelledClaims: layer.modelledClaims,
      reducedMode: layer.reducedMode,
      generatorModel: layer.generatorModel,
      generatedAt: layer.generatedAt,
    });
  } catch (err) {
    next(err);
  }
});

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
  try {
    const d = parsed.data;
    const inserted = await db
      .insert(committedActionsTable)
      .values({
        tenantId: String(req.params.id),
        layerKey: d.layerKey,
        title: d.title,
        detail: d.detail ?? null,
        predictedImpact: d.predictedImpact ?? null,
        timing: d.timing ?? null,
        actionOwner: d.owner ?? null,
        basis: d.basis,
        confidence: d.confidence,
        committedBy: user.id,
      })
      .returning();
    res.status(201).json({ action: inserted[0] });
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

// Defensive projectors for the overview endpoint. The stored content is jsonb,
// so each field is validated before it is surfaced: a malformed value becomes
// null rather than a fabricated stand-in.
function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? (v.filter((x) => x != null && typeof x === "object") as Record<string, unknown>[])
    : [];
}
function asTone(v: unknown): "good" | "warn" | "bad" | "neutral" | null {
  return v === "good" || v === "warn" || v === "bad" || v === "neutral" ? v : null;
}
function asBasis(v: unknown): "verified" | "modelled" | null {
  return v === "verified" || v === "modelled" ? v : null;
}
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

// The single highest-lift gap is the layer's biggest blind spot. Selection by a
// real persisted field (confidence_lift_pp), never a computed score.
function pickTopGap(gaps: Record<string, unknown>[]) {
  let best: {
    kind: unknown;
    description: string | null;
    closes: string | null;
    confidenceLiftPp: number | null;
  } | null = null;
  let bestLift = -Infinity;
  for (const g of gaps) {
    const lift = asNumber(g.confidence_lift_pp) ?? 0;
    if (lift > bestLift) {
      bestLift = lift;
      best = {
        kind: g.kind,
        description: asString(g.description),
        closes: asString(g.closes),
        confidenceLiftPp: asNumber(g.confidence_lift_pp),
      };
    }
  }
  return best;
}
