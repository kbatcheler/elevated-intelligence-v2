// The outcome-loop read model (Phase AQ). A focused read that closes the loop on
// COMMIT decisions: the recommendation the board acted on, the action it created,
// the forecast that prediction bound, and the measurement and Brier-scored
// resolution that graded it. It deliberately narrows the broader decision
// timeline to commits and adds the two honesty signals the loop turns on, the
// forecast's resolution basis and the measurement's basis and variance, so the
// surface can show measured fact and modelled estimate distinctly.
//
// Every figure is read from persisted state. A stage that has not happened yet is
// null, never a fabricated zero: an open loop has a null forecast resolution, an
// unmeasured action has a null measurement, and the headline Brier is null until
// at least one forecast has resolved.

import { desc, eq, inArray } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  decisionRecordsTable,
  forecastsTable,
  outcomeMeasurementsTable,
  usersTable,
} from "@workspace/db";
import { round2, toNum } from "./outcomeMath";

export interface OutcomeLoopRecommendation {
  title: string;
  detail: string | null;
  impact: string | null;
  predictedValueUsd: number | null;
  confidence: number;
  basis: string;
  // Whether the recommendation snapshot was read server-side from the persisted
  // layer (a commit naming an actionRef) or came from the client unverified.
  verified: boolean;
  // References into the append-only provenance ledger grounding the diagnosis at
  // decision time; never raw evidence.
  evidenceRefs: { claimPath: string; contentHash: string }[];
  provenanceContentHash: string;
}

export interface OutcomeLoopForecast {
  id: string;
  statement: string;
  probability: number | null;
  outcome: 0 | 1 | null;
  resolved: boolean;
  resolvedAt: string | null;
  brierScore: number | null;
  // measured, modelled, or owner: how the forecast was resolved. Null while open.
  resolutionBasis: string | null;
}

export interface OutcomeLoopMeasurement {
  id: string;
  status: string;
  // measured only when a real scalar signal backed it; otherwise modelled.
  basis: string;
  realizedValueUsd: number | null;
  varianceVsPrediction: number | null;
  measuredAt: string;
}

export interface OutcomeLoopEntry {
  decisionId: string;
  decidedAt: string;
  layerKey: string;
  actionRef: string | null;
  rationale: string | null;
  decidedByEmail: string | null;
  // open until the bound forecast resolves; resolved once it carries an outcome.
  state: "open" | "resolved";
  recommendation: OutcomeLoopRecommendation;
  action: { id: string; status: string } | null;
  forecast: OutcomeLoopForecast | null;
  measurement: OutcomeLoopMeasurement | null;
}

export interface OutcomeLoopSummary {
  total: number;
  closed: number;
  open: number;
  // Mean Brier over the resolved loops, or null when none have resolved. Never a
  // fabricated zero on an empty record.
  brierMean: number | null;
}

export interface OutcomeLoop {
  tenantId: string;
  summary: OutcomeLoopSummary;
  loops: OutcomeLoopEntry[];
}

function emptyLoop(tenantId: string): OutcomeLoop {
  return { tenantId, summary: { total: 0, closed: 0, open: 0, brierMean: null }, loops: [] };
}

// Build the outcome loop for a tenant, newest commit first. Bounded reads: the
// commit decisions are read once, then each related set (actions, latest
// measurements, forecasts) is loaded once by id and indexed in memory, mirroring
// the decision timeline's read shape.
export async function getOutcomeLoop(tenantId: string): Promise<OutcomeLoop> {
  const decisionRows = await db
    .select({ decision: decisionRecordsTable, decidedByEmail: usersTable.email })
    .from(decisionRecordsTable)
    .leftJoin(usersTable, eq(decisionRecordsTable.decidedBy, usersTable.id))
    .where(eq(decisionRecordsTable.tenantId, tenantId))
    .orderBy(desc(decisionRecordsTable.decidedAt));

  const commits = decisionRows.filter((r) => r.decision.decision === "commit");
  if (commits.length === 0) return emptyLoop(tenantId);

  const actionIds = commits
    .map((r) => r.decision.committedActionId)
    .filter((id): id is string => id !== null);
  const forecastIds = commits
    .map((r) => r.decision.forecastId)
    .filter((id): id is string => id !== null);

  // Committed action statuses.
  const actionStatusById = new Map<string, string>();
  if (actionIds.length > 0) {
    const actionRows = await db
      .select({ id: committedActionsTable.id, status: committedActionsTable.status })
      .from(committedActionsTable)
      .where(inArray(committedActionsTable.id, actionIds));
    for (const a of actionRows) actionStatusById.set(a.id, a.status);
  }

  // Latest measurement per action, by measuredAt then createdAt as a stable
  // tiebreak, mirroring latestMeasurementPerAction.
  const latestMeasurementByAction = new Map<string, OutcomeLoopMeasurement & { _m: number; _c: number }>();
  if (actionIds.length > 0) {
    const measurementRows = await db
      .select({
        id: outcomeMeasurementsTable.id,
        actionId: outcomeMeasurementsTable.actionId,
        status: outcomeMeasurementsTable.status,
        basis: outcomeMeasurementsTable.basis,
        realizedValueUsd: outcomeMeasurementsTable.realizedValueUsd,
        varianceVsPrediction: outcomeMeasurementsTable.varianceVsPrediction,
        measuredAt: outcomeMeasurementsTable.measuredAt,
        createdAt: outcomeMeasurementsTable.createdAt,
      })
      .from(outcomeMeasurementsTable)
      .where(inArray(outcomeMeasurementsTable.actionId, actionIds));
    for (const m of measurementRows) {
      const measuredAt = m.measuredAt.getTime();
      const createdAt = m.createdAt.getTime();
      const prev = latestMeasurementByAction.get(m.actionId);
      if (!prev || measuredAt > prev._m || (measuredAt === prev._m && createdAt > prev._c)) {
        latestMeasurementByAction.set(m.actionId, {
          id: m.id,
          status: m.status,
          basis: m.basis,
          realizedValueUsd: toNum(m.realizedValueUsd),
          varianceVsPrediction: toNum(m.varianceVsPrediction),
          measuredAt: m.measuredAt.toISOString(),
          _m: measuredAt,
          _c: createdAt,
        });
      }
    }
  }

  // Linked forecasts.
  const forecastById = new Map<string, OutcomeLoopForecast>();
  if (forecastIds.length > 0) {
    const fRows = await db
      .select({
        id: forecastsTable.id,
        statement: forecastsTable.statement,
        probability: forecastsTable.probability,
        outcome: forecastsTable.outcome,
        resolvedAt: forecastsTable.resolvedAt,
        brierScore: forecastsTable.brierScore,
        resolutionBasis: forecastsTable.resolutionBasis,
      })
      .from(forecastsTable)
      .where(inArray(forecastsTable.id, forecastIds));
    for (const f of fRows) {
      const outcome = f.outcome === 0 || f.outcome === 1 ? (f.outcome as 0 | 1) : null;
      forecastById.set(f.id, {
        id: f.id,
        statement: f.statement,
        probability: toNum(f.probability),
        outcome,
        resolved: f.resolvedAt !== null,
        resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
        brierScore: toNum(f.brierScore),
        resolutionBasis: f.resolutionBasis ?? null,
      });
    }
  }

  let closed = 0;
  let brierSum = 0;
  let brierN = 0;

  const loops: OutcomeLoopEntry[] = commits.map(({ decision: d, decidedByEmail }) => {
    const forecast = d.forecastId ? (forecastById.get(d.forecastId) ?? null) : null;
    const measurementFull = d.committedActionId
      ? latestMeasurementByAction.get(d.committedActionId)
      : undefined;
    const measurement: OutcomeLoopMeasurement | null = measurementFull
      ? {
          id: measurementFull.id,
          status: measurementFull.status,
          basis: measurementFull.basis,
          realizedValueUsd: measurementFull.realizedValueUsd,
          varianceVsPrediction: measurementFull.varianceVsPrediction,
          measuredAt: measurementFull.measuredAt,
        }
      : null;
    const state: "open" | "resolved" = forecast?.resolved ? "resolved" : "open";
    if (state === "resolved") {
      closed += 1;
      if (forecast && forecast.brierScore !== null) {
        brierSum += forecast.brierScore;
        brierN += 1;
      }
    }
    return {
      decisionId: d.id,
      decidedAt: d.decidedAt.toISOString(),
      layerKey: d.layerKey,
      actionRef: d.actionRef,
      rationale: d.rationale,
      decidedByEmail: decidedByEmail ?? null,
      state,
      recommendation: {
        title: d.recommendedTitle,
        detail: d.recommendedDetail,
        impact: d.recommendedImpact,
        predictedValueUsd: toNum(d.recommendedValueUsd),
        confidence: d.systemConfidence,
        basis: d.systemBasis,
        verified: d.recommendationVerified,
        evidenceRefs: d.evidenceRefs,
        provenanceContentHash: d.provenanceContentHash,
      },
      action: d.committedActionId
        ? { id: d.committedActionId, status: actionStatusById.get(d.committedActionId) ?? "committed" }
        : null,
      forecast,
      measurement,
    };
  });

  return {
    tenantId,
    summary: {
      total: loops.length,
      closed,
      open: loops.length - closed,
      brierMean: brierN > 0 ? round2(brierSum / brierN) : null,
    },
    loops,
  };
}
