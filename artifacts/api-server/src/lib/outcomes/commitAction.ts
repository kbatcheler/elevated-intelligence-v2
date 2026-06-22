// The commit service (Phase AQ). The single writer that turns a recommended
// action into a committed action on the track record: it snapshots the numeric
// prediction and (in connected mode) the baseline metric, binds the
// action_outcome forecast it acts on, and records the board-grade decision
// record, all atomically. Extracted from the commit route so the HTTP handler is
// thin and the EXACT same honest path is reachable from the live seed, never a
// second, drifting copy of the commit logic.

import { and, desc, eq } from "drizzle-orm";
import { committedActionsTable, db, derivedSignalsTable, type CommittedAction } from "@workspace/db";
import { linkForecastToCommittedActionTx } from "../calibration/forecastResolution";
import {
  loadRecommendationSnapshot,
  recordDecisionTx,
  snapshotLayerEvidence,
  type RecommendationSnapshot,
} from "../decisions/decisionRecord";
import { parsePredictedValueUsd } from "./predictedValue";

export interface CommitRecommendedActionInput {
  tenantId: string;
  // The user committing the action; the decision's decidedBy and the action's
  // committedBy.
  committedBy: string;
  layerKey: string;
  title: string;
  detail?: string | null;
  predictedImpact?: string | null;
  timing?: string | null;
  owner?: string | null;
  basis: "verified" | "modelled";
  confidence: number;
  // Connected-mode only: name a derived signal to snapshot as the baseline this
  // action sets out to move. Snapshotted only when a real scalar signal exists.
  baselineSignalKey?: string | null;
  baselineWindow?: string | null;
  // Bind this commit to the action_outcome forecast it acts on, by the forecast's
  // own id or its (layer, sourcePath) anchor.
  forecastId?: string | null;
  forecastSourcePath?: string | null;
  // The path into the layer content this commit acts on (e.g. "actions[0]"). When
  // set, the decision snapshot is read SERVER-SIDE from the live layer content.
  actionRef?: string | null;
  rationale?: string | null;
}

export type CommitRecommendedActionResult =
  | {
      ok: true;
      action: CommittedAction;
      linkedForecastId: string | null;
      decisionRecordId: string;
    }
  | { ok: false; reason: "layer_not_found" | "action_not_found" | "not_an_action" };

export async function commitRecommendedAction(
  input: CommitRecommendedActionInput,
): Promise<CommitRecommendedActionResult> {
  const { tenantId, committedBy, layerKey, title, basis, confidence } = input;
  const detail = input.detail ?? null;
  const predictedImpact = input.predictedImpact ?? null;
  const timing = input.timing ?? null;
  const owner = input.owner ?? null;
  const actionRef = input.actionRef ?? null;
  const rationale = input.rationale ?? null;
  const forecastId = input.forecastId ?? null;
  const forecastSourcePath = input.forecastSourcePath ?? null;
  const baselineSignalKey = input.baselineSignalKey ?? null;
  const baselineWindow = input.baselineWindow ?? null;

  // Snapshot the numeric prediction from the real impact string. Null when the
  // impact carries no parseable dollar figure; the platform never invents one.
  const predicted = parsePredictedValueUsd(predictedImpact);

  // Snapshot the baseline metric only when a real scalar derived signal is named
  // and present (connected mode). Otherwise the baseline stays null, which is the
  // honest state for an outside-in tenant.
  let baselineMetric: string | null = null;
  let baselineAt: Date | null = null;
  if (baselineSignalKey) {
    const signalRows = await db
      .select()
      .from(derivedSignalsTable)
      .where(
        and(
          eq(derivedSignalsTable.tenantId, tenantId),
          eq(derivedSignalsTable.layerKey, layerKey),
          eq(derivedSignalsTable.signalKey, baselineSignalKey),
          ...(baselineWindow ? [eq(derivedSignalsTable.window, baselineWindow)] : []),
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

  // The decision record's recommendation snapshot is read SERVER-SIDE from the
  // live layer content when the commit names an actionRef, so the audit binds to
  // the recommendation the system actually made, never the caller's description
  // of it. A bad ref fails the whole commit (no half-written action). A freeform
  // commit with no actionRef keeps the caller snapshot, honestly marked
  // unverified.
  let decisionSnapshot: RecommendationSnapshot;
  let recommendationVerified: boolean;
  if (actionRef) {
    const loaded = await loadRecommendationSnapshot(tenantId, layerKey, actionRef);
    if (loaded.kind === "layer_not_found") return { ok: false, reason: "layer_not_found" };
    if (loaded.kind === "finding_not_found") return { ok: false, reason: "action_not_found" };
    if (loaded.kind === "not_an_action") return { ok: false, reason: "not_an_action" };
    decisionSnapshot = loaded.snapshot;
    recommendationVerified = true;
  } else {
    decisionSnapshot = {
      title,
      detail,
      impact: predictedImpact,
      predictedValueUsd: predicted,
      confidence,
      basis,
    };
    recommendationVerified = false;
  }

  // Snapshot the provenance refs grounding the layer's diagnosis at commit time,
  // so the audit shows the evidence the recommendation rested on. References
  // only; an empty array is honest for a layer with no graded claims.
  const evidenceRefs = await snapshotLayerEvidence(tenantId, layerKey);

  // A commit creates the committed action, binds its forecast, AND records a
  // board-grade decision record, all atomically: every commit yields exactly one
  // decision, and the decision's provenance entry cannot exist without the action
  // it records. The forecast anchor falls back to the actionRef when no explicit
  // forecast reference is given.
  const sourcePath = forecastSourcePath ?? actionRef ?? null;
  const { action, linkedForecastId, decisionRecordId } = await db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(committedActionsTable)
      .values({
        tenantId,
        layerKey,
        title,
        detail,
        predictedImpact,
        predictedValueUsd: predicted === null ? null : predicted.toFixed(2),
        baselineMetric,
        baselineAt,
        timing,
        actionOwner: owner,
        basis,
        confidence,
        committedBy,
      })
      .returning();
    const created = insertedRows[0];
    // Bind the action_outcome forecast to this committed action when a reference
    // (explicit or the action anchor) names one. The link is what lets a later
    // outcome measurement resolve the forecast and score it; an unbound commit
    // simply leaves the forecast resolvable by owner adjudication.
    let linkedId: string | null = null;
    if (forecastId || sourcePath) {
      linkedId = await linkForecastToCommittedActionTx(tx, {
        tenantId,
        actionId: created.id,
        layerKey,
        forecastId,
        sourcePath,
      });
    }
    const record = await recordDecisionTx(tx, {
      tenantId,
      layerKey,
      actionRef,
      decision: "commit",
      committedActionId: created.id,
      decidedBy: committedBy,
      snapshot: decisionSnapshot,
      recommendationVerified,
      evidenceRefs,
      rationale,
      forecastId: linkedId,
    });
    return { action: created, linkedForecastId: linkedId, decisionRecordId: record.id };
  });

  return { ok: true, action, linkedForecastId, decisionRecordId };
}
