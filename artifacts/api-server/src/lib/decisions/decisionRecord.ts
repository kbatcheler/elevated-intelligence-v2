import { createHash } from "node:crypto";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import {
  db,
  decisionRecordsTable,
  forecastsTable,
  provenanceLedgerTable,
  tenantLayersTable,
  type DecisionEvidenceRef,
  type DecisionKind,
  type DecisionRecordRow,
} from "@workspace/db";
import { layerContentSchema, stripDashes } from "@workspace/cortex";
import { appendEntryTx } from "../provenance/ledger";
import { parsePredictedValueUsd } from "../outcomes/predictedValue";
import { extractFinding, parseFindingRef } from "../challenge/findingChallenge";

// The decision ledger writer (Phase AL). A decision is a recorded HUMAN act, not
// a model call: it always appends one hash-chained provenance entry and snapshots
// the EXACT recommendation it acted on, so a later refresh of the layer can never
// silently re-point the audit. Three kinds: a commit (the existing Phase W path,
// which also creates a committed action and binds its forecast), and a defer or a
// reject (which record the decision without committing, leaving the recommendation
// in the diagnosis and capturing that it was deliberately not taken).

// A database transaction handle, typed structurally off db.transaction so the
// decision write composes inside the commit transaction (action insert + forecast
// link + decision record, all atomic) without importing drizzle's internal type.
type DecisionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The system recommendation as it stood at decision time. Captured from the real
// committed action (a commit) or the real layer content (a defer or reject), then
// hashed so the audit binds to the precise version it acted on.
export interface RecommendationSnapshot {
  title: string;
  detail: string | null;
  impact: string | null;
  predictedValueUsd: number | null;
  confidence: number;
  basis: string;
}

// A stable, ASCII serialisation of the EXACT recommendation, so its hash is
// reproducible and binds a decision to the precise version it acted on. Fixed key
// order; null fields omitted. Mirrors canonicalFindingText in the challenge path.
export function canonicalRecommendation(
  actionRef: string | null,
  s: RecommendationSnapshot,
): string {
  const obj: Record<string, unknown> = {};
  if (actionRef !== null) obj.actionRef = actionRef;
  obj.title = s.title;
  if (s.detail !== null) obj.detail = s.detail;
  if (s.impact !== null) obj.impact = s.impact;
  if (s.predictedValueUsd !== null) obj.predictedValueUsd = s.predictedValueUsd;
  obj.confidence = s.confidence;
  obj.basis = s.basis;
  return JSON.stringify(obj);
}

export function recommendationHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// A claimPath under a layer is decision EVIDENCE only when it is one of the
// layer's graded claims, not one of the meta entries the decision ledger itself
// appends (a decision act, a finding challenge, or a pre-mortem). Excluding the
// meta prefixes keeps the snapshot to the evidence the recommendation rested on.
function isLayerEvidenceClaim(layerKey: string, claimPath: string): boolean {
  if (claimPath === layerKey) return false;
  const meta = [`${layerKey}.decision.`, `${layerKey}.challenge.`, `${layerKey}.premortem.`];
  return !meta.some((prefix) => claimPath.startsWith(prefix));
}

// A stable serialisation of an evidence-ref set, so a decision's provenance entry
// can bind to the EXACT evidence it acted on. Sorted by claimPath; references
// only.
export function canonicalEvidenceRefs(refs: readonly DecisionEvidenceRef[]): string {
  return JSON.stringify(refs.map((r) => ({ claimPath: r.claimPath, contentHash: r.contentHash })));
}

// Snapshot the provenance refs that ground a layer's diagnosis right now: the
// latest ledger entry per claimPath under the layer (provenance is append-only,
// so a re-grade appends a fresh entry for the same claimPath and the newest is
// the live evidence). References only, never raw evidence. An empty array is the
// honest state for a layer with no graded claims yet; it is never fabricated.
export async function snapshotLayerEvidence(
  tenantId: string,
  layerKey: string,
): Promise<DecisionEvidenceRef[]> {
  const rows = await db
    .select({
      claimPath: provenanceLedgerTable.claimPath,
      contentHash: provenanceLedgerTable.contentHash,
      createdAt: provenanceLedgerTable.createdAt,
    })
    .from(provenanceLedgerTable)
    .where(and(eq(provenanceLedgerTable.tenantId, tenantId), like(provenanceLedgerTable.claimPath, `${layerKey}.%`)))
    .orderBy(desc(provenanceLedgerTable.createdAt));
  // Newest first; keep the first contentHash seen per claimPath (the live one).
  const latest = new Map<string, string>();
  for (const r of rows) {
    if (r.claimPath === null) continue;
    if (!isLayerEvidenceClaim(layerKey, r.claimPath)) continue;
    if (!latest.has(r.claimPath)) latest.set(r.claimPath, r.contentHash);
  }
  return [...latest.entries()]
    .map(([claimPath, contentHash]) => ({ claimPath, contentHash }))
    .sort((a, b) => (a.claimPath < b.claimPath ? -1 : a.claimPath > b.claimPath ? 1 : 0));
}

export type LoadSnapshotResult =
  | { kind: "layer_not_found" }
  | { kind: "finding_not_found" }
  | { kind: "not_an_action" }
  | { kind: "ok"; snapshot: RecommendationSnapshot };

// Read the system recommendation for an action SERVER-SIDE from the live layer
// content, so a decision never trusts a client to describe what the system
// recommended. The single reader shared by a defer or reject and by a commit that
// names an actionRef; the board audit binds to the real, current recommendation.
export async function loadRecommendationSnapshot(
  tenantId: string,
  layerKey: string,
  actionRef: string,
): Promise<LoadSnapshotResult> {
  const parsedRef = parseFindingRef(actionRef);
  // A decision is recorded against a recommended ACTION; a cause or hypothesis is
  // not a thing a board commits, defers, or rejects.
  if (!parsedRef) return { kind: "finding_not_found" };
  if (parsedRef.kind !== "actions") return { kind: "not_an_action" };

  const layerRows = await db
    .select({ content: tenantLayersTable.content })
    .from(tenantLayersTable)
    .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layerKey)))
    .limit(1);
  const layerRow = layerRows[0];
  if (!layerRow) return { kind: "layer_not_found" };

  const parsedContent = layerContentSchema.safeParse(layerRow.content);
  if (!parsedContent.success) return { kind: "finding_not_found" };
  const finding = extractFinding(parsedContent.data, parsedRef, actionRef);
  if (!finding) return { kind: "finding_not_found" };

  return {
    kind: "ok",
    snapshot: {
      title: finding.title,
      detail: finding.detail ?? null,
      impact: finding.impact ?? null,
      predictedValueUsd: parsePredictedValueUsd(finding.impact),
      confidence: finding.confidence,
      basis: finding.basis,
    },
  };
}

export interface RecordDecisionParams {
  tenantId: string;
  layerKey: string;
  actionRef: string | null;
  decision: DecisionKind;
  committedActionId: string | null;
  decidedBy: string;
  snapshot: RecommendationSnapshot;
  // Whether the snapshot was read server-side from persisted layer content. A
  // defer or reject, and a commit naming an actionRef, are verified; a freeform
  // commit with no ref is not.
  recommendationVerified: boolean;
  // The provenance refs grounding the layer at decision time, snapshotted onto the
  // decision and bound into its provenance entry.
  evidenceRefs: DecisionEvidenceRef[];
  rationale: string | null;
  forecastId: string | null;
}

// Write one decision record inside a supplied transaction: dash-sanitise the
// snapshot text, hash the canonical recommendation, append exactly one provenance
// entry, and insert the row. The provenance source reference is a digest over the
// decision OUTCOME; the human's rationale is hashed in, never embedded raw, so the
// ledger reveals that a reason existed without leaking its text.
export async function recordDecisionTx(
  tx: DecisionTx,
  params: RecordDecisionParams,
): Promise<DecisionRecordRow> {
  const title = stripDashes(params.snapshot.title);
  const detail = params.snapshot.detail === null ? null : stripDashes(params.snapshot.detail);
  const impact = params.snapshot.impact === null ? null : stripDashes(params.snapshot.impact);
  const basis = stripDashes(params.snapshot.basis);
  const rationale = params.rationale ? stripDashes(params.rationale) : null;
  const snapshot: RecommendationSnapshot = {
    title,
    detail,
    impact,
    predictedValueUsd: params.snapshot.predictedValueUsd,
    confidence: params.snapshot.confidence,
    basis,
  };

  const canonical = canonicalRecommendation(params.actionRef, snapshot);
  const recHash = recommendationHash(canonical);
  // A commit follows the recommendation; a defer or reject does not. Computed
  // once here, never re-derived from mutable state.
  const contradicts = params.decision !== "commit";
  // The evidence set is hashed into the decision's provenance entry, so the audit
  // binds to the EXACT provenance refs the recommendation rested on at decision
  // time, not just the recommendation text.
  const evidenceHash = createHash("sha256")
    .update(canonicalEvidenceRefs(params.evidenceRefs), "utf8")
    .digest("hex");

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        actionRef: params.actionRef,
        committedActionId: params.committedActionId,
        contradictsRecommendation: contradicts,
        decidedBy: params.decidedBy,
        decision: params.decision,
        evidenceRefsHash: evidenceHash,
        forecastId: params.forecastId,
        layerKey: params.layerKey,
        rationaleHash: rationale ? createHash("sha256").update(rationale, "utf8").digest("hex") : null,
        recommendationHash: recHash,
        recommendationVerified: params.recommendationVerified,
        tenantId: params.tenantId,
      }),
      "utf8",
    )
    .digest("hex");
  const anchor = params.actionRef ?? params.committedActionId ?? "unknown";
  const claimPath = `${params.layerKey}.decision.${anchor}`;
  const sourceRef = `decision:sha256:${digest}`;

  const entry = await appendEntryTx(tx, { tenantId: params.tenantId, claimPath, sourceRef });
  const inserted = await tx
    .insert(decisionRecordsTable)
    .values({
      tenantId: params.tenantId,
      layerKey: params.layerKey,
      actionRef: params.actionRef,
      decision: params.decision,
      committedActionId: params.committedActionId,
      decidedBy: params.decidedBy,
      recommendedTitle: title,
      recommendedDetail: detail,
      recommendedImpact: impact,
      recommendedValueUsd:
        snapshot.predictedValueUsd === null ? null : snapshot.predictedValueUsd.toFixed(2),
      systemConfidence: snapshot.confidence,
      systemBasis: basis,
      recommendationHash: recHash,
      recommendationVerified: params.recommendationVerified,
      evidenceRefs: params.evidenceRefs,
      rationale,
      contradictsRecommendation: contradicts,
      forecastId: params.forecastId,
      provenanceContentHash: entry.contentHash,
    })
    .returning();
  return inserted[0]!;
}

export type RecordStandaloneResult =
  | { kind: "layer_not_found" }
  | { kind: "finding_not_found" }
  | { kind: "not_an_action" }
  | { kind: "done"; record: DecisionRecordRow };

// Record a defer or a reject. Unlike a commit, this creates no committed action
// and mutates no forecast: it reads the recommended action straight from the live
// layer content, snapshots it, and records ONLY the decision and (by reference,
// unbound) the action_outcome forecast that addresses it. The recommendation is
// left in the diagnosis; the audit captures that it was deliberately not taken.
export async function recordStandaloneDecision(args: {
  tenantId: string;
  layerKey: string;
  actionRef: string;
  decision: "defer" | "reject";
  rationale: string;
  decidedBy: string;
}): Promise<RecordStandaloneResult> {
  // Read the system recommendation SERVER-SIDE from the live layer content; a
  // defer or reject never trusts a client to describe what the system advised.
  const loaded = await loadRecommendationSnapshot(args.tenantId, args.layerKey, args.actionRef);
  if (loaded.kind !== "ok") return { kind: loaded.kind };
  const snapshot = loaded.snapshot;

  // Snapshot the provenance refs grounding the layer's diagnosis right now, so the
  // audit shows the evidence the recommendation rested on at decision time.
  const evidenceRefs = await snapshotLayerEvidence(args.tenantId, args.layerKey);

  // Snapshot the action_outcome forecast that addresses this action BY REFERENCE
  // only: newest unresolved, unbound forecast anchored to (layer, sourcePath).
  // A defer or reject never binds or resolves it; it only records which forecast
  // the decision concerns, leaving it open for later owner adjudication.
  const forecastRows = await db
    .select({ id: forecastsTable.id })
    .from(forecastsTable)
    .where(
      and(
        eq(forecastsTable.tenantId, args.tenantId),
        eq(forecastsTable.kind, "action_outcome"),
        eq(forecastsTable.layerKey, args.layerKey),
        eq(forecastsTable.sourcePath, args.actionRef),
        isNull(forecastsTable.committedActionId),
        isNull(forecastsTable.resolvedAt),
      ),
    )
    .orderBy(desc(forecastsTable.madeAt))
    .limit(1);
  const forecastId = forecastRows[0]?.id ?? null;

  const record = await db.transaction((tx) =>
    recordDecisionTx(tx, {
      tenantId: args.tenantId,
      layerKey: args.layerKey,
      actionRef: args.actionRef,
      decision: args.decision,
      committedActionId: null,
      decidedBy: args.decidedBy,
      snapshot,
      // A defer or reject always reads the recommendation server-side, so it is
      // verified by construction.
      recommendationVerified: true,
      evidenceRefs,
      rationale: args.rationale,
      forecastId,
    }),
  );
  return { kind: "done", record };
}
