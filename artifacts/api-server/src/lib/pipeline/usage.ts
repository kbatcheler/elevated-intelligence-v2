// Phase N usage ledger writer. The orchestrator is the single owner of every
// pipeline side effect and the one place both provider wrappers' telemetry
// surfaces, so it is the one place that records cost. This module turns a real
// call's telemetry into a priced model_usage row. It never invents a number: the
// token counts are the wrapper's, and costUsd is those counts run through the
// configured list-price rates (lib/cortex/pricing).

import { costUsdForUsage, type Logger } from "@workspace/cortex";
import { db, modelUsageTable } from "@workspace/db";

export interface UsageTelemetry {
  seat?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  searchCalls?: number;
  // True only when a real, token-billed provider response was received (success
  // OR a schema-validation failure that still consumed tokens). The gate below
  // records a row only when this is true.
  billed?: boolean;
}

export interface RecordUsageParams {
  // Null only when the tenant identity is not yet known; populated for every
  // normal call, including the profile (recorded once the tenant shell exists).
  tenantId: string | null;
  // The per-layer run, or null for the tenant-scope profile call.
  runId: string | null;
  // perceive | hypothesise | confound | challenge | narrate | score, or
  // "enrichment" for the single batched Evaluator call, or "profile".
  stage: string;
  layerKey: string | null;
  telemetry: UsageTelemetry;
}

// Insert one priced row for a real model call. A row is recorded ONLY for a
// billed call: one where a real provider request returned a 200 that consumed
// tokens (success, or a schema-validation failure whose tokens were still
// spent). A no-call failure (no in-boundary model configured, missing provider
// env, a transport error before any response) carries billed:false and is never
// recorded: costing it would fabricate a zero-cost call that never happened.
// costUsd is written as a fixed six-decimal string to land exactly in the
// numeric(12,6) column.
export async function recordModelUsage(p: RecordUsageParams): Promise<void> {
  const t = p.telemetry;
  if (!t.billed || !t.model) return;
  const costUsd = costUsdForUsage({
    model: t.model,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens,
    searchCalls: t.searchCalls,
  });
  await db.insert(modelUsageTable).values({
    tenantId: p.tenantId,
    runId: p.runId,
    stage: p.stage,
    layerKey: p.layerKey,
    seat: t.seat ?? "unknown",
    model: t.model,
    inputTokens: t.inputTokens ?? 0,
    outputTokens: t.outputTokens ?? 0,
    cacheReadTokens: t.cacheReadTokens ?? 0,
    cacheCreationTokens: t.cacheCreationTokens ?? 0,
    webSearchCalls: t.searchCalls ?? 0,
    costUsd: costUsd.toFixed(6),
  });
}

// Best-effort wrapper for the orchestrator taps. Cost recording is observability:
// a failed insert must be logged loudly, but it must never abort a layer that has
// already spent real model budget and produced a real diagnosis. The throwing
// recordModelUsage is kept for tests that assert the row is written.
export async function recordModelUsageSafe(p: RecordUsageParams, log: Logger): Promise<void> {
  try {
    await recordModelUsage(p);
  } catch (err) {
    log.error(
      {
        stage: p.stage,
        layerKey: p.layerKey,
        err: err instanceof Error ? err.message : String(err),
      },
      "model usage recording failed",
    );
  }
}
