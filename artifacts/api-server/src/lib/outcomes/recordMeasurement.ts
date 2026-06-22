// The measurement service (Phase AQ). The single writer of an outcome
// measurement against a committed action: it resolves the honest basis
// (measured only when a real scalar signal backs the metric), derives the status
// and variance from the numbers, persists the row, and auto-resolves every open
// forecast bound to the action. Extracted from the measurement route so the HTTP
// handler is thin and the live seed closes a loop through the EXACT same path,
// never a drifting copy.

import { and, desc, eq } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  derivedSignalsTable,
  outcomeMeasurementsTable,
  type OutcomeMeasurementRow,
} from "@workspace/db";
import { resolveForecastsForMeasurement } from "../calibration/forecastResolution";
import { computeVariance, deriveMeasurementStatus, toNum } from "./outcomeMath";

export interface RecordOutcomeMeasurementInput {
  tenantId: string;
  actionId: string;
  // The provider who recorded the measurement.
  recordedBy: string;
  realizedValueUsd?: number | null;
  actualMetric?: number | null;
  // Name a derived signal to read the actual metric from. When set and a real
  // scalar signal exists, the basis becomes "measured"; otherwise the call fails
  // rather than silently downgrading to a modelled estimate.
  signalKey?: string | null;
  window?: string | null;
  note?: string | null;
  // A final measurement closes the action out: a realized value below the
  // prediction reads as "missed" only when final.
  final?: boolean;
}

export type RecordOutcomeMeasurementResult =
  | { ok: true; measurement: OutcomeMeasurementRow; resolvedForecasts: number }
  | { ok: false; reason: "not_found" | "signal_not_found" };

export async function recordOutcomeMeasurement(
  input: RecordOutcomeMeasurementInput,
): Promise<RecordOutcomeMeasurementResult> {
  const { tenantId, actionId, recordedBy } = input;
  const actionRows = await db
    .select()
    .from(committedActionsTable)
    .where(and(eq(committedActionsTable.id, actionId), eq(committedActionsTable.tenantId, tenantId)))
    .limit(1);
  const action = actionRows[0];
  if (!action) return { ok: false, reason: "not_found" };

  let basis: "measured" | "modelled" = "modelled";
  let actualMetric: number | null = input.actualMetric ?? null;
  if (input.signalKey) {
    const signalRows = await db
      .select()
      .from(derivedSignalsTable)
      .where(
        and(
          eq(derivedSignalsTable.tenantId, tenantId),
          eq(derivedSignalsTable.layerKey, action.layerKey),
          eq(derivedSignalsTable.signalKey, input.signalKey),
          ...(input.window ? [eq(derivedSignalsTable.window, input.window)] : []),
        ),
      )
      .orderBy(desc(derivedSignalsTable.computedAt))
      .limit(1);
    const sig = signalRows[0];
    // A measured basis is only honest when a real scalar signal backs it. A
    // missing signal, an encrypted envelope, or a vector is rejected rather than
    // silently downgraded to a modelled estimate the caller did not ask for.
    if (!sig || typeof sig.value !== "number" || !Number.isFinite(sig.value)) {
      return { ok: false, reason: "signal_not_found" };
    }
    actualMetric = sig.value;
    basis = "measured";
  }

  const predicted = toNum(action.predictedValueUsd);
  const realized = input.realizedValueUsd ?? null;
  const final = input.final ?? false;
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
      note: input.note ?? null,
      recordedBy,
    })
    .returning();
  const measurement = inserted[0];
  // A terminal measurement (realized or missed) resolves every open forecast
  // bound to this action and scores it. A pending or on_track measurement
  // resolves nothing, so a forecast is never graded on a guess.
  const resolvedForecasts = await resolveForecastsForMeasurement({
    actionId,
    measurementId: measurement.id,
    status,
    basis,
  });
  return { ok: true, measurement, resolvedForecasts };
}
