import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  findingChallengesTable,
  layersTable,
  tenantLayersTable,
  tenantProfileTable,
  usersTable,
  type FindingChallengeRow,
} from "@workspace/db";
import {
  layerContentSchema,
  profileSchema,
  resolveCortexDataMode,
  runFindingChallengeConfound,
  runFindingChallengeDecision,
  silentLogger,
  stripDashes,
  type FindingChallengeInput,
  type LayerDescriptor,
  type Logger,
  type StageContext,
  type StageTelemetry,
} from "@workspace/cortex";
import { appendEntryTx } from "../provenance/ledger";
import { recordModelUsageSafe } from "../pipeline/usage";

// Interactive Challenge (Phase AA). A challenge re-reasons ONE finding through
// the Confounder (Gemini) and Synthesist (Claude) seats and records the verdict
// as an APPEND-ONLY overlay: the finding in tenant_layers is never mutated or
// deleted, a completed challenge appends one hash-chained provenance entry, and a
// revise records a "modelled_user_informed" basis on the challenge row only. The
// user's objection is context the engine tests, never an instruction it obeys.

// The four challengeable claim kinds, keyed by their array name in the stored
// content and labelled in human terms for the prompt and the audit row.
const KIND_LABEL: Record<string, string> = {
  causes: "cause",
  actions: "action",
  hypotheses: "hypothesis",
  metrics: "metric",
};

export interface ParsedFindingRef {
  kind: keyof typeof KIND_LABEL;
  index: number;
}

// Parse a finding reference of the form "causes[0]" / "actions[1]" /
// "hypotheses[2]" / "metrics[3]". Returns null for any other shape, so a route
// can answer 400 rather than guess.
export function parseFindingRef(ref: string): ParsedFindingRef | null {
  const m = /^(causes|actions|hypotheses|metrics)\[(\d+)\]$/.exec(ref);
  if (!m) return null;
  const kind = m[1] as keyof typeof KIND_LABEL;
  const index = Number(m[2]);
  if (!Number.isInteger(index) || index < 0) return null;
  return { kind, index };
}

// A finding normalised across the four kinds to a single shape the prompt and the
// audit row can use. title is always present; detail and impact are filled where
// the kind has them.
export interface ExtractedFinding {
  ref: string;
  kind: string;
  title: string;
  detail?: string;
  impact?: string;
  confidence: number;
  basis: string;
}

type LayerContentShape = ReturnType<typeof layerContentSchema.parse>;

// Pull the referenced finding out of parsed layer content, mapping each kind's
// fields onto the normalised shape. Returns null when the index is out of range.
export function extractFinding(
  content: LayerContentShape,
  parsed: ParsedFindingRef,
  ref: string,
): ExtractedFinding | null {
  const label = KIND_LABEL[parsed.kind];
  if (parsed.kind === "causes") {
    const c = content.causes[parsed.index];
    if (!c) return null;
    return { ref, kind: label, title: c.title, impact: c.impact, detail: c.detail, confidence: c.confidence, basis: c.basis };
  }
  if (parsed.kind === "actions") {
    const a = content.actions[parsed.index];
    if (!a) return null;
    return { ref, kind: label, title: a.title, detail: a.detail, impact: a.impact, confidence: a.confidence, basis: a.basis };
  }
  if (parsed.kind === "hypotheses") {
    const h = content.hypotheses[parsed.index];
    if (!h) return null;
    return {
      ref,
      kind: label,
      title: h.statement,
      detail: h.supportingSignals,
      impact: h.alternativeExplanation,
      confidence: h.confidence,
      basis: h.basis,
    };
  }
  const mtr = content.metrics[parsed.index];
  if (!mtr) return null;
  return { ref, kind: label, title: mtr.label, impact: mtr.value, detail: mtr.sub, confidence: mtr.confidence, basis: mtr.basis };
}

// A stable, ASCII serialisation of the EXACT challenged finding, so its hash is
// reproducible and binds a challenge to the precise version it addressed. Fixed
// key order; undefined fields omitted.
export function canonicalFindingText(f: ExtractedFinding): string {
  const obj: Record<string, unknown> = { ref: f.ref, kind: f.kind, title: f.title };
  if (f.impact !== undefined) obj.impact = f.impact;
  if (f.detail !== undefined) obj.detail = f.detail;
  obj.confidence = f.confidence;
  obj.basis = f.basis;
  return JSON.stringify(obj);
}

export function findingHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface RunChallengeParams {
  tenantId: string;
  layerKey: string;
  findingRef: string;
  challengeText: string;
  userId: string;
  log?: Logger;
  // Test and runtime injection seam. Default undefined: the challenge resolves
  // its stage context from the environment exactly as before (the production
  // path). When provided, it overrides that resolution, so a test can inject a
  // fake in-boundary model and re-reason a finding with no billed external call.
  stageContext?: StageContext;
}

export type RunChallengeResult =
  | { kind: "layer_not_found" }
  | { kind: "finding_not_found" }
  | { kind: "profile_missing" }
  | { kind: "done"; challenge: FindingChallengeRow };

// Compute the current hash of the finding at a ref in a layer's content, used to
// flag a stored challenge as addressing the live version or a prior one. Returns
// null when the layer or the finding no longer exists.
export function currentFindingHash(content: unknown, ref: string): string | null {
  const parsedRef = parseFindingRef(ref);
  if (!parsedRef) return null;
  const parsed = layerContentSchema.safeParse(content);
  if (!parsed.success) return null;
  const finding = extractFinding(parsed.data, parsedRef, ref);
  if (!finding) return null;
  return findingHash(canonicalFindingText(finding));
}

// Run a challenge synchronously: re-reason the finding, then record the outcome
// and (on success) one provenance entry in a single transaction. A model call
// that does not return a usable result is recorded as an honest failed row with
// no outcome and no provenance, never a fabricated uphold or revise.
export async function runFindingChallenge(params: RunChallengeParams): Promise<RunChallengeResult> {
  const log = params.log ?? silentLogger;
  const { tenantId, layerKey, findingRef, userId } = params;
  // User input is sanitised once and used for both the prompt and storage, so no
  // long dash ever reaches the database (the hard constraint applies to user
  // input too, not just generated content).
  const challengeText = stripDashes(params.challengeText);

  const parsedRef = parseFindingRef(findingRef);
  if (!parsedRef) return { kind: "finding_not_found" };

  const layerRows = await db
    .select()
    .from(tenantLayersTable)
    .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layerKey)))
    .limit(1);
  const layerRow = layerRows[0];
  if (!layerRow) return { kind: "layer_not_found" };

  const parsedContent = layerContentSchema.safeParse(layerRow.content);
  if (!parsedContent.success) return { kind: "finding_not_found" };
  const finding = extractFinding(parsedContent.data, parsedRef, findingRef);
  if (!finding) return { kind: "finding_not_found" };

  const findingHashRef = findingHash(canonicalFindingText(finding));

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
    .where(eq(layersTable.key, layerKey))
    .limit(1);
  const descriptor = descriptorRows[0];
  if (!descriptor) return { kind: "layer_not_found" };
  const layer: LayerDescriptor = {
    key: descriptor.key,
    name: descriptor.name,
    description: descriptor.description,
    diagnosticQuestion: descriptor.diagnosticQuestion,
  };

  const input: FindingChallengeInput = {
    profile: profileParsed.data,
    layer,
    finding: {
      ref: finding.ref,
      kind: finding.kind,
      title: finding.title,
      detail: finding.detail,
      impact: finding.impact,
      confidence: finding.confidence,
      basis: finding.basis,
    },
    narrative: parsedContent.data.narrative,
    confounders: layerRow.confounders ?? undefined,
    userChallenge: challengeText,
  };

  const findingTitle = stripDashes(finding.title);
  const baseRow = {
    tenantId,
    layerKey,
    findingRef,
    findingHashRef,
    findingTitle,
    challengerUserId: userId,
    challengeText,
    originalConfidence: finding.confidence,
    originalBasis: finding.basis,
  };

  const telemetry: StageTelemetry[] = [];

  // The interactive challenge reuses the same seats as a layer build, so it
  // honours the deployment-wide sovereign regime: under sovereign both calls run
  // in-boundary on the local seat, so a sovereign deployment makes no external
  // call anywhere. When CORTEX_DATA_MODE is unset this is outside_in and the two
  // calls take the external path exactly as before.
  const stageCtx: StageContext =
    params.stageContext ?? {
      dataMode: resolveCortexDataMode() === "sovereign" ? "sovereign" : "outside_in",
    };

  // The Confounder seat re-tests the objection against evidence.
  const confound = await runFindingChallengeConfound(input, log, stageCtx);
  telemetry.push(confound.telemetry);
  await recordModelUsageSafe(
    { tenantId, runId: null, stage: "challenge_confound", layerKey, telemetry: confound.telemetry },
    log,
  );
  if (!confound.ok) {
    const row = await insertFailed(baseRow, confound.reason, telemetry);
    return { kind: "done", challenge: row };
  }

  // The Synthesist seat decides uphold-or-revise.
  const decision = await runFindingChallengeDecision(input, confound.output, log, stageCtx);
  telemetry.push(decision.telemetry);
  await recordModelUsageSafe(
    { tenantId, runId: null, stage: "challenge_synthesis", layerKey, telemetry: decision.telemetry },
    log,
  );
  if (!decision.ok) {
    const row = await insertFailed(baseRow, decision.reason, telemetry);
    return { kind: "done", challenge: row };
  }

  // A "revised" verdict with no new confidence is malformed: never invent the
  // number, record an honest failure instead.
  if (decision.output.outcome === "revised" && decision.output.revised_confidence == null) {
    const row = await insertFailed(baseRow, "revise_without_confidence", telemetry);
    return { kind: "done", challenge: row };
  }

  const outcome = decision.output.outcome;
  const revised = outcome === "revised";
  const reasoning = stripDashes(decision.output.reasoning);
  const confounderNote = stripDashes(confound.output.note);
  const revisedConfidence = revised ? Math.round(decision.output.revised_confidence as number) : null;
  // A revise re-bases the finding as engine reasoning informed by the user. This
  // value lives ONLY on the challenge row, never in the cortex basis enum or the
  // layer content.
  const revisedBasis = revised ? "modelled_user_informed" : null;

  // The provenance source reference is a digest over the challenge outcome, never
  // the raw user text (which is hashed in, not embedded).
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        challengeTextHash: createHash("sha256").update(challengeText, "utf8").digest("hex"),
        challengerUserId: userId,
        findingHashRef,
        findingRef,
        layerKey,
        originalBasis: finding.basis,
        originalConfidence: finding.confidence,
        outcome,
        revisedBasis,
        revisedConfidence,
        tenantId,
      }),
      "utf8",
    )
    .digest("hex");
  const claimPath = `${layerKey}.challenge.${findingRef}`;
  const sourceRef = `challenge:sha256:${digest}`;

  const row = await db.transaction(async (tx) => {
    const entry = await appendEntryTx(tx, { tenantId, claimPath, sourceRef });
    const inserted = await tx
      .insert(findingChallengesTable)
      .values({
        ...baseRow,
        status: "completed",
        outcome,
        revisedConfidence,
        revisedBasis,
        confounderNote,
        reasoning,
        telemetry: telemetry as unknown as Record<string, unknown>[],
        provenanceContentHash: entry.contentHash,
      })
      .returning();
    return inserted[0]!;
  });

  return { kind: "done", challenge: row };
}

// A challenge serialised for the portal, with the challenger's email (or null
// when the user was removed) and an honest isCurrentVersion flag: true when the
// challenged finding still hashes to the same value, false when a refresh has
// since changed it. The flag is null when the layer or finding no longer exists.
export interface SerializedChallenge {
  id: string;
  layerKey: string;
  findingRef: string;
  findingTitle: string;
  challengerEmail: string | null;
  challengeText: string;
  status: FindingChallengeRow["status"];
  outcome: FindingChallengeRow["outcome"];
  originalConfidence: number | null;
  originalBasis: string | null;
  revisedConfidence: number | null;
  revisedBasis: string | null;
  confounderNote: string | null;
  reasoning: string | null;
  error: string | null;
  provenanceContentHash: string | null;
  isCurrentVersion: boolean | null;
  createdAt: string;
}

// List a tenant's challenges newest first, annotating each with whether it still
// addresses the live version of its finding. Layer content is loaded once per
// layer, not once per challenge, so a long history costs a bounded number of
// reads.
export async function listFindingChallenges(tenantId: string): Promise<SerializedChallenge[]> {
  const rows = await db
    .select({
      challenge: findingChallengesTable,
      challengerEmail: usersTable.email,
    })
    .from(findingChallengesTable)
    .leftJoin(usersTable, eq(findingChallengesTable.challengerUserId, usersTable.id))
    .where(eq(findingChallengesTable.tenantId, tenantId))
    .orderBy(desc(findingChallengesTable.createdAt));

  // Load each referenced layer's current content once and cache it.
  const contentByLayer = new Map<string, unknown>();
  for (const r of rows) {
    if (!contentByLayer.has(r.challenge.layerKey)) {
      const layerRows = await db
        .select({ content: tenantLayersTable.content })
        .from(tenantLayersTable)
        .where(
          and(
            eq(tenantLayersTable.tenantId, tenantId),
            eq(tenantLayersTable.layerKey, r.challenge.layerKey),
          ),
        )
        .limit(1);
      contentByLayer.set(r.challenge.layerKey, layerRows[0]?.content ?? null);
    }
  }

  return rows.map(({ challenge: c, challengerEmail }) => {
    const content = contentByLayer.get(c.layerKey) ?? null;
    const live = content == null ? null : currentFindingHash(content, c.findingRef);
    const isCurrentVersion = live == null ? null : live === c.findingHashRef;
    return serializeChallenge(c, challengerEmail ?? null, isCurrentVersion);
  });
}

// Shape one stored row for the portal. Shared by the list path and the submit
// path so a just-recorded challenge returns the SAME contract the history does,
// never a raw row that would mislabel the challenger or drop the version flag.
export function serializeChallenge(
  c: FindingChallengeRow,
  challengerEmail: string | null,
  isCurrentVersion: boolean | null,
): SerializedChallenge {
  return {
    id: c.id,
    layerKey: c.layerKey,
    findingRef: c.findingRef,
    findingTitle: c.findingTitle,
    challengerEmail: challengerEmail ?? null,
    challengeText: c.challengeText,
    status: c.status,
    outcome: c.outcome,
    originalConfidence: c.originalConfidence,
    originalBasis: c.originalBasis,
    revisedConfidence: c.revisedConfidence,
    revisedBasis: c.revisedBasis,
    confounderNote: c.confounderNote,
    reasoning: c.reasoning,
    error: c.error,
    provenanceContentHash: c.provenanceContentHash,
    isCurrentVersion,
    createdAt: c.createdAt.toISOString(),
  };
}

// Record a failed challenge: an honest row with status failed, the failure
// reason, the real (billed) telemetry, and NO provenance entry (nothing about
// the diagnosis changed).
async function insertFailed(
  baseRow: {
    tenantId: string;
    layerKey: string;
    findingRef: string;
    findingHashRef: string;
    findingTitle: string;
    challengerUserId: string;
    challengeText: string;
    originalConfidence: number;
    originalBasis: string;
  },
  reason: string,
  telemetry: StageTelemetry[],
): Promise<FindingChallengeRow> {
  const inserted = await db
    .insert(findingChallengesTable)
    .values({
      ...baseRow,
      status: "failed",
      error: stripDashes(reason),
      telemetry: telemetry as unknown as Record<string, unknown>[],
    })
    .returning();
  return inserted[0]!;
}
