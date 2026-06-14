import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  alertEventsTable,
  db,
  orgsTable,
  pipelineJobsTable,
  tenantPipelineRunsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the owner Operations screen over HTTP against a real
// Postgres. Every figure is read from a real table, so the test seeds the real
// rows: a queued and a claimed pipeline_job (queue depth), an in-flight run on a
// known stage, a deliberately failed run with its failing stage and error, and a
// seed_run_failed alert. The route is global, so figures from other suites may
// be present; every assertion is scoped to THIS suite's own rows. Owner only:
// the surface is fenced for a member and unauthenticated. Self-cleaning.

const RUN = "opstest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
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
const ids = { providerOrg: "", owner: "", member: "", tenant: "", runningRun: "", errorRun: "", alert: "" };

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

interface OpsBody {
  operations: {
    queueDepth: { queued: number; claimed: number; done: number; error: number };
    inFlightRuns: { runId: string; currentStage: string | null; layerKey: string | null }[];
    recentFailures: {
      runId: string;
      failingStage: string | null;
      error: string | null;
      layerKey: string | null;
    }[];
    recentAlerts: { id: string; type: string; notificationStatus: string }[];
  };
}

beforeAll(async () => {
  setSecretStore(testStore);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner");
  ids.member = await seedUser("member", "provider-member");

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Tenant", url: "https://t." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant!.id;

  // Queue depth: one waiting (queued) and one in-flight (claimed) job.
  await db.insert(pipelineJobsTable).values([
    {
      type: "seed-layer",
      tenantId: ids.tenant,
      payload: { tenantId: ids.tenant, layerKey: "business-performance", mode: "full" },
      status: "queued",
    },
    {
      type: "seed-layer",
      tenantId: ids.tenant,
      payload: { tenantId: ids.tenant, layerKey: "growth-efficiency", mode: "express" },
      status: "claimed",
    },
  ]);

  // An in-flight run on the hypothesise stage.
  const [running] = await db
    .insert(tenantPipelineRunsTable)
    .values({
      tenantId: ids.tenant,
      layerKey: "business-performance",
      status: "running",
      subStages: [
        { name: "perceive", status: "done" },
        { name: "hypothesise", status: "running" },
      ],
    })
    .returning({ id: tenantPipelineRunsTable.id });
  ids.runningRun = running!.id;

  // A deliberately failed run: the failing stage and error must surface.
  const [errored] = await db
    .insert(tenantPipelineRunsTable)
    .values({
      tenantId: ids.tenant,
      layerKey: "growth-efficiency",
      status: "error",
      subStages: [
        { name: "perceive", status: "done" },
        { name: "hypothesise", status: "error", error: "deliberate failure" },
      ],
      error: "deliberate failure",
      finishedAt: new Date(),
    })
    .returning({ id: tenantPipelineRunsTable.id });
  ids.errorRun = errored!.id;

  const [alert] = await db
    .insert(alertEventsTable)
    .values({
      type: "seed_run_failed",
      severity: "critical",
      tenantId: ids.tenant,
      entityType: "pipeline_run",
      entityId: ids.errorRun,
      message: "seed run failed on hypothesise",
    })
    .returning({ id: alertEventsTable.id });
  ids.alert = alert!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    await db.delete(alertEventsTable).where(eq(alertEventsTable.tenantId, ids.tenant));
    await db.delete(pipelineJobsTable).where(eq(pipelineJobsTable.tenantId, ids.tenant));
    await db
      .delete(tenantPipelineRunsTable)
      .where(eq(tenantPipelineRunsTable.tenantId, ids.tenant));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
    await db.delete(usersTable).where(inArray(usersTable.id, [ids.owner, ids.member]));
    await db.delete(orgsTable).where(eq(orgsTable.id, ids.providerOrg));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("GET /api/operations/summary", () => {
  it("requires authentication", async () => {
    const r = await api("/api/operations/summary");
    expect(r.status).toBe(401);
  });

  it("fences out a non-owner provider member", async () => {
    const session = await loginSession("member");
    const r = await api("/api/operations/summary", { session });
    expect(r.status).toBe(403);
  });

  it("reports queue depth, in-flight stage, failing stage, and the alert feed for the owner", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/operations/summary", { session });
    expect(r.status).toBe(200);
    const ops = (r.json as OpsBody).operations;

    // Queue depth is global; our two jobs guarantee at least these minima.
    expect(ops.queueDepth.queued).toBeGreaterThanOrEqual(1);
    expect(ops.queueDepth.claimed).toBeGreaterThanOrEqual(1);

    const mineRunning = ops.inFlightRuns.find((x) => x.runId === ids.runningRun);
    expect(mineRunning).toBeDefined();
    expect(mineRunning!.currentStage).toBe("hypothesise");
    expect(mineRunning!.layerKey).toBe("business-performance");

    const mineFailed = ops.recentFailures.find((x) => x.runId === ids.errorRun);
    expect(mineFailed).toBeDefined();
    expect(mineFailed!.failingStage).toBe("hypothesise");
    expect(mineFailed!.error).toBe("deliberate failure");

    const mineAlert = ops.recentAlerts.find((x) => x.id === ids.alert);
    expect(mineAlert).toBeDefined();
    expect(mineAlert!.type).toBe("seed_run_failed");
    // The delivery state is surfaced honestly (pending, or sent once the notifier
    // drained it in a parallel suite); never absent.
    expect(["pending", "sent", "failed", "suppressed"]).toContain(mineAlert!.notificationStatus);
  });
});
