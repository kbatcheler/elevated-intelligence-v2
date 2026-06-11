// Shared types for the pure stage runners. StageTelemetry is structurally a
// superset-compatible match for the database SeatTelemetry contract, so the
// orchestrator can persist it directly without a mapping layer.

export interface StageTelemetry {
  // The product role that ran the stage (Lens, Synthesist, Confounder, ...).
  seat: string;
  // The model string, resolved from CORTEX config.
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  searchCalls?: number;
}

export type StageResult<T> =
  | { ok: true; output: T; telemetry: StageTelemetry }
  | { ok: false; reason: string; telemetry: StageTelemetry };
