import type { PipelineRun, SignalConfounder, SignalLayer } from "../types";

// The anomaly inbox derives entirely from real, persisted signals; it never
// computes or invents a figure. It surfaces, in descending urgency:
//   1. errored-run            a pipeline stage actually failed, so a layer's
//                             intelligence is incomplete.
//   2. unresolved-confounder  the analysis could NOT rule out an alternative
//                             explanation (verdict unresolved, then partial).
//   3. low-confidence-action  a MODELLED action is recommended on a confidence
//                             below the selection threshold.
//   4. open-gap               a known blind spot, ranked by the real confidence
//                             lift that closing it would yield.
// The confidence threshold is a SELECTION rule only: it decides which modelled
// actions are flagged. It is never displayed as a computed score. Every figure
// shown (confidence, confidence lift) is a value the cortex persisted. Every
// anomaly carries its layerKey so the inbox reaches the layer in one hop,
// honouring the two-click diagnosis rule. Ungenerated layers are skipped, never
// mined for a fabricated anomaly.

export type AnomalyKind =
  | "errored-run"
  | "unresolved-confounder"
  | "low-confidence-action"
  | "open-gap";

export interface Anomaly {
  kind: AnomalyKind;
  layerKey: string;
  layerName: string;
  title: string;
  detail: string;
  // The real persisted figure behind this row, or null when there is none
  // (errored runs and confounders carry no single number). Safe to display.
  metric: number | null;
  metricLabel: string | null;
}

export interface AnomalyOptions {
  confidenceThreshold: number;
}

const DEFAULT_OPTIONS: AnomalyOptions = { confidenceThreshold: 60 };

// Unresolved is more urgent than partial; ruled_out never reaches selection.
function confounderUrgency(verdict: SignalConfounder["verdict"]): number {
  return verdict === "unresolved" ? 0 : 1;
}

function layerOrder(byKey: Map<string, SignalLayer>, key: string): number {
  return byKey.get(key)?.sortOrder ?? Number.POSITIVE_INFINITY;
}

// Drop the private sort keys, leaving the public Anomaly shape.
function strip<T extends Anomaly>(a: T): Anomaly {
  return {
    kind: a.kind,
    layerKey: a.layerKey,
    layerName: a.layerName,
    title: a.title,
    detail: a.detail,
    metric: a.metric,
    metricLabel: a.metricLabel,
  };
}

export function deriveAnomalies(
  signals: readonly SignalLayer[],
  runs: readonly PipelineRun[],
  opts: AnomalyOptions = DEFAULT_OPTIONS,
): Anomaly[] {
  const byKey = new Map(signals.map((s) => [s.key, s]));

  const erroredRuns: Anomaly[] = [];
  for (const run of runs) {
    const failedStage = run.subStages.find((s) => s.status === "error");
    if (run.status !== "error" && failedStage == null) continue;
    const layer = byKey.get(run.layerKey);
    const detail = failedStage
      ? `Stage "${failedStage.name}" failed${failedStage.error ? `: ${failedStage.error}` : ""}.`
      : run.error
        ? `Run failed: ${run.error}.`
        : "Run ended in an error state.";
    erroredRuns.push({
      kind: "errored-run",
      layerKey: run.layerKey,
      layerName: layer?.name ?? run.layerKey,
      title: "Reasoning run did not complete",
      detail,
      metric: null,
      metricLabel: null,
    });
  }
  erroredRuns.sort((a, b) => layerOrder(byKey, a.layerKey) - layerOrder(byKey, b.layerKey));

  const confounders: (Anomaly & { _urgency: number; _rank: number; _order: number })[] = [];
  const lowActions: (Anomaly & { _conf: number; _order: number })[] = [];
  const gaps: (Anomaly & { _lift: number; _order: number })[] = [];

  for (const s of signals) {
    if (!s.generated) continue;
    const ord = s.sortOrder;

    for (const c of s.confounders) {
      if (c.verdict !== "partial" && c.verdict !== "unresolved") continue;
      confounders.push({
        kind: "unresolved-confounder",
        layerKey: s.key,
        layerName: s.name,
        title: c.name ?? "Unresolved alternative explanation",
        detail: c.reason ?? c.mechanism ?? "The analysis could not rule this out.",
        metric: null,
        metricLabel: null,
        _urgency: confounderUrgency(c.verdict),
        _rank: c.rank ?? Number.POSITIVE_INFINITY,
        _order: ord,
      });
    }

    for (const a of s.actions) {
      if (a.basis !== "modelled" || a.confidence == null) continue;
      if (a.confidence >= opts.confidenceThreshold) continue;
      lowActions.push({
        kind: "low-confidence-action",
        layerKey: s.key,
        layerName: s.name,
        title: a.title ?? "Modelled action below confidence threshold",
        detail: a.impact ?? "Recommended on a modelled basis.",
        metric: a.confidence,
        metricLabel: "confidence",
        _conf: a.confidence,
        _order: ord,
      });
    }

    for (const g of s.gaps) {
      if (g.confidenceLiftPp == null) continue;
      gaps.push({
        kind: "open-gap",
        layerKey: s.key,
        layerName: s.name,
        title: g.description ?? "Open intelligence gap",
        detail: g.closes ?? "Closing this gap would raise confidence.",
        metric: g.confidenceLiftPp,
        metricLabel: "confidence lift",
        _lift: g.confidenceLiftPp,
        _order: ord,
      });
    }
  }

  confounders.sort((a, b) => a._urgency - b._urgency || a._rank - b._rank || a._order - b._order);
  lowActions.sort((a, b) => a._conf - b._conf || a._order - b._order);
  gaps.sort((a, b) => b._lift - a._lift || a._order - b._order);

  return [
    ...erroredRuns,
    ...confounders.map(strip),
    ...lowActions.map(strip),
    ...gaps.map(strip),
  ];
}
