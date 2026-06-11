import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { db, tenantLayersTable, tenantPipelineRunsTable, tenantProfileTable, tenantsTable } from "@workspace/db";
import { requireTenantAccess } from "../middleware/auth";

export const tenantsRouter: Router = Router();

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
      generatorModel: layer.generatorModel,
      generatedAt: layer.generatedAt,
    });
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
