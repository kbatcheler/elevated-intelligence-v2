import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  decisionRecordsTable,
  orgsTable,
  preMortemIndicatorsTable,
  preMortemsTable,
  provenanceLedgerTable,
  tenantLayersTable,
  tenantProfileTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionZoneRuntime,
  StageContext,
} from "@workspace/cortex";
import { hashPassword } from "../auth/password";
import { verifyChain } from "../provenance/ledger";
import { runDecisionPreMortem } from "./preMortem";

// Proof that the on-demand pre-mortem WRITE path (Phase AL) runs end to end with
// ZERO billed external calls. A fake in-boundary model is injected through the
// StageContext seam: the Confounder seat returns fixed structured failure modes,
// and the orchestration persists a completed pre-mortem, one watched indicator
// per failure mode, and ONE hash-chained provenance entry in a single
// transaction. The deployment default (resolve from the environment) is
// untouched; this only exercises the injection override. Rows are run-namespaced.
const RUN = `pmtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const PASSWORD = "correct-horse-battery-staple";
const LAYER_KEY = "business-performance";

const ACTION_TITLE = "Tighten dunning on failed renewals";
const ACTION_DETAIL = "Retry on day 1, 3 and 7 with escalating messaging.";
const ACTION_IMPACT = "Recovers about 18000 dollars per quarter";

const layerContent = {
  narrative:
    "Renewal recovery is leaking because dunning stops after a single retry, so recoverable revenue is lost each cycle.",
  headline_finding: "Dunning stops too early",
  headline_impact: "Lost renewals",
  headline_lever: "Add staged retries",
  causes: [
    {
      title: "Single retry only",
      impact: "Lost recoveries",
      detail: "The system makes one attempt then gives up.",
      confidence: 60,
      basis: "modelled",
    },
  ],
  actions: [
    { title: ACTION_TITLE, detail: ACTION_DETAIL, impact: ACTION_IMPACT, confidence: 72, basis: "modelled" },
  ],
  hypotheses: [],
  proof: { items: [] },
  gaps: [],
  metrics: [
    { label: "Recovery rate", value: "41%", tone: "warn", confidence: 55, basis: "modelled" },
  ],
  confidence: 64,
  confidence_gap: 20,
};

const ids = { org: "", tenant: "", owner: "", decision: "" };

// A queue runtime standing in for the in-boundary local seat. A pre-mortem makes
// exactly ONE Confounder call, so one value is supplied and the assertion pins
// the call count to one.
function queueRuntime(
  values: unknown[],
): ExtractionZoneRuntime & { calls: ExtractionRequest<unknown>[] } {
  const calls: ExtractionRequest<unknown>[] = [];
  let i = 0;
  return {
    model: "local-test-model",
    endpoint: "http://boundary.test/v1/chat/completions",
    calls,
    callJson<R>(req: ExtractionRequest<R>): Promise<ExtractionResult<R>> {
      calls.push(req as ExtractionRequest<unknown>);
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      return Promise.resolve({
        ok: true,
        value: value as R,
        durationMs: 2,
        model: "local-test-model",
        inputTokens: 4,
        outputTokens: 6,
      });
    },
  };
}

beforeAll(async () => {
  const [org] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Provider`, type: "provider" })
    .returning({ id: orgsTable.id });
  ids.org = org.id;

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant`, url: "https://pm.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant.id;

  const passwordHash = await hashPassword(PASSWORD);
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: `${EMAIL_PREFIX}owner@example.com`,
      displayName: "owner",
      passwordHash,
      role: "provider-owner",
      status: "active",
      orgId: ids.org,
    })
    .returning({ id: usersTable.id });
  ids.owner = owner.id;

  await db
    .insert(tenantProfileTable)
    .values({ tenantId: ids.tenant, profile: { name: "Acme Industrial", logoMonogram: "AC" } });

  await db.insert(tenantLayersTable).values({
    tenantId: ids.tenant,
    layerKey: LAYER_KEY,
    content: layerContent,
    generatorModel: "test-fixture",
  });

  const [decision] = await db
    .insert(decisionRecordsTable)
    .values({
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      actionRef: "actions[0]",
      decision: "reject",
      decidedBy: ids.owner,
      recommendedTitle: ACTION_TITLE,
      recommendedDetail: ACTION_DETAIL,
      recommendedImpact: ACTION_IMPACT,
      recommendedValueUsd: "18000.00",
      systemConfidence: 72,
      systemBasis: "modelled",
      recommendationHash: "a".repeat(64),
      rationale: "Board prefers to revisit after the pricing change lands.",
      contradictsRecommendation: true,
      provenanceContentHash: "f".repeat(64),
    })
    .returning({ id: decisionRecordsTable.id });
  ids.decision = decision.id;
});

afterAll(async () => {
  await db.delete(preMortemIndicatorsTable).where(eq(preMortemIndicatorsTable.tenantId, ids.tenant));
  await db.delete(preMortemsTable).where(eq(preMortemsTable.tenantId, ids.tenant));
  await db.delete(decisionRecordsTable).where(eq(decisionRecordsTable.tenantId, ids.tenant));
  await db.delete(provenanceLedgerTable).where(eq(provenanceLedgerTable.tenantId, ids.tenant));
  await db.delete(tenantProfileTable).where(eq(tenantProfileTable.tenantId, ids.tenant));
  await db.delete(tenantLayersTable).where(eq(tenantLayersTable.tenantId, ids.tenant));
  await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  await db.delete(orgsTable).where(eq(orgsTable.id, ids.org));
});

describe("runDecisionPreMortem with an injected in-boundary model", () => {
  it("persists a completed pre-mortem, one indicator per failure mode, and one provenance entry", async () => {
    const before = await verifyChain(ids.tenant);
    expect(before.ok).toBe(true);
    const beforeLen = before.length;

    const runtime = queueRuntime([
      {
        failure_modes: [
          {
            rank: 1,
            title: "Adoption stalls",
            mechanism: "Teams ignore the new cadence and revert to the old single retry.",
            likelihood: "medium",
            early_warning: "Weekly active accounts stay flat for two weeks.",
          },
          {
            rank: 2,
            title: "Revenue leakage persists",
            mechanism: "Edge-case renewals keep failing silently despite the new retries.",
            likelihood: "low",
            early_warning: "Failed-renewal count does not fall after two billing cycles.",
          },
        ],
        residual_risk_note: "Residual risk concentrated in the largest cohort.",
      },
    ]);
    const ctx: StageContext = { dataMode: "sovereign", extractionRuntime: runtime };

    const result = await runDecisionPreMortem({
      tenantId: ids.tenant,
      decisionRecordId: ids.decision,
      userId: ids.owner,
      stageContext: ctx,
    });

    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.preMortem.status).toBe("completed");
    expect((result.preMortem.failureModes as unknown[]).length).toBe(2);
    expect(result.preMortem.provenanceContentHash).toMatch(/^[0-9a-f]{64}$/);
    // Exactly one Confounder call ran on the injected runtime.
    expect(runtime.calls).toHaveLength(1);

    // One watched indicator was persisted per failure mode.
    const indicators = await db
      .select()
      .from(preMortemIndicatorsTable)
      .where(eq(preMortemIndicatorsTable.preMortemId, result.preMortem.id));
    expect(indicators).toHaveLength(2);

    const after = await verifyChain(ids.tenant);
    expect(after.ok).toBe(true);
    expect(after.length).toBe(beforeLen + 1);
  });
});
