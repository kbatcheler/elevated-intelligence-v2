import { desc, eq, inArray } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  decisionRecordsTable,
  forecastsTable,
  outcomeMeasurementsTable,
  preMortemIndicatorsTable,
  preMortemsTable,
  usersTable,
  type DecisionKind,
  type PreMortemIndicatorStatus,
  type PreMortemStatus,
} from "@workspace/db";
import { toNum } from "../outcomes/outcomeMath";

// The board-grade decision audit timeline (Phase AL). A read-model that joins the
// decision ledger to its pre-mortems, the committed action it created, that
// action's latest graded outcome, and the AJ forecast it concerns. Every figure
// is read from persisted state: the running realised value is the cumulative sum
// of real graded measurements, never a projection, and "overruled and right" is
// derived at read time from the forecast resolution, never stored as a flag that
// could drift.

// Whether a decision that went AGAINST the recommendation was later vindicated. A
// defer or reject declines a recommended action; if the action_outcome forecast
// (the system's bet that the action would have succeeded) later resolves FALSE,
// the human's contrarian call was right. Only a contradicting decision has this
// status; a commit followed the advice, so it is null. Until the forecast
// resolves the verdict is honestly pending.
export type OverruledStatus = "right" | "wrong" | "pending" | null;

export function deriveOverruledStatus(input: {
  contradictsRecommendation: boolean;
  forecastResolved: boolean;
  forecastOutcome: 0 | 1 | null;
}): OverruledStatus {
  if (!input.contradictsRecommendation) return null;
  if (!input.forecastResolved || input.forecastOutcome === null) return "pending";
  return input.forecastOutcome === 0 ? "right" : "wrong";
}

// Accumulate the running realised value across decisions in CHRONOLOGICAL order.
// Only a real, graded realised figure moves the total; a pending or unmeasured
// decision carries the prior cumulative forward unchanged. Pure over already
// ordered inputs so it is unit tested without a database.
export function runningRealizedValue(
  chronological: readonly { realizedValueUsd: number | null }[],
): number[] {
  let cumulative = 0;
  return chronological.map((e) => {
    if (e.realizedValueUsd !== null && Number.isFinite(e.realizedValueUsd)) {
      cumulative += e.realizedValueUsd;
    }
    return Math.round(cumulative * 100) / 100;
  });
}

export interface SerializedPreMortemFailureMode {
  rank: number;
  title: string;
  mechanism: string;
  likelihood: string;
  earlyWarning: string;
}

export interface SerializedPreMortemIndicator {
  id: string;
  failureModeRank: number;
  failureModeTitle: string;
  label: string;
  status: PreMortemIndicatorStatus;
  triggeredAt: string | null;
  clearedAt: string | null;
}

export interface SerializedPreMortem {
  id: string;
  status: PreMortemStatus;
  failureModes: SerializedPreMortemFailureMode[];
  residualRiskNote: string | null;
  error: string | null;
  provenanceContentHash: string | null;
  indicators: SerializedPreMortemIndicator[];
  createdAt: string;
}

export interface DecisionTimelineEntry {
  id: string;
  decidedAt: string;
  decision: DecisionKind;
  layerKey: string;
  actionRef: string | null;
  recommendedTitle: string;
  recommendedDetail: string | null;
  recommendedImpact: string | null;
  recommendedValueUsd: number | null;
  systemConfidence: number;
  systemBasis: string;
  // Whether the recommendation snapshot was read server-side from the persisted
  // layer (a defer or reject, and a commit naming an actionRef) or came from the
  // client unverified (a freeform commit). The audit shows the distinction
  // honestly rather than presenting an operator-typed action as a system one.
  recommendationVerified: boolean;
  // The provenance refs grounding the layer's diagnosis at decision time:
  // references into the append-only ledger, never raw evidence.
  evidenceRefs: { claimPath: string; contentHash: string }[];
  contradictsRecommendation: boolean;
  rationale: string | null;
  decidedByEmail: string | null;
  provenanceContentHash: string;
  committedActionId: string | null;
  actionStatus: string | null;
  realizedValueUsd: number | null;
  measurementStatus: string | null;
  forecastId: string | null;
  forecastProbability: number | null;
  forecastResolved: boolean;
  forecastOutcome: 0 | 1 | null;
  forecastBrierScore: number | null;
  overruledStatus: OverruledStatus;
  preMortems: SerializedPreMortem[];
  cumulativeRealizedValueUsd: number;
}

export interface DecisionTimelineSummary {
  totalDecisions: number;
  commits: number;
  defers: number;
  rejects: number;
  overruledRight: number;
  overruledWrong: number;
  overruledPending: number;
  totalIdentifiedValueUsd: number;
  totalRealizedValueUsd: number;
}

export interface DecisionTimeline {
  entries: DecisionTimelineEntry[];
  summary: DecisionTimelineSummary;
}

// Build the timeline for a tenant. Newest decision first for display, but the
// running realised value is computed in chronological order so the cumulative is
// honest. Bounded reads: each related set is loaded once and indexed in memory.
export async function getDecisionTimeline(tenantId: string): Promise<DecisionTimeline> {
  const decisionRows = await db
    .select({ decision: decisionRecordsTable, decidedByEmail: usersTable.email })
    .from(decisionRecordsTable)
    .leftJoin(usersTable, eq(decisionRecordsTable.decidedBy, usersTable.id))
    .where(eq(decisionRecordsTable.tenantId, tenantId))
    .orderBy(desc(decisionRecordsTable.decidedAt));

  if (decisionRows.length === 0) {
    return {
      entries: [],
      summary: {
        totalDecisions: 0,
        commits: 0,
        defers: 0,
        rejects: 0,
        overruledRight: 0,
        overruledWrong: 0,
        overruledPending: 0,
        totalIdentifiedValueUsd: 0,
        totalRealizedValueUsd: 0,
      },
    };
  }

  const decisionIds = decisionRows.map((r) => r.decision.id);
  const actionIds = decisionRows
    .map((r) => r.decision.committedActionId)
    .filter((id): id is string => id !== null);
  const forecastIds = decisionRows
    .map((r) => r.decision.forecastId)
    .filter((id): id is string => id !== null);

  // Pre-mortems and their indicators, grouped by decision.
  const pmRows = await db
    .select()
    .from(preMortemsTable)
    .where(eq(preMortemsTable.tenantId, tenantId))
    .orderBy(desc(preMortemsTable.createdAt));
  const indicatorRows = await db
    .select()
    .from(preMortemIndicatorsTable)
    .where(eq(preMortemIndicatorsTable.tenantId, tenantId));
  const indicatorsByPm = new Map<string, SerializedPreMortemIndicator[]>();
  for (const ind of indicatorRows) {
    const list = indicatorsByPm.get(ind.preMortemId) ?? [];
    list.push({
      id: ind.id,
      failureModeRank: ind.failureModeRank,
      failureModeTitle: ind.failureModeTitle,
      label: ind.label,
      status: ind.status,
      triggeredAt: ind.triggeredAt ? ind.triggeredAt.toISOString() : null,
      clearedAt: ind.clearedAt ? ind.clearedAt.toISOString() : null,
    });
    indicatorsByPm.set(ind.preMortemId, list);
  }
  for (const list of indicatorsByPm.values()) {
    list.sort((a, b) => a.failureModeRank - b.failureModeRank);
  }
  const pmByDecision = new Map<string, SerializedPreMortem[]>();
  for (const pm of pmRows) {
    const modes = Array.isArray(pm.failureModes)
      ? (pm.failureModes as Record<string, unknown>[]).map((m) => ({
          rank: typeof m.rank === "number" ? m.rank : 0,
          title: typeof m.title === "string" ? m.title : "",
          mechanism: typeof m.mechanism === "string" ? m.mechanism : "",
          likelihood: typeof m.likelihood === "string" ? m.likelihood : "",
          earlyWarning: typeof m.earlyWarning === "string" ? m.earlyWarning : "",
        }))
      : [];
    const list = pmByDecision.get(pm.decisionRecordId) ?? [];
    list.push({
      id: pm.id,
      status: pm.status,
      failureModes: modes,
      residualRiskNote: pm.residualRiskNote,
      error: pm.error,
      provenanceContentHash: pm.provenanceContentHash,
      indicators: indicatorsByPm.get(pm.id) ?? [],
      createdAt: pm.createdAt.toISOString(),
    });
    pmByDecision.set(pm.decisionRecordId, list);
  }

  // Committed action statuses for commit decisions.
  const actionStatusById = new Map<string, string>();
  if (actionIds.length > 0) {
    const actionRows = await db
      .select({ id: committedActionsTable.id, status: committedActionsTable.status })
      .from(committedActionsTable)
      .where(inArray(committedActionsTable.id, actionIds));
    for (const a of actionRows) actionStatusById.set(a.id, a.status);
  }

  // Latest graded measurement per committed action, for realised value.
  const latestMeasurementByAction = new Map<
    string,
    { realizedValueUsd: number | null; status: string; measuredAt: number; createdAt: number }
  >();
  if (actionIds.length > 0) {
    const measurementRows = await db
      .select({
        actionId: outcomeMeasurementsTable.actionId,
        realizedValueUsd: outcomeMeasurementsTable.realizedValueUsd,
        status: outcomeMeasurementsTable.status,
        measuredAt: outcomeMeasurementsTable.measuredAt,
        createdAt: outcomeMeasurementsTable.createdAt,
      })
      .from(outcomeMeasurementsTable)
      .where(inArray(outcomeMeasurementsTable.actionId, actionIds));
    for (const m of measurementRows) {
      const prev = latestMeasurementByAction.get(m.actionId);
      const measuredAt = m.measuredAt.getTime();
      const createdAt = m.createdAt.getTime();
      if (
        !prev ||
        measuredAt > prev.measuredAt ||
        (measuredAt === prev.measuredAt && createdAt > prev.createdAt)
      ) {
        latestMeasurementByAction.set(m.actionId, {
          realizedValueUsd: toNum(m.realizedValueUsd),
          status: m.status,
          measuredAt,
          createdAt,
        });
      }
    }
  }

  // Linked forecasts.
  const forecastById = new Map<
    string,
    { probability: number | null; outcome: 0 | 1 | null; resolved: boolean; brierScore: number | null }
  >();
  if (forecastIds.length > 0) {
    const fRows = await db
      .select({
        id: forecastsTable.id,
        probability: forecastsTable.probability,
        outcome: forecastsTable.outcome,
        resolvedAt: forecastsTable.resolvedAt,
        brierScore: forecastsTable.brierScore,
      })
      .from(forecastsTable)
      .where(inArray(forecastsTable.id, forecastIds));
    for (const f of fRows) {
      const outcome = f.outcome === 0 || f.outcome === 1 ? (f.outcome as 0 | 1) : null;
      forecastById.set(f.id, {
        probability: toNum(f.probability),
        outcome,
        resolved: f.resolvedAt !== null,
        brierScore: toNum(f.brierScore),
      });
    }
  }

  // Assemble per-decision in DISPLAY order (newest first), capturing the realised
  // value for the running total computed chronologically below.
  const partial = decisionRows.map(({ decision: d, decidedByEmail }) => {
    const measurement = d.committedActionId ? latestMeasurementByAction.get(d.committedActionId) : undefined;
    // Only a graded (terminal) measurement contributes a realised figure; a
    // pending or on_track measurement is not yet a realised value.
    const graded = measurement && (measurement.status === "realized" || measurement.status === "missed");
    const realizedValueUsd = graded ? measurement.realizedValueUsd : null;
    const forecast = d.forecastId ? forecastById.get(d.forecastId) : undefined;
    return {
      decision: d,
      decidedByEmail: decidedByEmail ?? null,
      actionStatus: d.committedActionId ? (actionStatusById.get(d.committedActionId) ?? null) : null,
      realizedValueUsd,
      measurementStatus: measurement?.status ?? null,
      forecast,
    };
  });

  // Running realised value, computed oldest -> newest, mapped back onto display
  // order by decision id.
  const chronological = [...partial].reverse();
  const running = runningRealizedValue(chronological.map((p) => ({ realizedValueUsd: p.realizedValueUsd })));
  const cumulativeById = new Map<string, number>();
  chronological.forEach((p, i) => cumulativeById.set(p.decision.id, running[i]!));

  let commits = 0;
  let defers = 0;
  let rejects = 0;
  let overruledRight = 0;
  let overruledWrong = 0;
  let overruledPending = 0;
  let totalIdentifiedValueUsd = 0;
  let totalRealizedValueUsd = 0;

  const entries: DecisionTimelineEntry[] = partial.map((p) => {
    const d = p.decision;
    if (d.decision === "commit") commits += 1;
    else if (d.decision === "defer") defers += 1;
    else rejects += 1;

    const overruledStatus = deriveOverruledStatus({
      contradictsRecommendation: d.contradictsRecommendation,
      forecastResolved: p.forecast?.resolved ?? false,
      forecastOutcome: p.forecast?.outcome ?? null,
    });
    if (overruledStatus === "right") overruledRight += 1;
    else if (overruledStatus === "wrong") overruledWrong += 1;
    else if (overruledStatus === "pending") overruledPending += 1;

    const recommendedValueUsd = toNum(d.recommendedValueUsd);
    if (d.decision === "commit" && recommendedValueUsd !== null) {
      totalIdentifiedValueUsd += recommendedValueUsd;
    }
    if (p.realizedValueUsd !== null) totalRealizedValueUsd += p.realizedValueUsd;

    return {
      id: d.id,
      decidedAt: d.decidedAt.toISOString(),
      decision: d.decision,
      layerKey: d.layerKey,
      actionRef: d.actionRef,
      recommendedTitle: d.recommendedTitle,
      recommendedDetail: d.recommendedDetail,
      recommendedImpact: d.recommendedImpact,
      recommendedValueUsd,
      systemConfidence: d.systemConfidence,
      systemBasis: d.systemBasis,
      recommendationVerified: d.recommendationVerified,
      evidenceRefs: d.evidenceRefs,
      contradictsRecommendation: d.contradictsRecommendation,
      rationale: d.rationale,
      decidedByEmail: p.decidedByEmail,
      provenanceContentHash: d.provenanceContentHash,
      committedActionId: d.committedActionId,
      actionStatus: p.actionStatus,
      realizedValueUsd: p.realizedValueUsd,
      measurementStatus: p.measurementStatus,
      forecastId: d.forecastId,
      forecastProbability: p.forecast?.probability ?? null,
      forecastResolved: p.forecast?.resolved ?? false,
      forecastOutcome: p.forecast?.outcome ?? null,
      forecastBrierScore: p.forecast?.brierScore ?? null,
      overruledStatus,
      preMortems: pmByDecision.get(d.id) ?? [],
      cumulativeRealizedValueUsd: cumulativeById.get(d.id) ?? 0,
    };
  });

  return {
    entries,
    summary: {
      totalDecisions: decisionRows.length,
      commits,
      defers,
      rejects,
      overruledRight,
      overruledWrong,
      overruledPending,
      totalIdentifiedValueUsd: Math.round(totalIdentifiedValueUsd * 100) / 100,
      totalRealizedValueUsd: Math.round(totalRealizedValueUsd * 100) / 100,
    },
  };
}
