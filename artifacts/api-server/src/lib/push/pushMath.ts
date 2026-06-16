// Pure ranking and suppression math for Proactive Push Intelligence (Phase Z).
// Everything here is a deterministic function of already-persisted numbers;
// nothing invents a value. A candidate with no dollar figure ranks last and is
// suppressed, never promoted above a real, dollar-quantified signal. The DB and
// HTTP wiring lives in the evaluator, notifier and routes; this module is unit
// tested in isolation with no database.

export type PushRuleType = "outcome_shortfall" | "high_value_action" | "premortem_indicator";

export type SuppressionReason =
  | "disabled"
  | "muted"
  | "no_dollar"
  | "below_impact"
  | "below_confidence";

// The tuning a rule applies. mutedUntil is epoch ms or null. Thresholds are null
// when there is no floor (every breach qualifies) or a real number to suppress
// anything below it.
export interface PushThresholds {
  enabled: boolean;
  mutedUntil: number | null;
  minImpactUsd: number | null;
  minConfidence: number | null;
}

// Round to four decimals to match the rank_score column scale, so the stored and
// the computed value never disagree by a floating-point tail.
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// rankScore = impactUsd * (confidence / 100). A null dollar figure OR a null
// confidence yields 0, so an unquantified candidate sorts last and is suppressed
// rather than ranked above a real signal.
export function computeRankScore(impactUsd: number | null, confidence: number | null): number {
  if (impactUsd === null || confidence === null) return 0;
  if (!Number.isFinite(impactUsd) || !Number.isFinite(confidence)) return 0;
  return round4(impactUsd * (confidence / 100));
}

// Decide whether a candidate is delivered (not suppressed) or suppressed, and
// why. Deterministic and honest: a disabled rule suppresses; a rule muted into
// the future suppresses; a candidate with no dollar figure suppresses; a
// candidate below either configured floor suppresses. Otherwise it passes.
export function evaluateSuppression(input: {
  impactUsd: number | null;
  confidence: number | null;
  thresholds: PushThresholds;
  now: number;
}): { suppressed: boolean; reason: SuppressionReason | null } {
  const { thresholds, impactUsd, confidence, now } = input;
  if (!thresholds.enabled) return { suppressed: true, reason: "disabled" };
  if (thresholds.mutedUntil !== null && thresholds.mutedUntil > now) {
    return { suppressed: true, reason: "muted" };
  }
  if (impactUsd === null) return { suppressed: true, reason: "no_dollar" };
  if (thresholds.minImpactUsd !== null && impactUsd < thresholds.minImpactUsd) {
    return { suppressed: true, reason: "below_impact" };
  }
  if (
    thresholds.minConfidence !== null &&
    (confidence === null || confidence < thresholds.minConfidence)
  ) {
    return { suppressed: true, reason: "below_confidence" };
  }
  return { suppressed: false, reason: null };
}

// Sort delivered candidates by rankScore desc, then dollar impact desc, then a
// stable sourceId tiebreak, so a digest leads with the biggest dollars at stake
// and never reorders nondeterministically across runs.
export function rankCandidates<
  T extends { rankScore: number; impactUsd: number | null; sourceId: string },
>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    const ai = a.impactUsd ?? 0;
    const bi = b.impactUsd ?? 0;
    if (bi !== ai) return bi - ai;
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });
}

// A deterministic, ASCII-only US dollar formatter for notification text, so the
// stored message never depends on the host ICU build and never emits a non-ASCII
// separator. Rounds to whole dollars and groups thousands with commas.
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const negative = n < 0;
  const whole = Math.abs(Math.round(n));
  const digits = String(whole);
  let grouped = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return (negative ? "-$" : "$") + grouped;
}

// The idempotency key for an outcome-shortfall event. Anchored to the specific
// graded measurement, which is immutable once recorded, so the same missed
// outcome never notifies twice and a newer measurement (a new id) is a new
// event.
export function shortfallDedupeKey(measurementId: string): string {
  return "outcome_shortfall:" + measurementId;
}

// The idempotency key for a high-value-action event. Anchored to the action, so
// a committed high-value action notifies once across its open life regardless of
// how many evaluation ticks see it.
export function highValueDedupeKey(actionId: string): string {
  return "high_value_action:" + actionId;
}

// The idempotency key for a pre-mortem indicator event. Anchored to the indicator
// AND its status, so the watch surfaces once while active and notifies AGAIN when
// the same indicator transitions to triggered (its early-warning sign was
// observed). A cleared indicator is never a candidate, so it never keys here.
export function premortemIndicatorDedupeKey(indicatorId: string, status: string): string {
  return "premortem_indicator:" + status + ":" + indicatorId;
}
