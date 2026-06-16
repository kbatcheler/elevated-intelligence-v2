import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  decisionRecordsTable,
  layersTable,
  preMortemIndicatorsTable,
  preMortemsTable,
  tenantLayersTable,
  tenantProfileTable,
  type InsertPreMortemIndicator,
  type PreMortemRow,
} from "@workspace/db";
import {
  layerContentSchema,
  profileSchema,
  resolveCortexDataMode,
  runPreMortem,
  silentLogger,
  stripDashes,
  type LayerDescriptor,
  type Logger,
  type PreMortemInput,
  type PreMortemOutput,
  type StageContext,
  type StageTelemetry,
} from "@workspace/cortex";
import { appendEntryTx } from "../provenance/ledger";
import { recordModelUsageSafe } from "../pipeline/usage";

// The on-demand pre-mortem service (Phase AL). It mirrors the interactive
// challenge EXACTLY: a real Confounder cortex call, real billed telemetry, and an
// honest completed-or-failed lifecycle. A completed run writes the failure modes,
// one watched indicator per failure mode, and ONE hash-chained provenance entry in
// a single transaction; a failed run (a model call that returned no usable result)
// writes an honest failed row with the error and no provenance, never a fabricated
// forecast of doom.

export type RunPreMortemResult =
  | { kind: "decision_not_found" }
  | { kind: "profile_missing" }
  | { kind: "layer_not_found" }
  | { kind: "done"; preMortem: PreMortemRow };

// A stable, ASCII serialisation of the pre-mortem OUTCOME, so the provenance
// source reference binds to the exact failure modes recorded. Fixed key order.
function canonicalPreMortem(output: PreMortemOutput): string {
  return JSON.stringify({
    failure_modes: output.failure_modes.map((m) => ({
      early_warning: m.early_warning,
      likelihood: m.likelihood,
      mechanism: m.mechanism,
      rank: m.rank,
      title: m.title,
    })),
    residual_risk_note: output.residual_risk_note ?? null,
  });
}

export interface RunPreMortemParams {
  tenantId: string;
  decisionRecordId: string;
  userId: string;
  log?: Logger;
}

export async function runDecisionPreMortem(params: RunPreMortemParams): Promise<RunPreMortemResult> {
  const log = params.log ?? silentLogger;
  const { tenantId, decisionRecordId, userId } = params;

  const decisionRows = await db
    .select()
    .from(decisionRecordsTable)
    .where(and(eq(decisionRecordsTable.id, decisionRecordId), eq(decisionRecordsTable.tenantId, tenantId)))
    .limit(1);
  const decision = decisionRows[0];
  if (!decision) return { kind: "decision_not_found" };

  const profileRows = await db
    .select({ profile: tenantProfileTable.profile })
    .from(tenantProfileTable)
    .where(eq(tenantProfileTable.tenantId, tenantId))
    .limit(1);
  const profileParsed = profileRows[0] ? profileSchema.safeParse(profileRows[0].profile) : null;
  if (!profileParsed || !profileParsed.success) return { kind: "profile_missing" };

  const descriptorRows = await db
    .select({
      key: layersTable.key,
      name: layersTable.name,
      description: layersTable.description,
      diagnosticQuestion: layersTable.diagnosticQuestion,
    })
    .from(layersTable)
    .where(eq(layersTable.key, decision.layerKey))
    .limit(1);
  const descriptor = descriptorRows[0];
  if (!descriptor) return { kind: "layer_not_found" };
  const layer: LayerDescriptor = {
    key: descriptor.key,
    name: descriptor.name,
    description: descriptor.description,
    diagnosticQuestion: descriptor.diagnosticQuestion,
  };

  // The layer narrative and confounders are CONTEXT for a faithful imagination of
  // failure. Their absence is not an error: a decision can be pre-mortemed even if
  // its layer content has since been pruned.
  const layerRows = await db
    .select({ content: tenantLayersTable.content, confounders: tenantLayersTable.confounders })
    .from(tenantLayersTable)
    .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, decision.layerKey)))
    .limit(1);
  const layerRow = layerRows[0];
  const parsedContent = layerRow ? layerContentSchema.safeParse(layerRow.content) : null;
  const narrative = parsedContent && parsedContent.success ? parsedContent.data.narrative : undefined;

  const input: PreMortemInput = {
    profile: profileParsed.data,
    layer,
    decision: {
      kind: decision.decision,
      actionRef: decision.actionRef ?? undefined,
      title: decision.recommendedTitle,
      detail: decision.recommendedDetail ?? undefined,
      impact: decision.recommendedImpact ?? undefined,
      confidence: decision.systemConfidence,
      basis: decision.systemBasis,
      rationale: decision.rationale ?? undefined,
    },
    narrative,
    confounders: layerRow?.confounders ?? undefined,
  };

  const baseRow = {
    tenantId,
    decisionRecordId,
    layerKey: decision.layerKey,
    requestedBy: userId,
  };

  // A pre-mortem reuses the Confounder seat, so it honours the deployment-wide
  // sovereign regime exactly as the interactive challenge does.
  const stageCtx: StageContext = {
    dataMode: resolveCortexDataMode() === "sovereign" ? "sovereign" : "outside_in",
  };

  const telemetry: StageTelemetry[] = [];
  const result = await runPreMortem(input, log, stageCtx);
  telemetry.push(result.telemetry);
  await recordModelUsageSafe(
    { tenantId, runId: null, stage: "premortem", layerKey: decision.layerKey, telemetry: result.telemetry },
    log,
  );
  if (!result.ok) {
    const row = await insertFailedPreMortem(baseRow, result.reason, telemetry);
    return { kind: "done", preMortem: row };
  }

  const output = result.output;
  const failureModes = output.failure_modes
    .map((m) => ({
      rank: m.rank,
      title: stripDashes(m.title),
      mechanism: stripDashes(m.mechanism),
      likelihood: m.likelihood,
      earlyWarning: stripDashes(m.early_warning),
    }))
    .sort((a, b) => a.rank - b.rank);
  const residualRiskNote = output.residual_risk_note ? stripDashes(output.residual_risk_note) : null;

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        decisionRecordId,
        layerKey: decision.layerKey,
        outcome: canonicalPreMortem(output),
        tenantId,
      }),
      "utf8",
    )
    .digest("hex");
  const claimPath = `${decision.layerKey}.premortem.${decisionRecordId}`;
  const sourceRef = `premortem:sha256:${digest}`;

  const row = await db.transaction(async (tx) => {
    const entry = await appendEntryTx(tx, { tenantId, claimPath, sourceRef });
    const insertedPm = await tx
      .insert(preMortemsTable)
      .values({
        ...baseRow,
        status: "completed",
        failureModes: failureModes as unknown as Record<string, unknown>[],
        residualRiskNote,
        telemetry: telemetry as unknown as Record<string, unknown>[],
        provenanceContentHash: entry.contentHash,
      })
      .returning();
    const pm = insertedPm[0]!;
    // One watched indicator per failure mode: the single observable early sign the
    // failure is taking hold. These are things to MONITOR, real persisted state the
    // push evaluator can surface, never a fabricated breach.
    const indicators: InsertPreMortemIndicator[] = failureModes.map((m) => ({
      tenantId,
      preMortemId: pm.id,
      decisionRecordId,
      layerKey: decision.layerKey,
      failureModeRank: m.rank,
      failureModeTitle: m.title,
      label: m.earlyWarning,
    }));
    if (indicators.length > 0) {
      await tx.insert(preMortemIndicatorsTable).values(indicators);
    }
    return pm;
  });

  return { kind: "done", preMortem: row };
}

// Record a failed pre-mortem: an honest row with status failed, the failure
// reason, the real (billed) telemetry, and NO provenance entry and NO indicators
// (nothing real was produced to watch).
async function insertFailedPreMortem(
  baseRow: { tenantId: string; decisionRecordId: string; layerKey: string; requestedBy: string },
  reason: string,
  telemetry: StageTelemetry[],
): Promise<PreMortemRow> {
  const inserted = await db
    .insert(preMortemsTable)
    .values({
      ...baseRow,
      status: "failed",
      error: stripDashes(reason),
      telemetry: telemetry as unknown as Record<string, unknown>[],
    })
    .returning();
  return inserted[0]!;
}
