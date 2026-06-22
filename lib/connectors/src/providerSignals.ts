// Shared reduction helpers for the HTTP connectors. They turn raw provider
// responses into the small set of numeric signals each connector declares, and
// nothing else. Two rules are enforced here so every connector inherits them:
//
//  - A figure is computed or it is omitted, never fabricated. Every helper that
//    cannot honestly produce a number returns null, and buildSignalSet drops a
//    null-valued draft. A missing signal is then rendered as a dash by the
//    portal; it is never a fabricated zero.
//  - Only math leaves the boundary. distributionByLabel orders counts by their
//    group label and returns the counts vector only, discarding the labels, so
//    no identifier rides out in a distribution. The final assertDerivedSignalSet
//    guard rejects anything reversible as a last line of defence.
import { assertDerivedSignalSet } from "@workspace/db/contracts";
import type { DerivedSignalSet, SignalKind } from "@workspace/db/contracts";
import { getDescriptor } from "./catalogue";
import type {
  Connector,
  ConnectorContext,
  ExtractionResult,
  ExtractionScope,
} from "./contract";

// A draft signal before the boundary guard. A null value means the figure could
// not be computed honestly and the signal is omitted from the set.
export interface SignalDraft {
  key: string;
  kind: SignalKind;
  value: number | number[] | null;
  unit?: string;
  window?: string;
}

// Build a connector object from its catalogue descriptor plus an extraction
// function, so a connector module declares only the descriptor key and its
// reduction logic and inherits family, layers, auth, and deployment from the one
// catalogue source of truth.
export function buildConnector(
  key: string,
  extract: (scope: ExtractionScope, ctx: ConnectorContext) => Promise<ExtractionResult>,
): Connector {
  const descriptor = getDescriptor(key);
  if (!descriptor) {
    throw new Error("No catalogue descriptor for connector: " + key);
  }
  return {
    key: descriptor.key,
    family: descriptor.family,
    layers: descriptor.layers,
    authMethod: descriptor.authMethod,
    deployment: descriptor.deployment,
    signalsProduced: descriptor.signalsProduced,
    extractSignals: extract,
  };
}

// Drop null and non-finite drafts, then run the boundary guard. Vector drafts
// must be non-empty and entirely finite to survive.
export function buildSignalSet(args: {
  source: string;
  scope: ExtractionScope;
  ctx: ConnectorContext;
  drafts: SignalDraft[];
}): DerivedSignalSet {
  // Allowlist guard: a connector may only ever emit the signals it DECLARES in
  // the catalogue. An undeclared key is a programming error (a renamed or stray
  // signal), not a runtime condition, so it fails loudly here rather than
  // silently leaking an unexpected key past the boundary.
  const descriptor = getDescriptor(args.source);
  if (!descriptor) {
    throw new Error("No catalogue descriptor for connector: " + args.source);
  }
  const declared = new Set(descriptor.signalsProduced);
  for (const draft of args.drafts) {
    if (!declared.has(draft.key)) {
      throw new Error(
        "Undeclared signal key for connector " + args.source + ": " + draft.key,
      );
    }
  }

  const signals = args.drafts
    .filter((d): d is SignalDraft & { value: number | number[] } => {
      if (d.value === null) return false;
      if (Array.isArray(d.value)) {
        return d.value.length > 0 && d.value.every((n) => Number.isFinite(n));
      }
      return Number.isFinite(d.value);
    })
    .map((d) => ({
      key: d.key,
      kind: d.kind,
      value: d.value,
      ...(d.unit ? { unit: d.unit } : {}),
      ...(d.window ? { window: d.window } : {}),
    }));

  return assertDerivedSignalSet({
    source: args.source,
    tenantId: args.scope.tenantId,
    generatedAt: args.ctx.now().toISOString(),
    ...(args.scope.window
      ? { windowStart: args.scope.window.start, windowEnd: args.scope.window.end }
      : {}),
    signals,
  });
}

// A ratio, or null when it cannot be formed (non-finite inputs or a zero
// denominator). Never returns a fabricated zero for an undefined ratio.
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

// A fractional change from prior to current, or null when either input is
// missing or the prior is zero (an undefined change, not a zero one).
export function trendDelta(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  const d = (current - prior) / prior;
  return Number.isFinite(d) ? d : null;
}

// The arithmetic mean of the finite values, or null when there are none.
export function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const m = finite.reduce((a, b) => a + b, 0) / finite.length;
  return Number.isFinite(m) ? m : null;
}

export function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

// Order counts by ascending group label and return the counts vector only. The
// labels impose a stable order and are then discarded, so a distribution carries
// no identifier out of the boundary.
export function distributionByLabel(counts: Map<string, number>): number[] | null {
  if (counts.size === 0) return null;
  const labels = [...counts.keys()].sort();
  const vector = labels.map((l) => counts.get(l) as number);
  if (vector.some((n) => !Number.isFinite(n))) return null;
  return vector;
}

// Coerce a provider value to a number. Strings may carry thousands separators; an
// empty string is not a zero, it is missing, so it becomes NaN and is dropped
// downstream rather than fabricating a zero.
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const s = value.replace(/,/g, "").trim();
    if (s === "") return NaN;
    return Number(s);
  }
  return NaN;
}

// Parse a provider timestamp that may be an ISO 8601 string or epoch
// milliseconds (as a number or an all-digit string).
export function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return NaN;
    if (/^\d+$/.test(s)) return Number(s);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

export function daysBetweenTs(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return NaN;
  return (endMs - startMs) / 86_400_000;
}

export interface WindowSpec {
  start: Date;
  end: Date;
  priorStart: Date;
  priorEnd: Date;
}

// The current lookback window of the given length ending now, plus the
// immediately preceding window of the same length for a trend comparison.
export function computeWindows(now: Date, days: number): WindowSpec {
  const end = now;
  const start = new Date(end.getTime() - days * 86_400_000);
  const priorEnd = start;
  const priorStart = new Date(priorEnd.getTime() - days * 86_400_000);
  return { start, end, priorStart, priorEnd };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoDateTime(d: Date): string {
  return d.toISOString();
}

export function epochSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

// A non-identifying lookback label, for example "P90D", recorded on a signal so
// the window it summarises is explicit without carrying any date value.
export function windowLabel(days: number): string {
  return "P" + days + "D";
}
