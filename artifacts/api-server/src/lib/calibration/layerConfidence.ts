// Phase AJ display-only confidence calibration for a single layer. The raw
// Evaluator confidence is never overwritten anywhere; this reads the layer's OWN
// resolved forecasts, computes their Brier score, and returns an advisory: the
// disciplined value plus the evidence behind it (resolved count, layer Brier,
// sample label). The portal shows the raw pill and an honest label, and only
// applies the disciplined value once the layer has cleared the resolved-sample
// threshold. A layer with a thin or absent track record is left untouched.

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, forecastsTable } from "@workspace/db";
import {
  aggregateBrier,
  applyConfidenceCalibration,
  labelSample,
  type ConfidenceCalibration,
  type ResolvedForecastPoint,
  type SampleLabel,
} from "./brierMath";
import { calibrationConfig } from "./config";

export interface LayerConfidenceAdvisory extends ConfidenceCalibration {
  n: number;
  brier: number | null;
  threshold: number;
  label: SampleLabel;
}

export async function computeLayerConfidenceAdvisory(
  tenantId: string,
  layerKey: string,
  rawConfidence: number,
  // Phase AM: when set, only forecasts RESOLVED at or before this instant are
  // counted, so an as-of replay shows the confidence the layer had earned by that
  // date, not the confidence it has earned since. lte(resolvedAt, asOf) also
  // excludes unresolved forecasts, so the as-of path needs no separate null
  // guard. Unset is the live path: every resolved forecast counts.
  asOf?: Date,
): Promise<LayerConfidenceAdvisory> {
  const { minResolvedPerSegment: threshold } = calibrationConfig();
  const rows = await db
    .select({ probability: forecastsTable.probability, outcome: forecastsTable.outcome })
    .from(forecastsTable)
    .where(
      and(
        eq(forecastsTable.tenantId, tenantId),
        eq(forecastsTable.layerKey, layerKey),
        asOf ? lte(forecastsTable.resolvedAt, asOf) : isNotNull(forecastsTable.resolvedAt),
      ),
    );
  const points: ResolvedForecastPoint[] = rows
    .filter((r) => r.outcome === 0 || r.outcome === 1)
    .map((r) => ({
      probability: Number(r.probability),
      outcome: r.outcome as 0 | 1,
      layerKey,
      kind: "",
      subjectSeat: "",
    }));
  const agg = aggregateBrier(points);
  const calibration = applyConfidenceCalibration(rawConfidence, {
    brier: agg.meanBrier,
    n: agg.n,
    threshold,
  });
  return {
    ...calibration,
    n: agg.n,
    brier: agg.meanBrier,
    threshold,
    label: labelSample(agg.n, threshold),
  };
}
