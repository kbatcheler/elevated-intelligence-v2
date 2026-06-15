import { asc, eq, like, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, layersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  buildCustomLayerRow,
  customLayerTemplateSchema,
  runnableLayerCondition,
  slugifyLayerKey,
} from "../lib/layers/customLayer";
import { requireOwner } from "../middleware/auth";

export const layersRouter: Router = Router();

// The shared catalog projection, so every layer-listing surface returns the same
// shape the portal already renders.
const layerCatalogColumns = {
  key: layersTable.key,
  name: layersTable.name,
  description: layersTable.description,
  archetype: layersTable.archetype,
  heroDescription: layersTable.heroDescription,
  diagnosticQuestion: layersTable.diagnosticQuestion,
  ownerPersona: layersTable.ownerPersona,
  metricDefinitions: layersTable.metricDefinitions,
  rootCauses: layersTable.rootCauses,
  actions: layersTable.actions,
  gaps: layersTable.gaps,
  feeds: layersTable.feeds,
  moduleGroup: layersTable.moduleGroup,
  sortOrder: layersTable.sortOrder,
};

// The registry is the single source of truth for layer identity. The portal,
// pipeline and prompts all read it; nothing branches on a hardcoded layer list.
// This endpoint exposes the RUNNABLE registry to the portal: the canonical 14
// plus any owner-approved custom layer. An unapproved custom layer is withheld
// here exactly as loadRegistry withholds it from the seed fan-out (Phase AG), so
// the catalog never lists a layer that has produced no per-tenant output.
layersRouter.get("/layers", async (_req, res, next) => {
  try {
    const layers = await db
      .select(layerCatalogColumns)
      .from(layersTable)
      .where(runnableLayerCondition())
      .orderBy(asc(layersTable.sortOrder));
    res.json({ layers });
  } catch (err) {
    next(err);
  }
});

// Owner-only: the custom-layer console (Phase AG). Lists every custom layer
// (isCanonical false) with its approval state and benchmark mapping, so the owner
// can see what is pending and what is live. requireAuth runs at the /api mount;
// requireOwner gates the curated-creation surface here, mirroring the retention
// router. The canonical 14 are never listed here: they are immutable and have no
// approval lifecycle.
layersRouter.get("/layers/custom", requireOwner, async (_req, res, next) => {
  try {
    const layers = await db
      .select({
        ...layerCatalogColumns,
        isCanonical: layersTable.isCanonical,
        approvedAt: layersTable.approvedAt,
        approvedBy: layersTable.approvedBy,
        benchmarkCanonicalKey: layersTable.benchmarkCanonicalKey,
        createdAt: layersTable.createdAt,
      })
      .from(layersTable)
      .where(eq(layersTable.isCanonical, false))
      .orderBy(asc(layersTable.sortOrder));
    res.json({ layers });
  } catch (err) {
    next(err);
  }
});

// Allocate a globally unique, ASCII-only layer key from a display name. The key
// is the registry primary key, so a collision (including with a canonical key) is
// resolved by suffixing -2, -3, ... rather than failing the create. The candidate
// loop is bounded by the number of keys already sharing the base.
async function allocateLayerKey(name: string): Promise<string> {
  const base = slugifyLayerKey(name) || "custom-layer";
  const existing = await db
    .select({ key: layersTable.key })
    .from(layersTable)
    .where(or(eq(layersTable.key, base), like(layersTable.key, `${base}-%`)));
  const taken = new Set(existing.map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= taken.size + 2; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable: taken holds at most taken.size keys, so one of the first
  // taken.size + 1 suffixes is always free. Suffix with a timestamp as a loud,
  // still-unique last resort rather than returning a duplicate.
  return `${base}-${Date.now()}`;
}

// Owner-only: create a custom layer from the guarded template (Phase AG). The
// template collects only the high-signal fields; the row is built with honest
// empty defaults for the rest, deep-stripped of long dashes, and persisted as an
// UNAPPROVED custom layer (isCanonical false, approvedAt null) so it does not run
// until the owner approves it. A benchmarkCanonicalKey, when supplied, must point
// at an existing canonical layer.
layersRouter.post("/layers", requireOwner, async (req, res, next) => {
  try {
    const parsed = customLayerTemplateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
      return;
    }
    const template = parsed.data;

    if (template.benchmarkCanonicalKey) {
      const target = await db
        .select({ key: layersTable.key, isCanonical: layersTable.isCanonical })
        .from(layersTable)
        .where(eq(layersTable.key, template.benchmarkCanonicalKey))
        .limit(1);
      if (!target[0] || !target[0].isCanonical) {
        res.status(400).json({
          error: "invalid_benchmark_canonical_key",
          detail: "benchmarkCanonicalKey must reference an existing canonical layer",
        });
        return;
      }
    }

    const key = await allocateLayerKey(template.name);
    const maxRows = await db
      .select({ max: sql<number>`coalesce(max(${layersTable.sortOrder}), 0)` })
      .from(layersTable);
    const sortOrder = Number(maxRows[0]?.max ?? 0) + 1;

    const row = buildCustomLayerRow({ template, key, sortOrder });
    const inserted = await db
      .insert(layersTable)
      .values(row)
      .returning({
        key: layersTable.key,
        name: layersTable.name,
        archetype: layersTable.archetype,
        isCanonical: layersTable.isCanonical,
        approvedAt: layersTable.approvedAt,
        benchmarkCanonicalKey: layersTable.benchmarkCanonicalKey,
        sortOrder: layersTable.sortOrder,
      });
    const created = inserted[0]!;
    logger.info(
      { key: created.key, authorityUserId: req.user!.id },
      "custom layer created (pending approval)",
    );
    res.status(201).json({ layer: created });
  } catch (err) {
    next(err);
  }
});

const approveParamsSchema = z.object({ key: z.string().min(1) });

// Owner-only: approve a pending custom layer (Phase AG). Approval is the gate that
// lets a custom layer enter the seed fan-out (loadRegistry includes it once
// approvedAt is set), and it records which owner authorized the first run. A
// canonical layer is approved by definition and is rejected here; an already
// approved layer returns idempotently.
layersRouter.post("/layers/:key/approve", requireOwner, async (req, res, next) => {
  try {
    const params = approveParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", detail: params.error.message });
      return;
    }
    const key = params.data.key;
    const rows = await db
      .select({
        key: layersTable.key,
        isCanonical: layersTable.isCanonical,
        approvedAt: layersTable.approvedAt,
      })
      .from(layersTable)
      .where(eq(layersTable.key, key))
      .limit(1);
    const layer = rows[0];
    if (!layer) {
      res.status(404).json({ error: "layer_not_found" });
      return;
    }
    if (layer.isCanonical) {
      res.status(400).json({
        error: "only_custom_layers_require_approval",
        detail: "canonical layers are approved by definition",
      });
      return;
    }
    if (layer.approvedAt) {
      res.json({
        layer: { key: layer.key, approvedAt: layer.approvedAt, alreadyApproved: true },
      });
      return;
    }
    const updated = await db
      .update(layersTable)
      .set({ approvedAt: new Date(), approvedBy: req.user!.id })
      .where(eq(layersTable.key, key))
      .returning({
        key: layersTable.key,
        approvedAt: layersTable.approvedAt,
        approvedBy: layersTable.approvedBy,
      });
    logger.info({ key, authorityUserId: req.user!.id }, "custom layer approved");
    res.json({ layer: updated[0] });
  } catch (err) {
    next(err);
  }
});
