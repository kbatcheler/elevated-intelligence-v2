// Phase AM as-of replay math. Pure functions, no database and no I/O, so the
// "what changed since" diff between a past snapshot and the current one is a
// deterministic computation a hand-worked unit test can pin down. Nothing is
// fabricated: a delta is only a number when BOTH sides are present, otherwise it
// is null and the surface says the value is unavailable rather than implying a
// move from or to zero.

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Count the object items in a claims blob ({ items: [...] }), matching the same
// predicate the efficacy service uses, so the diff's verified/modelled counts
// agree with the efficacy index they sit beside.
export function countClaimItems(claims: unknown): number {
  const items = (claims as { items?: unknown } | null)?.items;
  return Array.isArray(items)
    ? items.filter((x) => x != null && typeof x === "object").length
    : 0;
}

// Count the object entries in a confounders array (null and non-object stray
// entries ignored), matching the efficacy service's adversarial-survival input.
export function countObjectArray(v: unknown): number {
  return Array.isArray(v) ? v.filter((x) => x != null && typeof x === "object").length : 0;
}

// The comparable reduction of one layer build: its content fingerprint, the
// verified/modelled/confounder counts, and the two derived figures (efficacy
// score and the disciplined confidence value). Either derived figure is null
// when it could not be computed for that build (an honest absence).
export interface AsOfLayerSummary {
  contentHash: string;
  verifiedCount: number;
  modelledCount: number;
  confounderCount: number;
  efficacyScore: number | null;
  confidenceValue: number | null;
}

// The diff a layer's as-of view carries. contentChanged is null when there is no
// current build to compare against (the layer existed then but not now, or vice
// versa). Each delta is current minus as-of, and is null unless both sides have
// the figure.
export interface AsOfLayerDiff {
  hasCurrent: boolean;
  contentChanged: boolean | null;
  efficacyDelta: number | null;
  confidenceDelta: number | null;
  verifiedDelta: number | null;
  modelledDelta: number | null;
  confounderDelta: number | null;
}

function delta(current: number | null, asOf: number | null, places: number): number | null {
  if (current === null || asOf === null) return null;
  return round(current - asOf, places);
}

// Diff a layer's as-of summary against its current summary. When either side is
// absent the structural fields are null (nothing to compare), never zeroed.
export function diffLayerSummaries(
  asOf: AsOfLayerSummary | null,
  current: AsOfLayerSummary | null,
): AsOfLayerDiff {
  if (!asOf || !current) {
    return {
      hasCurrent: current != null,
      contentChanged: null,
      efficacyDelta: null,
      confidenceDelta: null,
      verifiedDelta: null,
      modelledDelta: null,
      confounderDelta: null,
    };
  }
  return {
    hasCurrent: true,
    contentChanged: asOf.contentHash !== current.contentHash,
    efficacyDelta: delta(current.efficacyScore, asOf.efficacyScore, 1),
    confidenceDelta: delta(current.confidenceValue, asOf.confidenceValue, 2),
    verifiedDelta: current.verifiedCount - asOf.verifiedCount,
    modelledDelta: current.modelledCount - asOf.modelledCount,
    confounderDelta: current.confounderCount - asOf.confounderCount,
  };
}
