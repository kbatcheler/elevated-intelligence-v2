import type { PipelineRun } from "../types";

export interface SeatAgg {
  stages: number;
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
  durationMs: number;
}

// Sum the per-seat telemetry the pipeline actually recorded. Nothing here is
// computed beyond adding up values the runs persisted; a seat with no recorded
// stages simply has no aggregate, which is honest rather than invented.
//
// One subtlety keeps the Evaluator honest: it produces hero, peers and
// supplements from a SINGLE batched model call. The orchestrator records that
// call's real tokens and latency once (on hero) and marks the peers and
// supplements telemetry batched (seat and model only, no tokens, zero latency).
// We still count each as a stage the seat produced, because it did contribute a
// distinct artefact, but we never add a batched stage's cost. Without this
// guard, a single Evaluator call would be triple-counted in the tokens and
// latency totals.
export function aggregateBySeat(runs: readonly PipelineRun[]): Map<string, SeatAgg> {
  const m = new Map<string, SeatAgg>();
  for (const r of runs) {
    for (const s of r.subStages) {
      const seat = s.telemetry?.seat;
      if (!seat) continue;
      const cur = m.get(seat) ?? { stages: 0, inputTokens: 0, outputTokens: 0, searchCalls: 0, durationMs: 0 };
      cur.stages += 1;
      if (!s.telemetry?.batched) {
        cur.inputTokens += s.telemetry?.inputTokens ?? 0;
        cur.outputTokens += s.telemetry?.outputTokens ?? 0;
        cur.searchCalls += s.telemetry?.searchCalls ?? 0;
        cur.durationMs += s.durationMs ?? 0;
      }
      m.set(seat, cur);
    }
  }
  return m;
}
