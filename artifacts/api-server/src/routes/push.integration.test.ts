import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  committedActionsTable,
  db,
  layersTable,
  orgsTable,
  orgTenantsTable,
  outcomeMeasurementsTable,
  pushEventsTable,
  tenantsTable,
  usersTable,
  type PushChannel,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { runPushEvaluation } from "../lib/push/pushEvaluator";
import { drainPendingPushEvents, type PushDigest, type PushTransport } from "../lib/push/pushNotifier";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of Proactive Push Intelligence against a real Postgres,
// over HTTP through a throwaway listener, plus a direct drive of the evaluator
// and the digest drainer. Same self-cleaning harness as the portfolio and auth
// suites: every row is namespaced by a unique run id and deleted afterwards.
//
// The evaluator and drainer are global by design (the scheduled Morning Brief
// touches every user and tenant). To stay hermetic against any other suite
// running in parallel against the same database, every runPushEvaluation call
// here is confined to this suite's own seeded users and tenants via the optional
// restrict seams; the drainer only ever sees the pending events those passes
// created (no scheduled loop runs in tests).
//
// The shape under test is the acceptance contract: a material breach becomes a
// ranked, recorded, idempotent event; the per-user inbox is fenced to reachable
// tenants; a below-threshold breach is recorded suppressed (visible, never
// unread); the drained digest leads with the biggest dollars at stake; and a
// per-user mute hides a kind for one user without losing the same high signal
// for another.
const RUN = `push-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";

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
let layerKey = "";

const ids = {
  providerOrg: "",
  portfolioOrg: "",
  clientOrg: "",
  tenantA: "",
  tenantB: "",
  tenantC: "",
  tenantD: "",
  owner: "",
  portfolioAdmin: "",
  clientAdmin: "",
  actionAHigh: "",
  actionAMiss: "",
  actionBLow: "",
  actionCHigh: "",
  actionAHigh2: "",
  actionDHigh: "",
  actionDHigh2: "",
  measAMiss: "",
};

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member" | "client-admin" | "client-viewer",
  orgId: string | null,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0].id;
}

async function seedAction(opts: {
  tenantId: string;
  title: string;
  predictedValueUsd: string | null;
  confidence: number;
  status?: "committed" | "in_progress" | "done" | "dismissed";
}): Promise<string> {
  const [row] = await db
    .insert(committedActionsTable)
    .values({
      tenantId: opts.tenantId,
      layerKey,
      title: opts.title,
      predictedValueUsd: opts.predictedValueUsd,
      basis: "modelled",
      confidence: opts.confidence,
      status: opts.status ?? "committed",
      committedBy: ids.owner,
    })
    .returning({ id: committedActionsTable.id });
  return row.id;
}

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

interface NotificationItem {
  id: string;
  tenantId: string | null;
  sourceType: string;
  sourceId: string;
  impactUsd: number | null;
  confidence: number | null;
  rankScore: number;
  deliveryStatus: string;
  channel: string;
  read: boolean;
}

interface NotificationsBody {
  notifications: NotificationItem[];
  unreadCount: number;
}

interface RuleItem {
  id: string;
  tenantId: string;
  type: string;
  enabled: boolean;
  mutedUntil: string | null;
  minImpactUsd: number | null;
  channel: string;
}

async function notifications(session: string): Promise<NotificationsBody> {
  const r = await api("/api/push/notifications", { session });
  expect(r.status).toBe(200);
  return r.json as NotificationsBody;
}

async function rules(session: string): Promise<RuleItem[]> {
  const r = await api("/api/push/rules", { session });
  expect(r.status).toBe(200);
  return (r.json as { rules: RuleItem[] }).rules;
}

// Confine every evaluation pass to this suite's own users and tenants, so a
// parallel suite is never touched and this suite never reads another's rules.
function evaluate() {
  return runPushEvaluation({
    now: new Date(),
    restrictToUserIds: [ids.owner, ids.portfolioAdmin, ids.clientAdmin],
    restrictToTenantIds: [ids.tenantA, ids.tenantB, ids.tenantC],
  });
}

beforeAll(async () => {
  setSecretStore(testStore);

  const firstLayer = (
    await db.select({ key: layersTable.key }).from(layersTable).orderBy(layersTable.sortOrder).limit(1)
  )[0];
  if (!firstLayer) throw new Error("layer registry is empty; cannot run push integration test");
  layerKey = firstLayer.key;

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Provider`, type: "provider" })
    .returning({ id: orgsTable.id });
  const [portfolioOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Holdings`, type: "portfolio" })
    .returning({ id: orgsTable.id });
  const [clientOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Client`, type: "client" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg.id;
  ids.portfolioOrg = portfolioOrg.id;
  ids.clientOrg = clientOrg.id;

  const [tenantA] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant A`, url: "https://a.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  const [tenantB] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant B`, url: "https://b.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  const [tenantC] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant C`, url: "https://c.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantA = tenantA.id;
  ids.tenantB = tenantB.id;
  ids.tenantC = tenantC.id;

  // Portfolio org holds tenant A and B; client org holds tenant C.
  await db.insert(orgTenantsTable).values([
    { orgId: ids.portfolioOrg, tenantId: ids.tenantA },
    { orgId: ids.portfolioOrg, tenantId: ids.tenantB },
    { orgId: ids.clientOrg, tenantId: ids.tenantC },
  ]);

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.portfolioAdmin = await seedUser("portfolio-admin", "client-admin", ids.portfolioOrg);
  ids.clientAdmin = await seedUser("client-admin", "client-admin", ids.clientOrg);

  // Tenant A: a committed high-value action (a high_value breach, 100000 at 80),
  // and a separate done action that missed (a shortfall breach of 150000 at 90).
  ids.actionAHigh = await seedAction({
    tenantId: ids.tenantA,
    title: `${RUN} action A high`,
    predictedValueUsd: "100000.00",
    confidence: 80,
  });
  ids.actionAMiss = await seedAction({
    tenantId: ids.tenantA,
    title: `${RUN} action A miss`,
    predictedValueUsd: "200000.00",
    confidence: 90,
    status: "done",
  });
  const [measAMiss] = await db
    .insert(outcomeMeasurementsTable)
    .values({
      actionId: ids.actionAMiss,
      realizedValueUsd: "50000.00",
      basis: "modelled",
      status: "missed",
      recordedBy: ids.owner,
    })
    .returning({ id: outcomeMeasurementsTable.id });
  ids.measAMiss = measAMiss.id;

  // Tenant B: a tiny committed action (a low-impact high_value breach, 100 at 50).
  ids.actionBLow = await seedAction({
    tenantId: ids.tenantB,
    title: `${RUN} action B low`,
    predictedValueUsd: "100.00",
    confidence: 50,
  });

  // Tenant C: a committed high-value action (100000 at 70), used to prove a
  // client-org seat's threshold suppression.
  ids.actionCHigh = await seedAction({
    tenantId: ids.tenantC,
    title: `${RUN} action C high`,
    predictedValueUsd: "100000.00",
    confidence: 70,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;

  // The client-org seat raises its tenant C high_value floor above the breach
  // BEFORE the first evaluation, so its event is born suppressed.
  const clientSession = await loginSession("client-admin");
  const clientRules = await rules(clientSession);
  const cHigh = clientRules.find((r) => r.tenantId === ids.tenantC && r.type === "high_value_action");
  if (!cHigh) throw new Error("expected a default high_value rule for tenant C");
  const patch = await api(`/api/push/rules/${cHigh.id}`, {
    method: "PATCH",
    session: clientSession,
    body: { minImpactUsd: 10_000_000 },
  });
  expect(patch.status).toBe(200);

  // First evaluation pass, confined to this suite.
  const out = await evaluate();
  expect(out.created).toBeGreaterThan(0);
});

afterAll(async () => {
  try {
    await db.delete(orgTenantsTable).where(
      inArray(orgTenantsTable.orgId, [ids.portfolioOrg, ids.clientOrg]),
    );
    // Deleting the users cascades their push_rules and push_events; deleting the
    // tenants cascades their actions, measurements and any remaining push rows.
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db
      .delete(tenantsTable)
      .where(inArray(tenantsTable.id, [ids.tenantA, ids.tenantB, ids.tenantC, ids.tenantD].filter(Boolean)));
    await db.delete(orgsTable).where(
      inArray(orgsTable.id, [ids.providerOrg, ids.portfolioOrg, ids.clientOrg]),
    );
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("the notification center is fenced and requires a session", () => {
  it("refuses an unauthenticated read with 401", async () => {
    const r = await api("/api/push/notifications");
    expect(r.status).toBe(401);
  });
});

describe("a breach becomes a ranked, recorded event in the owner inbox", () => {
  it("records every reachable breach for a provider seat with computed figures", async () => {
    const session = await loginSession("owner");
    const body = await notifications(session);

    // Provider sees all three tenants: A high, A shortfall, B low, C high.
    expect(body.notifications).toHaveLength(4);
    expect(body.unreadCount).toBe(4);

    const high = body.notifications.find((n) => n.sourceId === ids.actionAHigh);
    expect(high?.impactUsd).toBe(100000);
    expect(high?.confidence).toBe(80);
    expect(high?.rankScore).toBe(80000);
    expect(high?.deliveryStatus).toBe("pending");

    const shortfall = body.notifications.find((n) => n.sourceType === "outcome_measurement");
    expect(shortfall?.sourceId).toBe(ids.measAMiss);
    expect(shortfall?.impactUsd).toBe(150000);
    expect(shortfall?.confidence).toBe(90);
    expect(shortfall?.rankScore).toBe(135000);

    const low = body.notifications.find((n) => n.sourceId === ids.actionBLow);
    expect(low?.impactUsd).toBe(100);
    expect(low?.rankScore).toBe(50);
  });
});

describe("a portfolio-org seat sees only its bound tenants", () => {
  it("fences the inbox to tenants A and B and excludes the client-org tenant", async () => {
    const session = await loginSession("portfolio-admin");
    const body = await notifications(session);
    const tenants = new Set(body.notifications.map((n) => n.tenantId));
    expect(tenants.has(ids.tenantA)).toBe(true);
    expect(tenants.has(ids.tenantB)).toBe(true);
    expect(tenants.has(ids.tenantC)).toBe(false);
    // A high, A shortfall, B low; all pending, all unread.
    expect(body.notifications).toHaveLength(3);
    expect(body.unreadCount).toBe(3);
  });
});

describe("a below-threshold breach is recorded suppressed, visible but never unread", () => {
  it("shows the client-org seat its suppressed event without inflating the badge", async () => {
    const session = await loginSession("client-admin");
    const body = await notifications(session);
    expect(body.notifications).toHaveLength(1);
    const only = body.notifications[0];
    expect(only.tenantId).toBe(ids.tenantC);
    expect(only.sourceId).toBe(ids.actionCHigh);
    expect(only.deliveryStatus).toBe("suppressed");
    // Suppressed events are visible in the center but never count as unread.
    expect(body.unreadCount).toBe(0);
  });
});

describe("re-evaluation is idempotent", () => {
  it("creates no new events for the same breaches in the same state", async () => {
    const out = await evaluate();
    expect(out.created).toBe(0);

    const session = await loginSession("owner");
    const body = await notifications(session);
    expect(body.notifications).toHaveLength(4);
  });
});

describe("the drained digest leads with the biggest dollars at stake", () => {
  it("delivers one ranked in-app digest per recipient, ordered by rank score", async () => {
    const captured: PushDigest[] = [];
    const transportFor = (channel: PushChannel): PushTransport => ({
      channel,
      async deliver(digest) {
        captured.push(digest);
      },
    });
    const result = await drainPendingPushEvents({ now: new Date(), transportFor });
    // Owner (4 pending) and portfolio admin (3 pending) each form one in_app
    // group; the client seat's only event is suppressed, so it is not drained.
    expect(result.delivered).toBe(7);
    expect(result.failed).toBe(0);

    const ownerDigest = captured.find((d) => d.recipient.userId === ids.owner);
    expect(ownerDigest).toBeTruthy();
    expect(ownerDigest?.channel).toBe("in_app");
    expect(ownerDigest?.totalEvents).toBe(4);
    const order = ownerDigest?.lines.map((l) => l.rankScore) ?? [];
    expect(order).toEqual([135000, 80000, 70000, 50]);
    expect(ownerDigest?.lines[0].sourceId).toBe(ids.measAMiss);
  });
});

describe("read state is per-user and drives the unread badge", () => {
  it("marks one event read, then read-all clears the badge", async () => {
    const session = await loginSession("owner");
    const before = await notifications(session);
    // Drained events are sent, still unread until opened.
    expect(before.unreadCount).toBe(4);

    const one = before.notifications[0];
    const read = await api(`/api/push/notifications/${one.id}/read`, { method: "POST", session });
    expect(read.status).toBe(200);
    const afterOne = await notifications(session);
    expect(afterOne.unreadCount).toBe(3);

    const all = await api("/api/push/notifications/read-all", { method: "POST", session });
    expect(all.status).toBe(200);
    const afterAllRead = await notifications(session);
    expect(afterAllRead.unreadCount).toBe(0);
  });
});

describe("a per-user mute hides a kind without losing the signal for others", () => {
  it("suppresses a newly muted user's breach while another user still gets it", async () => {
    // Portfolio admin mutes the tenant A high_value rule for 24 hours.
    const pSession = await loginSession("portfolio-admin");
    const pRules = await rules(pSession);
    const aHigh = pRules.find((r) => r.tenantId === ids.tenantA && r.type === "high_value_action");
    if (!aHigh) throw new Error("expected a default high_value rule for tenant A");
    const mute = await api(`/api/push/rules/${aHigh.id}/mute`, {
      method: "POST",
      session: pSession,
      body: { hours: 24 },
    });
    expect(mute.status).toBe(200);

    // A brand new high-value action on tenant A is a new breach (new dedupe key).
    ids.actionAHigh2 = await seedAction({
      tenantId: ids.tenantA,
      title: `${RUN} action A high two`,
      predictedValueUsd: "300000.00",
      confidence: 85,
    });
    const out = await evaluate();
    expect(out.created).toBeGreaterThan(0);

    // The muting user sees the new event recorded suppressed, not unread.
    const pBody = await notifications(pSession);
    const pNew = pBody.notifications.find((n) => n.sourceId === ids.actionAHigh2);
    expect(pNew?.deliveryStatus).toBe("suppressed");

    // The owner, who did not mute, gets the same high signal as a pending event.
    const oSession = await loginSession("owner");
    const oBody = await notifications(oSession);
    const oNew = oBody.notifications.find((n) => n.sourceId === ids.actionAHigh2);
    expect(oNew?.deliveryStatus).toBe("pending");
    expect(oNew?.impactUsd).toBe(300000);
  });
});

// Confine an evaluation pass to a specific set of users and tenants, used by the
// revocation test so it never touches another suite's state.
function evaluateScoped(userIds: string[], tenantIds: string[]) {
  return runPushEvaluation({
    now: new Date(),
    restrictToUserIds: userIds,
    restrictToTenantIds: tenantIds,
  });
}

describe("revoking a tenant binding stops new events and stops delivery of stale ones", () => {
  it("fences the evaluator and fails the drainer's stale pending rows without delivering them", async () => {
    // Set up an isolated tenant D bound to the client org, plus a material breach.
    const [tenantD] = await db
      .insert(tenantsTable)
      .values({ name: `${RUN} Tenant D`, url: "https://d.example.com", status: "ready" })
      .returning({ id: tenantsTable.id });
    ids.tenantD = tenantD.id;
    await db.insert(orgTenantsTable).values({ orgId: ids.clientOrg, tenantId: ids.tenantD });
    ids.actionDHigh = await seedAction({
      tenantId: ids.tenantD,
      title: `${RUN} action D high`,
      predictedValueUsd: "200000.00",
      confidence: 80,
    });

    // First pass while the binding is live: the client seat (and the provider
    // owner) each get a pending event for tenant D.
    const before = await evaluateScoped([ids.owner, ids.clientAdmin], [ids.tenantD]);
    expect(before.created).toBeGreaterThan(0);

    const clientBefore = await db
      .select({ id: pushEventsTable.id, deliveryStatus: pushEventsTable.deliveryStatus })
      .from(pushEventsTable)
      .where(
        and(eq(pushEventsTable.ownerUserId, ids.clientAdmin), eq(pushEventsTable.sourceId, ids.actionDHigh)),
      );
    expect(clientBefore).toHaveLength(1);
    expect(clientBefore[0].deliveryStatus).toBe("pending");

    // Revoke the client org's binding to tenant D, then fire a brand new breach.
    await db
      .delete(orgTenantsTable)
      .where(and(eq(orgTenantsTable.orgId, ids.clientOrg), eq(orgTenantsTable.tenantId, ids.tenantD)));
    ids.actionDHigh2 = await seedAction({
      tenantId: ids.tenantD,
      title: `${RUN} action D high two`,
      predictedValueUsd: "400000.00",
      confidence: 90,
    });

    // The evaluator is fenced: the provider still gets the new event, but the
    // now-unbound client seat gets nothing new for tenant D.
    const after = await evaluateScoped([ids.owner, ids.clientAdmin], [ids.tenantD]);
    expect(after.created).toBeGreaterThan(0);

    const clientNew = await db
      .select({ id: pushEventsTable.id })
      .from(pushEventsTable)
      .where(
        and(eq(pushEventsTable.ownerUserId, ids.clientAdmin), eq(pushEventsTable.sourceId, ids.actionDHigh2)),
      );
    expect(clientNew).toHaveLength(0);

    const ownerNew = await db
      .select({ id: pushEventsTable.id })
      .from(pushEventsTable)
      .where(and(eq(pushEventsTable.ownerUserId, ids.owner), eq(pushEventsTable.sourceId, ids.actionDHigh2)));
    expect(ownerNew).toHaveLength(1);

    // The drainer re-verifies access: the client's stale pending tenant-D event
    // is failed in place and never handed to a transport, while the provider's
    // tenant-D events still deliver.
    const captured: PushDigest[] = [];
    const transportFor = (channel: PushChannel): PushTransport => ({
      channel,
      async deliver(digest) {
        captured.push(digest);
      },
    });
    const drain = await drainPendingPushEvents({ now: new Date(), transportFor });
    expect(drain.failed).toBeGreaterThanOrEqual(1);

    // No digest was delivered to the revoked client seat.
    expect(captured.find((d) => d.recipient.userId === ids.clientAdmin)).toBeUndefined();

    const clientAfter = await db
      .select({ deliveryStatus: pushEventsTable.deliveryStatus })
      .from(pushEventsTable)
      .where(
        and(eq(pushEventsTable.ownerUserId, ids.clientAdmin), eq(pushEventsTable.sourceId, ids.actionDHigh)),
      );
    expect(clientAfter[0]?.deliveryStatus).toBe("failed");

    // The provider's tenant-D event delivered normally.
    const ownerAfter = await db
      .select({ deliveryStatus: pushEventsTable.deliveryStatus })
      .from(pushEventsTable)
      .where(and(eq(pushEventsTable.ownerUserId, ids.owner), eq(pushEventsTable.sourceId, ids.actionDHigh)));
    expect(ownerAfter[0]?.deliveryStatus).toBe("sent");
  });
});
