// Phase AJ forecast resolution. The single writer of a forecast's outcome,
// Brier score, and resolution basis. A forecast resolves exactly one of two
// honest ways: automatically, from a real outcome measurement on the committed
// action it was linked to (connected mode), or by an explicit owner
// adjudication (otherwise). Nothing here ever resolves a forecast on a guess: a
// non-terminal measurement leaves it open, and the link between a forecast and
// an action is always explicit, never inferred from matching titles.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db, forecastsTable, type ForecastRow } from "@workspace/db";
import { stripDashes } from "@workspace/cortex";
import { brierScore } from "./brierMath";

// A database transaction handle, as drizzle hands it to a `db.transaction`
// callback. Typed structurally so the forecast link can run inside a caller's
// transaction (the Phase AL commit, which binds the forecast and writes the
// decision record atomically) without importing drizzle's internal tx type.
type ForecastTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Map an outcome measurement's derived status to a binary forecast outcome. Only
// a terminal status resolves a forecast: a realized action resolves its outcome
// forecast TRUE (1), a missed action resolves it FALSE (0). A pending or
// on_track action leaves the forecast open and unscored. This grades a forecast
// against the ground truth the measurement already established (measured or
// modelled); there is no probability and no verdict string in play, so it is not
// a verdict-to-probability mapping.
export function outcomeFromMeasurementStatus(status: string): 0 | 1 | null {
  if (status === "realized") return 1;
  if (status === "missed") return 0;
  return null;
}

// Link an action_outcome forecast to the committed action it predicts, by an
// EXPLICIT reference only: the forecast's own id, or its (layer, sourcePath)
// anchor. Titles are never matched, so a renamed action or a coincidental title
// collision can never silently bind the wrong prediction. Only an unlinked,
// unresolved forecast is eligible; the most recent matching one wins when an
// anchor is reused. Returns the linked forecast id, or null when nothing
// eligible matched.
export async function linkForecastToCommittedActionTx(
  tx: ForecastTx,
  args: {
    tenantId: string;
    actionId: string;
    layerKey: string;
    forecastId?: string | null;
    sourcePath?: string | null;
  },
): Promise<string | null> {
  const { tenantId, actionId, layerKey, forecastId, sourcePath } = args;
  const conditions = [
    eq(forecastsTable.tenantId, tenantId),
    eq(forecastsTable.kind, "action_outcome"),
    isNull(forecastsTable.committedActionId),
    isNull(forecastsTable.resolvedAt),
  ];
  if (forecastId) {
    conditions.push(eq(forecastsTable.id, forecastId));
  } else if (sourcePath) {
    conditions.push(eq(forecastsTable.layerKey, layerKey));
    conditions.push(eq(forecastsTable.sourcePath, sourcePath));
  } else {
    return null;
  }
  const candidates = await tx
    .select({ id: forecastsTable.id })
    .from(forecastsTable)
    .where(and(...conditions))
    .orderBy(desc(forecastsTable.madeAt))
    .limit(1);
  const target = candidates[0];
  if (!target) return null;
  await tx
    .update(forecastsTable)
    .set({ committedActionId: actionId })
    .where(and(eq(forecastsTable.id, target.id), isNull(forecastsTable.committedActionId)));
  return target.id;
}

// Link in its own transaction, for callers (the original commit path before the
// decision record, and any caller that needs no broader atomic scope) that are
// not already inside one.
export async function linkForecastToCommittedAction(args: {
  tenantId: string;
  actionId: string;
  layerKey: string;
  forecastId?: string | null;
  sourcePath?: string | null;
}): Promise<string | null> {
  return db.transaction((tx) => linkForecastToCommittedActionTx(tx, args));
}

// Resolve every still-open forecast linked to a committed action, from the
// measurement just recorded against it. A non-terminal measurement (pending or
// on_track) resolves nothing and returns 0. The Brier score is computed from the
// stored probability and the realised outcome and persisted so the aggregates
// stay a plain sum. The basis mirrors the measurement's own basis, so a forecast
// resolved from a modelled estimate is never presented as measured fact.
export async function resolveForecastsForMeasurement(args: {
  actionId: string;
  measurementId: string;
  status: string;
  basis: "measured" | "modelled";
}): Promise<number> {
  const outcome = outcomeFromMeasurementStatus(args.status);
  if (outcome === null) return 0;
  const open = await db
    .select({ id: forecastsTable.id, probability: forecastsTable.probability })
    .from(forecastsTable)
    .where(
      and(eq(forecastsTable.committedActionId, args.actionId), isNull(forecastsTable.resolvedAt)),
    );
  if (open.length === 0) return 0;
  const now = new Date();
  let resolved = 0;
  for (const f of open) {
    const score = brierScore(Number(f.probability), outcome);
    const updated = await db
      .update(forecastsTable)
      .set({
        outcome,
        resolvedAt: now,
        brierScore: String(score),
        resolutionBasis: args.basis,
        outcomeMeasurementId: args.measurementId,
      })
      .where(and(eq(forecastsTable.id, f.id), isNull(forecastsTable.resolvedAt)))
      .returning({ id: forecastsTable.id });
    if (updated[0]) resolved += 1;
  }
  return resolved;
}

export type OwnerResolveResult =
  | { ok: true; forecast: ForecastRow }
  | { ok: false; reason: "not_found" | "already_resolved" };

// Resolve a forecast by owner adjudication. The owner supplies the realised
// outcome directly; the Brier score is computed here from the stored
// probability, never accepted from the client. Only an unresolved forecast can
// be adjudicated, and the update is guarded by the same unresolved predicate so
// two concurrent adjudications cannot both win.
export async function resolveForecastByOwner(args: {
  forecastId: string;
  outcome: 0 | 1;
  ownerUserId: string;
  note?: string | null;
}): Promise<OwnerResolveResult> {
  const rows = await db
    .select()
    .from(forecastsTable)
    .where(eq(forecastsTable.id, args.forecastId))
    .limit(1);
  const existing = rows[0];
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.resolvedAt) return { ok: false, reason: "already_resolved" };
  const score = brierScore(Number(existing.probability), args.outcome);
  const updated = await db
    .update(forecastsTable)
    .set({
      outcome: args.outcome,
      resolvedAt: new Date(),
      brierScore: String(score),
      resolutionBasis: "owner",
      resolvedBy: args.ownerUserId,
      resolutionNote: args.note ? stripDashes(args.note) : null,
    })
    .where(and(eq(forecastsTable.id, args.forecastId), isNull(forecastsTable.resolvedAt)))
    .returning();
  const row = updated[0];
  if (!row) return { ok: false, reason: "already_resolved" };
  return { ok: true, forecast: row };
}
