import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  decisionRecordsTable,
  orgsTable,
  orgTenantsTable,
  preMortemIndicatorsTable,
  preMortemsTable,
  provenanceLedgerTable,
  tenantLayersTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import {
  canonicalRecommendation,
  recommendationHash,
} from "../lib/decisions/decisionRecord";
import { appendEntry } from "../lib/provenance/ledger";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Phase AL decision ledger surface against a real
// Postgres, driven over HTTP through a throwaway listener, mirroring the tenants
// integration harness. All rows are namespaced by a unique run id and deleted
// afterwards so the suite is self-cleaning and safe to run repeatedly. The
// pre-mortem COMPLETED path is a real Confounder cortex call (no stub), so it is
// not exercised here; the deterministic guard paths (auth, role, not-found) are.
const RUN = `dtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
// A real registry layer key, so the tenant_layers FK to layers.key holds; the
// tenant itself is RUN-namespaced, so this never collides with other rows.
const LAYER_KEY = "business-performance";

const testStore: SecretStore = {
  async get(ref) {
    return ref === "SESSION_SECRET" ? SECRET : null;
  },
  async set() {},
  async delete() {},
};

function email(local: string): string {
  return `${EMAIL_PREFIX}${local}@example.com`;
}

let server: Server;
let base: string;
// The live contentHash of the latest provenance entry per graded claim under the
// layer, captured at seed time so a commit's snapshotted evidence refs can be
// asserted exactly. References only; never raw evidence.
let evidenceActionHash = "";
let evidenceCauseHash = "";

const ids = {
  providerOrg: "",
  clientOrg: "",
  tenant: "",
  owner: "",
  member: "",
  clientViewer: "",
  fixtureDecision: "",
  fixturePreMortem: "",
  fixtureIndicator: "",
};

const ACTION_TITLE = "Tighten dunning on failed renewals";
const ACTION_DETAIL = "Retry on day 1, 3 and 7 with escalating messaging.";
const ACTION_IMPACT = "Recovers about 18000 dollars per quarter";

const layerContent = {
  narrative:
    "Renewal recovery is leaking because dunning stops after a single retry, so recoverable revenue is lost each cycle and the board has not seen the size of it.",
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
      title: ACTION_TITLE,
      detail: ACTION_DETAIL,
      impact: ACTION_IMPACT,
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

interface ApiResult {
  status: number;
  json: unknown;
  session: string | null;
}

function readSession(res: Response, fallback: string | null): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = /^ei_session=([^;]*)/.exec(c);
    if (m) return m[1] === "" ? null : m[1];
  }
  return fallback;
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session) headers["cookie"] = `ei_session=${opts.session}`;
  const res = await fetch(base + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, session: readSession(res, opts.session ?? null) };
}

async function loginSession(local: string): Promise<string> {
  const r = await api("/api/auth/login", {
    method: "POST",
    body: { email: email(local), password: PASSWORD },
  });
  expect(r.status).toBe(200);
  expect(r.session).toBeTruthy();
  return r.session as string;
}

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member" | "client-viewer",
  orgId: string | null,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0].id;
}

beforeAll(async () => {
  setSecretStore(testStore);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Provider`, type: "provider" })
    .returning({ id: orgsTable.id });
  const [clientOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Client`, type: "client" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg.id;
  ids.clientOrg = clientOrg.id;

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant`, url: "https://d.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant.id;

  await db.insert(orgTenantsTable).values({ orgId: ids.clientOrg, tenantId: ids.tenant });

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.member = await seedUser("member", "provider-member", ids.providerOrg);
  ids.clientViewer = await seedUser("client-viewer", "client-viewer", ids.clientOrg);

  // A real layer build for this tenant, so a defer or reject can snapshot the
  // exact recommended action.
  await db
    .insert(tenantLayersTable)
    .values({
      tenantId: ids.tenant,
      layerKey: LAYER_KEY,
      content: layerContent,
      generatorModel: "test-fixture",
    });

  // A directly-seeded reject decision plus a completed pre-mortem and one
  // indicator, so the timeline read and the indicator-status route have stable
  // fixtures independent of test ordering.
  const canonical = canonicalRecommendation("actions[0]", {
    title: ACTION_TITLE,
    detail: ACTION_DETAIL,
    impact: ACTION_IMPACT,
    predictedValueUsd: 18000,
    confidence: 72,
    basis: "modelled",
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
      recommendationHash: recommendationHash(canonical),
      rationale: "Board prefers to revisit after the pricing change lands.",
      contradictsRecommendation: true,
      provenanceContentHash: "f".repeat(64),
    })
    .returning({ id: decisionRecordsTable.id });
  ids.fixtureDecision = decision.id;

  const [preMortem] = await db
    .insert(preMortemsTable)
    .values({
      tenantId: ids.tenant,
      decisionRecordId: ids.fixtureDecision,
      layerKey: LAYER_KEY,
      status: "completed",
      failureModes: [
        {
          rank: 1,
          title: "Adoption stalls",
          mechanism: "Customers ignore the new retry cadence.",
          likelihood: "medium",
          earlyWarning: "Weekly active accounts flat for two weeks.",
        },
      ],
      residualRiskNote: "Residual risk concentrated in the largest cohort.",
      requestedBy: ids.owner,
      provenanceContentHash: "e".repeat(64),
    })
    .returning({ id: preMortemsTable.id });
  ids.fixturePreMortem = preMortem.id;

  const [indicator] = await db
    .insert(preMortemIndicatorsTable)
    .values({
      tenantId: ids.tenant,
      preMortemId: ids.fixturePreMortem,
      decisionRecordId: ids.fixtureDecision,
      layerKey: LAYER_KEY,
      failureModeRank: 1,
      failureModeTitle: "Adoption stalls",
      label: "Weekly active accounts flat for two weeks",
      status: "active",
    })
    .returning({ id: preMortemIndicatorsTable.id });
  ids.fixtureIndicator = indicator.id;

  // Seed the layer's graded-claim provenance through the REAL append, so the
  // tenant's hash chain stays valid: two entries for the same action claim (the
  // newer is the live one a snapshot must pick), one cause claim, and one
  // decision meta entry the evidence snapshot must EXCLUDE. A commit under test
  // snapshots these refs as the evidence its recommendation rested on.
  await appendEntry({
    tenantId: ids.tenant,
    claimPath: `${LAYER_KEY}.actions[0]`,
    sourceRef: "source:test-feed:v1",
  });
  const actionLatest = await appendEntry({
    tenantId: ids.tenant,
    claimPath: `${LAYER_KEY}.actions[0]`,
    sourceRef: "source:test-feed:v2",
  });
  evidenceActionHash = actionLatest.contentHash;
  const causeEntry = await appendEntry({
    tenantId: ids.tenant,
    claimPath: `${LAYER_KEY}.causes[0]`,
    sourceRef: "source:test-feed:cause",
  });
  evidenceCauseHash = causeEntry.contentHash;
  await appendEntry({
    tenantId: ids.tenant,
    claimPath: `${LAYER_KEY}.decision.actions[0]`,
    sourceRef: "source:meta-should-be-excluded",
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    await db
      .delete(preMortemIndicatorsTable)
      .where(inArray(preMortemIndicatorsTable.tenantId, [ids.tenant]));
    await db.delete(preMortemsTable).where(inArray(preMortemsTable.tenantId, [ids.tenant]));
    await db.delete(decisionRecordsTable).where(inArray(decisionRecordsTable.tenantId, [ids.tenant]));
    await db.delete(provenanceLedgerTable).where(inArray(provenanceLedgerTable.tenantId, [ids.tenant]));
    await db.delete(tenantLayersTable).where(inArray(tenantLayersTable.tenantId, [ids.tenant]));
    await db.delete(orgTenantsTable).where(inArray(orgTenantsTable.orgId, [ids.clientOrg, ids.providerOrg]));
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenant]));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("POST /api/tenants/:id/decisions (defer or reject)", () => {
  it("requires authentication", async () => {
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      body: { layerKey: LAYER_KEY, actionRef: "actions[0]", decision: "defer", rationale: "x" },
    });
    expect(r.status).toBe(401);
  });

  it("forbids a client-viewer from recording a decision", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: {
        layerKey: LAYER_KEY,
        actionRef: "actions[0]",
        decision: "defer",
        rationale: "no",
      },
    });
    expect(r.status).toBe(403);
  });

  it("rejects invalid input", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: { layerKey: LAYER_KEY, actionRef: "actions[0]", decision: "maybe", rationale: "x" },
    });
    expect(r.status).toBe(400);
  });

  it("404s an unknown layer", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: {
        layerKey: `${RUN}-missing`,
        actionRef: "actions[0]",
        decision: "defer",
        rationale: "x",
      },
    });
    expect(r.status).toBe(404);
    expect((r.json as { error?: string }).error).toBe("layer_not_found");
  });

  it("422s a ref that is not an action", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: { layerKey: LAYER_KEY, actionRef: "causes[0]", decision: "defer", rationale: "x" },
    });
    expect(r.status).toBe(422);
    expect((r.json as { error?: string }).error).toBe("not_an_action");
  });

  it("404s an action index that does not exist", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: { layerKey: LAYER_KEY, actionRef: "actions[5]", decision: "defer", rationale: "x" },
    });
    expect(r.status).toBe(404);
    expect((r.json as { error?: string }).error).toBe("action_not_found");
  });

  it("records a defer, snapshotting the exact recommendation and marking it overruled", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/decisions`, {
      method: "POST",
      session,
      body: {
        layerKey: LAYER_KEY,
        actionRef: "actions[0]",
        decision: "defer",
        rationale: "Revisit after the pricing change lands.",
      },
    });
    expect(r.status).toBe(201);
    const record = (r.json as { decisionRecord?: Record<string, unknown> }).decisionRecord;
    expect(record).toBeTruthy();
    expect(record?.decision).toBe("defer");
    expect(record?.recommendedTitle).toBe(ACTION_TITLE);
    expect(record?.contradictsRecommendation).toBe(true);
    expect(record?.systemConfidence).toBe(72);
    expect(record?.systemBasis).toBe("modelled");
    expect(String(record?.recommendationHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(record?.provenanceContentHash)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("GET /api/tenants/:id/decisions/timeline", () => {
  it("lets any tenant seat read the audit timeline with pre-mortems and the overruled verdict", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenant}/decisions/timeline`, { session });
    expect(r.status).toBe(200);
    const body = r.json as {
      entries: {
        id: string;
        decision: string;
        overruledStatus: string | null;
        preMortems: { status: string; indicators: { label: string }[] }[];
      }[];
      summary: { totalDecisions: number; rejects: number };
    };
    const fixture = body.entries.find((e) => e.id === ids.fixtureDecision);
    expect(fixture).toBeTruthy();
    expect(fixture?.decision).toBe("reject");
    // Overruled and not yet adjudicated: the bound forecast is unresolved.
    expect(fixture?.overruledStatus).toBe("pending");
    expect(fixture?.preMortems.length).toBeGreaterThanOrEqual(1);
    expect(fixture?.preMortems[0].status).toBe("completed");
    expect(fixture?.preMortems[0].indicators.length).toBeGreaterThanOrEqual(1);
    expect(body.summary.totalDecisions).toBeGreaterThanOrEqual(1);
    expect(body.summary.rejects).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/tenants/:id/decisions/:decisionId/pre-mortem", () => {
  it("forbids a client-viewer from spending a Confounder call", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(
      `/api/tenants/${ids.tenant}/decisions/${ids.fixtureDecision}/pre-mortem`,
      { method: "POST", session },
    );
    expect(r.status).toBe(403);
  });

  it("404s a pre-mortem on an unknown decision", async () => {
    const session = await loginSession("member");
    const r = await api(
      `/api/tenants/${ids.tenant}/decisions/00000000-0000-0000-0000-000000000000/pre-mortem`,
      { method: "POST", session },
    );
    expect(r.status).toBe(404);
    expect((r.json as { error?: string }).error).toBe("decision_not_found");
  });
});

describe("POST /api/tenants/:id/pre-mortem-indicators/:indicatorId/status", () => {
  it("forbids a client-viewer from marking an indicator", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/${ids.fixtureIndicator}/status`,
      { method: "POST", session, body: { status: "triggered" } },
    );
    expect(r.status).toBe(403);
  });

  it("rejects an invalid status", async () => {
    const session = await loginSession("member");
    const r = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/${ids.fixtureIndicator}/status`,
      { method: "POST", session, body: { status: "exploded" } },
    );
    expect(r.status).toBe(400);
  });

  it("404s an unknown indicator", async () => {
    const session = await loginSession("member");
    const r = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/00000000-0000-0000-0000-000000000000/status`,
      { method: "POST", session, body: { status: "triggered" } },
    );
    expect(r.status).toBe(404);
  });

  it("records the observed transitions honestly: triggered, then cleared, then back to active", async () => {
    const session = await loginSession("member");

    const triggered = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/${ids.fixtureIndicator}/status`,
      { method: "POST", session, body: { status: "triggered" } },
    );
    expect(triggered.status).toBe(200);
    let indicator = (triggered.json as { indicator: Record<string, unknown> }).indicator;
    expect(indicator.status).toBe("triggered");
    expect(indicator.triggeredAt).toBeTruthy();
    expect(indicator.clearedAt).toBeNull();

    const cleared = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/${ids.fixtureIndicator}/status`,
      { method: "POST", session, body: { status: "cleared" } },
    );
    expect(cleared.status).toBe(200);
    indicator = (cleared.json as { indicator: Record<string, unknown> }).indicator;
    expect(indicator.status).toBe("cleared");
    expect(indicator.clearedAt).toBeTruthy();

    const active = await api(
      `/api/tenants/${ids.tenant}/pre-mortem-indicators/${ids.fixtureIndicator}/status`,
      { method: "POST", session, body: { status: "active" } },
    );
    expect(active.status).toBe(200);
    indicator = (active.json as { indicator: Record<string, unknown> }).indicator;
    expect(indicator.status).toBe("active");
    expect(indicator.triggeredAt).toBeNull();
    expect(indicator.clearedAt).toBeNull();
  });
});

describe("POST /api/tenants/:id/actions records a server-snapshotted commit decision", () => {
  const EXPECTED_EVIDENCE = () => [
    { claimPath: `${LAYER_KEY}.actions[0]`, contentHash: evidenceActionHash },
    { claimPath: `${LAYER_KEY}.causes[0]`, contentHash: evidenceCauseHash },
  ];

  it("snapshots the live recommendation and its evidence, not the client's description", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/actions`, {
      method: "POST",
      session,
      body: {
        layerKey: LAYER_KEY,
        // A deliberately WRONG client description: the decision audit must bind to
        // the system's real recommendation, never these client-supplied values.
        title: "Client typed a different action title",
        detail: "Client detail that must not become the audit snapshot",
        predictedImpact: "Recovers about 999999 dollars",
        basis: "verified",
        confidence: 5,
        actionRef: "actions[0]",
        rationale: "Board agreed to proceed this quarter.",
      },
    });
    expect(r.status).toBe(201);
    const body = r.json as { decisionRecordId?: string; action?: { title?: string } };
    expect(body.decisionRecordId).toBeTruthy();
    // The committed action itself keeps exactly what the user committed.
    expect(body.action?.title).toBe("Client typed a different action title");

    const [record] = await db
      .select()
      .from(decisionRecordsTable)
      .where(eq(decisionRecordsTable.id, body.decisionRecordId as string));
    expect(record).toBeTruthy();
    expect(record.decision).toBe("commit");
    // Server-side snapshot of the live recommendation, NOT the client's values.
    expect(record.recommendedTitle).toBe(ACTION_TITLE);
    expect(record.systemConfidence).toBe(72);
    expect(record.systemBasis).toBe("modelled");
    expect(record.recommendationVerified).toBe(true);
    // Evidence: the layer's graded claims, latest per claimPath, meta excluded,
    // sorted by claimPath. References only.
    expect(record.evidenceRefs).toEqual(EXPECTED_EVIDENCE());
  });

  it("404s a bad action index, 422s a non-action ref, and 404s a missing layer before any write", async () => {
    const session = await loginSession("member");
    const commitBody = (overrides: Record<string, unknown>) => ({
      layerKey: LAYER_KEY,
      title: "guarded",
      basis: "modelled",
      confidence: 50,
      ...overrides,
    });

    const badIndex = await api(`/api/tenants/${ids.tenant}/actions`, {
      method: "POST",
      session,
      body: commitBody({ actionRef: "actions[5]" }),
    });
    expect(badIndex.status).toBe(404);
    expect((badIndex.json as { error?: string }).error).toBe("action_not_found");

    const notAction = await api(`/api/tenants/${ids.tenant}/actions`, {
      method: "POST",
      session,
      body: commitBody({ actionRef: "causes[0]" }),
    });
    expect(notAction.status).toBe(422);
    expect((notAction.json as { error?: string }).error).toBe("not_an_action");

    const missingLayer = await api(`/api/tenants/${ids.tenant}/actions`, {
      method: "POST",
      session,
      body: commitBody({ layerKey: `${RUN}-missing`, actionRef: "actions[0]" }),
    });
    expect(missingLayer.status).toBe(404);
    expect((missingLayer.json as { error?: string }).error).toBe("layer_not_found");
  });

  it("keeps the client snapshot, honestly unverified, when no actionRef is named", async () => {
    const session = await loginSession("member");
    const r = await api(`/api/tenants/${ids.tenant}/actions`, {
      method: "POST",
      session,
      body: {
        layerKey: LAYER_KEY,
        title: "A freeform action with no layer ref",
        predictedImpact: "Recovers about 4200 dollars",
        basis: "verified",
        confidence: 41,
        rationale: "Outside-in commit with no graded action to bind to.",
      },
    });
    expect(r.status).toBe(201);
    const body = r.json as { decisionRecordId?: string };
    const [record] = await db
      .select()
      .from(decisionRecordsTable)
      .where(eq(decisionRecordsTable.id, body.decisionRecordId as string));
    expect(record.decision).toBe("commit");
    expect(record.recommendationVerified).toBe(false);
    // No actionRef means the snapshot honestly reflects the client's own values.
    expect(record.recommendedTitle).toBe("A freeform action with no layer ref");
    expect(record.systemConfidence).toBe(41);
    // Evidence is still snapshotted by layer, even for a freeform commit.
    expect(record.evidenceRefs).toEqual(EXPECTED_EVIDENCE());
  });
});
