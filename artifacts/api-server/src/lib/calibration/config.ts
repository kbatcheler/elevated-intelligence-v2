// Phase AJ calibration configuration. One documented place for the honesty
// thresholds the Brier ledger uses, so the sample-size labelling and the
// confidence calibration cannot be quietly tuned to flatter the score.

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The minimum resolved forecasts a segment (system, layer, kind, or seat) needs
// before its Brier score is presented as established rather than "early, n
// resolved". Honest by default: a handful of lucky resolutions never reads as a
// proven track record. Overridable with CALIBRATION_MIN_RESOLVED_PER_SEGMENT.
export const DEFAULT_MIN_RESOLVED_PER_SEGMENT = 10;

// The calibration curve band width: stated-probability buckets of 0.1 from
// 0.0 to 1.0 (ten bands), each compared against the observed frequency.
export const CALIBRATION_BAND_SIZE = 0.1;

// The most a layer's poor track record can pull its displayed confidence down,
// in confidence points. The adjustment is downward only and never crosses the
// neutral floor, so it disciplines overconfidence without ever inflating a pill.
export const MAX_CONFIDENCE_PENALTY = 10;

// The neutral floor the confidence calibration shrinks toward. A poorly
// calibrated layer is pulled toward coin-flip neutrality, never below it.
export const CONFIDENCE_NEUTRAL_FLOOR = 50;

export interface CalibrationConfig {
  minResolvedPerSegment: number;
  bandSize: number;
  maxConfidencePenalty: number;
  confidenceNeutralFloor: number;
}

export function calibrationConfig(env: NodeJS.ProcessEnv = process.env): CalibrationConfig {
  return {
    minResolvedPerSegment: intFromEnv(
      env,
      "CALIBRATION_MIN_RESOLVED_PER_SEGMENT",
      DEFAULT_MIN_RESOLVED_PER_SEGMENT,
    ),
    bandSize: CALIBRATION_BAND_SIZE,
    maxConfidencePenalty: MAX_CONFIDENCE_PENALTY,
    confidenceNeutralFloor: CONFIDENCE_NEUTRAL_FLOOR,
  };
}
