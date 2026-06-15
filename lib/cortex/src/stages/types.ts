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
  // Prompt-cache accounting (Anthropic seats): tokens read from a cached prefix
  // and tokens written to the cache. The observable proof of prefix caching.
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  latencyMs: number;
  searchCalls?: number;
  // True for a sub-stage whose cost was folded into a sibling's single batched
  // model call (the Evaluator's hero+peers+supplements are one Haiku call). The
  // Intelligence Architecture summation must not double-count these.
  batched?: boolean;
  // True only when a real, token-billed provider response was received for this
  // stage (a 200 with usage), success OR a schema-validation failure. The cost
  // ledger records a row only for billed calls: a no-call failure (no in-boundary
  // model configured, missing provider env, or a transport error before any
  // response) carries billed:false and is honestly never costed.
  billed?: boolean;
  // Phase AF sovereign-mode honesty markers, present ONLY on a stage that ran
  // in-boundary because the whole run is sovereign. They are absent for outside_in
  // and connected stages (so those telemetry payloads are byte-for-byte
  // unchanged), and they let the portal surface the honest "reasoned in sovereign
  // mode" badge without ever inventing a verification or search channel that did
  // not run.
  executionMode?: "sovereign";
  // False on a sovereign stage: no external Gemini grounding or Anthropic
  // web-search channel was available. Never claims a channel that did not run.
  groundingAvailable?: boolean;
  webSearchAvailable?: boolean;
}

export type StageResult<T> =
  | { ok: true; output: T; telemetry: StageTelemetry }
  | { ok: false; reason: string; telemetry: StageTelemetry };
