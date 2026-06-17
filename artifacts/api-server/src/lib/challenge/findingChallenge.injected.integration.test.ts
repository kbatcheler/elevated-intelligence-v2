import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  findingChallengesTable,
  orgsTable,
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
import { runFindingChallenge } from "./findingChallenge";

// Proof that the interactive-challenge WRITE path (Phase AA/AC) runs end to end
// with ZERO billed external calls. A fake in-boundary model is injected through
// the StageContext seam: the Confounder and Synthesist seats return fixed values
// in call order, and the orchestration persists a completed challenge plus ONE
// hash-chained provenance entry in a single transaction. The deployment default
// (resolve the stage context from the environment) is untouched; this only
// exercises the injection override. All rows are run-namespaced and removed.
const RUN = `ctest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const PASSWORD = "correct-horse-battery-staple";
const LAYER_KEY = "business-performance";

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
    {
      title: "Tighten dunning on failed renewals",
      detail: "Retry on day 1, 3 and 7 with escalating messaging.",
      impact: "Recovers about 18000 dollars per quarter",
      confidence: 72,
      basis: "modelled",
    },
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

const ids = { org: "", tenant: "", owner: "" };

// A queue runtime: it stands in for the in-boundary local seat, recording every
// request and returning the next fixed value in order. The challenge makes two
// calls (Confounder then Synthesist), so two values are supplied; any further
// call would reuse the last, but the assertion pins the count to exactly two.
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
    .values({ name: `${RUN} Tenant`, url: "https://c.example.com", status: "ready" })
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
});

afterAll(async () => {
  await db.delete(findingChallengesTable).where(eq(findingChallengesTable.tenantId, ids.tenant));
  await db.delete(provenanceLedgerTable).where(eq(provenanceLedgerTable.tenantId, ids.tenant));
  await db.delete(tenantProfileTable).where(eq(tenantProfileTable.tenantId, ids.tenant));
  await db.delete(tenantLayersTable).where(eq(tenantLayersTable.tenantId, ids.tenant));
  await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  await db.delete(orgsTable).where(eq(orgsTable.id, ids.org));
});

describe("runFindingChallenge with an injected in-boundary model", () => {
  it("persists a completed upheld challenge and one provenance entry, no external call", async () => {
    const before = await verifyChain(ids.tenant);
    expect(before.ok).toBe(true);
    const beforeLen = before.length;

    const runtime = queueRuntime([
      {
        introduces_confounder: false,
        note: "Re-tested the objection against the evidence; no new confounder is introduced.",
      },
      {
        outcome: "upheld",
        reasoning: "The finding holds under the user objection; the evidence still supports it.",
      },
    ]);
    const ctx: StageContext = { dataMode: "sovereign", extractionRuntime: runtime };

    const result = await runFindingChallenge({
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      findingRef: "causes[0]",
      challengeText: "I think this cause is overstated.",
      userId: ids.owner,
      stageContext: ctx,
    });

    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.challenge.status).toBe("completed");
    expect(result.challenge.outcome).toBe("upheld");
    expect(result.challenge.revisedConfidence).toBeNull();
    expect(result.challenge.provenanceContentHash).toMatch(/^[0-9a-f]{64}$/);
    // Both seats ran on the injected runtime: exactly two in-boundary calls.
    expect(runtime.calls).toHaveLength(2);

    const after = await verifyChain(ids.tenant);
    expect(after.ok).toBe(true);
    expect(after.length).toBe(beforeLen + 1);
  });

  it("records a revise with the new confidence on the challenge row only", async () => {
    const before = await verifyChain(ids.tenant);
    const beforeLen = before.length;

    const runtime = queueRuntime([
      {
        introduces_confounder: true,
        note: "The objection surfaces a plausible alternative driver worth weighting.",
      },
      {
        outcome: "revised",
        reasoning: "Given the alternative driver, the confidence is lowered.",
        revised_confidence: 45,
      },
    ]);
    const ctx: StageContext = { dataMode: "sovereign", extractionRuntime: runtime };

    const result = await runFindingChallenge({
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      findingRef: "actions[0]",
      challengeText: "This action is riskier than rated.",
      userId: ids.owner,
      stageContext: ctx,
    });

    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.challenge.status).toBe("completed");
    expect(result.challenge.outcome).toBe("revised");
    expect(result.challenge.revisedConfidence).toBe(45);
    // A revise re-bases the challenge row only, never the cortex basis enum.
    expect(result.challenge.revisedBasis).toBe("modelled_user_informed");
    expect(runtime.calls).toHaveLength(2);

    const after = await verifyChain(ids.tenant);
    expect(after.ok).toBe(true);
    expect(after.length).toBe(beforeLen + 1);
  });
});
