// The pure math of the outcome loop. Every figure the value counter and the
// calibration badge show is computed here from already-persisted numbers, so the
// reconciliation test can assert the summary equals a direct database sum and
// the grading can be unit-tested exhaustively without a database or a request.
//
// Numerics arrive from the database as strings; callers parse them to numbers
// (or null) with toNum before handing them in. Nothing here invents a value:
// absent inputs stay null and never default to a fabricated zero.

export type MeasurementStatus = "pending" | "on_track" | "realized" | "missed";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Parse a database numeric (string) to a finite number, or null. Anything that
// is not a finite number becomes null rather than NaN, so downstream math stays
// honest.
export function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// The graded standing of an action at the time of a measurement, derived from
// the numbers alone. "missed" is only ever returned for a final measurement, so
// an in-flight action below its prediction reads as on_track, never a miss.
export function deriveMeasurementStatus(input: {
  predictedValueUsd: number | null;
  realizedValueUsd: number | null;
  final: boolean;
}): MeasurementStatus {
  const { predictedValueUsd, realizedValueUsd, final } = input;
  if (realizedValueUsd === null) return "pending";
  if (predictedValueUsd === null) return "on_track";
  if (realizedValueUsd >= predictedValueUsd) return "realized";
  if (final) return "missed";
  return "on_track";
}

// realizedValueUsd minus predictedValueUsd, in dollars, or null when either side
// is absent (a variance against nothing is not a number).
export function computeVariance(
  realizedValueUsd: number | null,
  predictedValueUsd: number | null,
): number | null {
  if (realizedValueUsd === null || predictedValueUsd === null) return null;
  return round2(realizedValueUsd - predictedValueUsd);
}

export interface ActionValue {
  id: string;
  predictedValueUsd: number | null;
  status: "committed" | "in_progress" | "done" | "dismissed";
}

export interface MeasurementValue {
  actionId: string;
  realizedValueUsd: number | null;
  status: MeasurementStatus;
  measuredAt: number;
  createdAt: number;
}

// The most recent measurement per action, so a value summed across actions never
// double-counts an action that was measured more than once. Ordering is by
// measuredAt, then createdAt as a stable tiebreak.
export function latestMeasurementPerAction(
  measurements: readonly MeasurementValue[],
): MeasurementValue[] {
  const byAction = new Map<string, MeasurementValue>();
  for (const m of measurements) {
    const prev = byAction.get(m.actionId);
    if (
      !prev ||
      m.measuredAt > prev.measuredAt ||
      (m.measuredAt === prev.measuredAt && m.createdAt > prev.createdAt)
    ) {
      byAction.set(m.actionId, m);
    }
  }
  return [...byAction.values()];
}

export interface Calibration {
  // hits over resolved, or null when nothing has resolved yet. A fraction in
  // [0,1], never a fabricated 100 percent on an empty record.
  score: number | null;
  hits: number;
  misses: number;
  resolved: number;
}

// A deliberately simple, honest accuracy: of the actions whose latest
// measurement has resolved (realized or missed), what fraction realized. A later
// phase (AJ) supersedes this with a Brier-scored ledger; this only has to be
// honest, not clever. Ungradeable measurements (pending, on_track, or no numeric
// prediction) never count toward the score.
export function computeCalibration(latest: readonly MeasurementValue[]): Calibration {
  let hits = 0;
  let misses = 0;
  for (const m of latest) {
    if (m.status === "realized") hits += 1;
    else if (m.status === "missed") misses += 1;
  }
  const resolved = hits + misses;
  return { score: resolved > 0 ? round2(hits / resolved) : null, hits, misses, resolved };
}

export interface OutcomeSummary {
  // Sum of predictedValueUsd over committed, non-dismissed actions that carry a
  // parseable numeric prediction.
  valueIdentifiedUsd: number;
  // Sum of realizedValueUsd over the latest measurement of each measured action.
  valueRealizedUsd: number;
  actionsWithPrediction: number;
  actionsMeasured: number;
  calibration: Calibration;
}

export function computeOutcomeSummary(
  actions: readonly ActionValue[],
  measurements: readonly MeasurementValue[],
): OutcomeSummary {
  const graded = actions.filter((a) => a.status !== "dismissed" && a.predictedValueUsd !== null);
  const valueIdentifiedUsd = round2(
    graded.reduce((sum, a) => sum + (a.predictedValueUsd as number), 0),
  );
  const latest = latestMeasurementPerAction(measurements);
  const valueRealizedUsd = round2(
    latest.reduce((sum, m) => sum + (m.realizedValueUsd ?? 0), 0),
  );
  return {
    valueIdentifiedUsd,
    valueRealizedUsd,
    actionsWithPrediction: graded.length,
    actionsMeasured: latest.length,
    calibration: computeCalibration(latest),
  };
}
