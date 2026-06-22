import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  forecastsTable,
  orgsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { commitRecommendedAction } from "../lib/outcomes/commitAction";
import { recordOutcomeMeasurement } from "../lib/outcomes/recordMeasurement";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Phase AQ outcome-loop closure over a real Postgres,
// through the EXACT services the commit and measurement routes and the live seed
// use: a recommendation committed and bound to its action_outcome forecast, the
// forecast auto-resolved by a final measurement and Brier-scored, and the
// /outcome-loop read model assembling the closed chain. It proves the honesty
// boundaries the loop turns on: an open loop carries a null measurement and the
// headline Brier is null until one resolves, never a fabricated zero. Rows are
// namespaced and removed afterwards so the suite is self-cleaning.
const RUN = "looptest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const EMAIL_PREFIX = RUN + "-";
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
  return EMAIL_PREFIX + local + "@example.com";
}

let server: Server;
let base: string;
const ids = { providerOrg: "", owner: "", tenantClosed: "", tenantOpen: "", tenantEmpty: "" };

async function seedUser(local: string, role: "provider-owner" | "provider-member"): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({
      email: email(local),
      displayName: local,
      passwordHash,
      role,
      status: "active",
      orgId: ids.providerOrg,
    })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
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
  if (opts.session) headers["cookie"] = "ei_session=" + opts.session;
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
  return r.session as string;
}

// Insert an unbound action_outcome forecast the way the Evaluator emits it: a
// probability anchored to an action path, not yet linked to any committed action.
async function seedForecast(tenantId: string, layerKey: string, probability: number): Promise<string> {
  const [row] = await db
    .insert(forecastsTable)
    .values({
      tenantId,
      layerKey,
      sourceStage: "score",
      subjectSeat: "Evaluator",
      sourcePath: "actions[0]",
      statement: "The committed action realises its predicted recovery",
      probability: String(probability),
      kind: "action_outcome",
      resolveBy: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: forecastsTable.id });
  return row!.id;
}

beforeAll(async () => {
  setSecretStore(testStore);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;
  ids.owner = await seedUser("owner", "provider-owner");

  const [tClosed] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Closed", url: "https://closed." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantClosed = tClosed!.id;
  const [tOpen] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Open", url: "https://open." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantOpen = tOpen!.id;
  const [tEmpty] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Empty", url: "https://empty." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantEmpty = tEmpty!.id;

  // A fully closed loop: commit a recommendation bound to its forecast, then a
  // final realised measurement (modelled basis, no scalar signal) which resolves
  // and Brier-scores the forecast. This is the SAME path the live seed walks.
  const fClosed = await seedForecast(ids.tenantClosed, "loop-closed", 0.7);
  const committed = await commitRecommendedAction({
    tenantId: ids.tenantClosed,
    committedBy: ids.owner,
    layerKey: "loop-closed",
    title: "Recover lost margin",
    detail: "Renegotiate the two largest supplier contracts.",
    predictedImpact: "Unlock $120,000 in annual margin",
    basis: "modelled",
    confidence: 70,
    forecastId: fClosed,
    rationale: "Seeded demo commit to close one outcome loop end to end.",
  });
  if (!committed.ok) throw new Error("seed commit failed: " + committed.reason);
  const measured = await recordOutcomeMeasurement({
    tenantId: ids.tenantClosed,
    actionId: committed.action.id,
    recordedBy: ids.owner,
    realizedValueUsd: 120000,
    final: true,
    note: "Seeded modelled demo outcome",
  });
  if (!measured.ok) throw new Error("seed measurement failed: " + measured.reason);

  // An open loop: a committed recommendation bound to a forecast, but no
  // measurement yet, so the loop is honestly open.
  const fOpen = await seedForecast(ids.tenantOpen, "loop-open", 0.6);
  const openCommit = await commitRecommendedAction({
    tenantId: ids.tenantOpen,
    committedBy: ids.owner,
    layerKey: "loop-open",
    title: "Reduce onboarding drop-off",
    detail: "Ship the streamlined first-run flow.",
    predictedImpact: "Unlock $50,000 in retained revenue",
    basis: "modelled",
    confidence: 60,
    forecastId: fOpen,
    rationale: "Seeded demo commit left deliberately open.",
  });
  if (!openCommit.ok) throw new Error("seed open commit failed: " + openCommit.reason);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    await db
      .delete(tenantsTable)
      .where(inArray(tenantsTable.id, [ids.tenantClosed, ids.tenantOpen, ids.tenantEmpty]));
    await db.delete(usersTable).where(eq(usersTable.id, ids.owner));
    await db.delete(orgsTable).where(eq(orgsTable.id, ids.providerOrg));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

interface LoopBody {
  tenantId: string;
  summary: { total: number; closed: number; open: number; brierMean: number | null };
  loops: {
    decisionId: string;
    state: "open" | "resolved";
    recommendation: {
      title: string;
      predictedValueUsd: number | null;
      basis: string;
      verified: boolean;
    };
    action: { id: string; status: string } | null;
    forecast: {
      probability: number | null;
      outcome: 0 | 1 | null;
      resolved: boolean;
      brierScore: number | null;
      resolutionBasis: string | null;
    } | null;
    measurement: {
      status: string;
      basis: string;
      realizedValueUsd: number | null;
      varianceVsPrediction: number | null;
    } | null;
  }[];
}

describe("outcome-loop read model over HTTP", () => {
  it("assembles a fully closed loop with a Brier-scored, modelled resolution", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.tenantClosed + "/outcome-loop", { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as LoopBody;

    expect(body.tenantId).toBe(ids.tenantClosed);
    expect(body.summary).toEqual({ total: 1, closed: 1, open: 0, brierMean: 0.09 }); // (0.7 - 1)^2

    expect(body.loops).toHaveLength(1);
    const loop = body.loops[0]!;
    expect(loop.state).toBe("resolved");
    // The recommendation snapshot: the parsed dollar prediction, modelled basis,
    // and honestly unverified because this commit named no server-read actionRef.
    expect(loop.recommendation.title).toBe("Recover lost margin");
    expect(loop.recommendation.predictedValueUsd).toBe(120000);
    expect(loop.recommendation.basis).toBe("modelled");
    expect(loop.recommendation.verified).toBe(false);
    // The forecast resolved TRUE off the realised measurement and was scored.
    expect(loop.forecast).not.toBeNull();
    expect(loop.forecast!.resolved).toBe(true);
    expect(loop.forecast!.outcome).toBe(1);
    expect(loop.forecast!.brierScore).toBe(0.09);
    expect(loop.forecast!.resolutionBasis).toBe("modelled");
    // The measurement: realised at the prediction, zero variance, modelled basis.
    expect(loop.measurement).not.toBeNull();
    expect(loop.measurement!.status).toBe("realized");
    expect(loop.measurement!.basis).toBe("modelled");
    expect(loop.measurement!.realizedValueUsd).toBe(120000);
    expect(loop.measurement!.varianceVsPrediction).toBe(0);
    // The action exists and is bound to the loop.
    expect(loop.action).not.toBeNull();
  });

  it("shows an open loop with a null measurement and a null headline Brier", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.tenantOpen + "/outcome-loop", { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as LoopBody;

    // One loop, none closed: the headline Brier is null, never a fabricated zero.
    expect(body.summary).toEqual({ total: 1, closed: 0, open: 1, brierMean: null });
    expect(body.loops).toHaveLength(1);
    const loop = body.loops[0]!;
    expect(loop.state).toBe("open");
    expect(loop.measurement).toBeNull();
    expect(loop.forecast).not.toBeNull();
    expect(loop.forecast!.resolved).toBe(false);
    expect(loop.forecast!.outcome).toBeNull();
    expect(loop.forecast!.brierScore).toBeNull();
    expect(loop.recommendation.predictedValueUsd).toBe(50000);
  });

  it("returns an honest empty record for a tenant with no committed decisions", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.tenantEmpty + "/outcome-loop", { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as LoopBody;
    expect(body.summary).toEqual({ total: 0, closed: 0, open: 0, brierMean: null });
    expect(body.loops).toEqual([]);
  });

  it("requires a session", async () => {
    const r = await api("/api/tenants/" + ids.tenantClosed + "/outcome-loop");
    expect(r.status).toBe(401);
  });
});
