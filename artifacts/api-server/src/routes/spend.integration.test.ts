import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEATS, costUsdForUsage } from "@workspace/cortex";
import { db, modelUsageTable, orgsTable, tenantsTable, usersTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { assertSeedWithinBudget, BudgetExceededError } from "../lib/pipeline/budget";
import { recordModelUsage } from "../lib/pipeline/usage";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Phase N cost surface over HTTP against a real
// Postgres: the usage writer's one-row invariant, the spend summary reconciling
// to a direct SUM of the ledger (owner only; member fenced out), and the budget
// governor refusing a seed once a real cap is reached. Rows are namespaced by a
// run id and removed afterwards so the suite is self-cleaning. The model strings
// live only in config.ts; a test may read them through SEATS.
const RUN = "spendtest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const EMAIL_PREFIX = RUN + "-";
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const reasonerModel = SEATS.reasoner.model;

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
const ids = { providerOrg: "", owner: "", member: "", tenant: "" };
const oneCallRunId = randomUUID();
const zeroCallRunId = randomUUID();
const noCallRunId = randomUUID();

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member",
): Promise<string> {
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

  // Three directly-priced rows for the reconcile, across two stages and seats.
  await db.insert(modelUsageTable).values([
    {
      tenantId: ids.tenant,
      runId: randomUUID(),
      stage: "perceive",
      layerKey: "business-performance",
      seat: "reasoner",
      model: reasonerModel,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: "0.500000",
    },
    {
      tenantId: ids.tenant,
      runId: randomUUID(),
      stage: "score",
      layerKey: "business-performance",
      seat: "reasoner",
      model: reasonerModel,
      inputTokens: 2000,
      outputTokens: 800,
      costUsd: "1.250000",
    },
    {
      tenantId: ids.tenant,
      runId: randomUUID(),
      stage: "profile",
      layerKey: null,
      seat: "evaluator",
      model: reasonerModel,
      costUsd: "0.000000",
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    // Delete the cost rows BEFORE the tenant: tenantId nulls out (not cascades) on
    // a tenant delete, which would orphan the rows out of this cleanup filter.
    await db.delete(modelUsageTable).where(eq(modelUsageTable.tenantId, ids.tenant));
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

describe("usage writer one-row invariant", () => {
  it("records exactly one priced row for a real call", async () => {
    await recordModelUsage({
      tenantId: ids.tenant,
      runId: oneCallRunId,
      stage: "hypothesise",
      layerKey: "business-performance",
      telemetry: {
        seat: "reasoner",
        model: reasonerModel,
        billed: true,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });
    const rows = await db
      .select()
      .from(modelUsageTable)
      .where(eq(modelUsageTable.runId, oneCallRunId));
    expect(rows).toHaveLength(1);
    const expected = costUsdForUsage({
      model: reasonerModel,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(Number(rows[0]!.costUsd)).toBeCloseTo(expected, 6);
  });

  it("records no row for a call with no resolved model (nothing costable)", async () => {
    await recordModelUsage({
      tenantId: ids.tenant,
      runId: zeroCallRunId,
      stage: "perceive",
      layerKey: "business-performance",
      telemetry: { seat: "reasoner", inputTokens: 100 },
    });
    const rows = await db
      .select()
      .from(modelUsageTable)
      .where(eq(modelUsageTable.runId, zeroCallRunId));
    expect(rows).toHaveLength(0);
  });

  it("records no row for a no-call failure even when a model is configured", async () => {
    // The honest no-call case: a stage failed before any billed provider response
    // (no in-boundary model connected, missing provider env, a transport error).
    // The telemetry still carries the configured model, but billed is false, so
    // costing it would fabricate a zero-cost call that never happened.
    await recordModelUsage({
      tenantId: ids.tenant,
      runId: noCallRunId,
      stage: "perceive",
      layerKey: "business-performance",
      telemetry: { seat: "reasoner", model: reasonerModel, billed: false, inputTokens: 0 },
    });
    const rows = await db
      .select()
      .from(modelUsageTable)
      .where(eq(modelUsageTable.runId, noCallRunId));
    expect(rows).toHaveLength(0);
  });
});

describe("GET /api/spend/summary", () => {
  it("requires authentication", async () => {
    const r = await api("/api/spend/summary");
    expect(r.status).toBe(401);
  });

  it("fences out a non-owner provider member", async () => {
    const session = await loginSession("member");
    const r = await api("/api/spend/summary", { session });
    expect(r.status).toBe(403);
  });

  it("returns totals that reconcile to a direct SUM of the ledger for the owner", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/spend/summary", { session });
    expect(r.status).toBe(200);
    const spend = (r.json as { spend: Record<string, unknown> }).spend;

    const [global] = await db
      .select({
        total: sql<string>`coalesce(sum(${modelUsageTable.costUsd}), 0)`,
        calls: sql<string>`count(*)`,
      })
      .from(modelUsageTable);
    const [tenant] = await db
      .select({
        total: sql<string>`coalesce(sum(${modelUsageTable.costUsd}), 0)`,
        calls: sql<string>`count(*)`,
      })
      .from(modelUsageTable)
      .where(eq(modelUsageTable.tenantId, ids.tenant));

    const total = spend.total as { costUsd: number; calls: number };
    expect(total.costUsd).toBeCloseTo(Number(global!.total), 6);
    expect(total.calls).toBe(Number(global!.calls));

    const byTenant = spend.byTenant as { tenantId: string | null; costUsd: number; calls: number }[];
    const mine = byTenant.find((t) => t.tenantId === ids.tenant);
    expect(mine).toBeDefined();
    expect(mine!.costUsd).toBeCloseTo(Number(tenant!.total), 6);
    expect(mine!.calls).toBe(Number(tenant!.calls));

    expect(typeof (spend.caps as { globalMonthlyCapUsd: number }).globalMonthlyCapUsd).toBe("number");
  });
});

describe("assertSeedWithinBudget against the real ledger", () => {
  const KEYS = [
    "SPEND_GLOBAL_MONTHLY_CAP_USD",
    "SPEND_TENANT_MONTHLY_CAP_USD",
    "SPEND_ALERT_THRESHOLD",
  ] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("allows a seed that is under both caps", async () => {
    await expect(assertSeedWithinBudget({ tenantId: ids.tenant })).resolves.toBeUndefined();
  });

  it("refuses a seed once the global cap is reached", async () => {
    process.env.SPEND_GLOBAL_MONTHLY_CAP_USD = "0.000001";
    await expect(assertSeedWithinBudget()).rejects.toMatchObject({
      name: "BudgetExceededError",
      scope: "global",
    });
    await expect(assertSeedWithinBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("lets an owner override bypass the GLOBAL cap", async () => {
    process.env.SPEND_GLOBAL_MONTHLY_CAP_USD = "0.000001";
    await expect(assertSeedWithinBudget({ priorityOverride: true })).resolves.toBeUndefined();
  });

  it("refuses a seed once the per-tenant cap is reached", async () => {
    process.env.SPEND_TENANT_MONTHLY_CAP_USD = "0.01";
    await expect(assertSeedWithinBudget({ tenantId: ids.tenant })).rejects.toMatchObject({
      scope: "tenant",
    });
  });

  it("never lets the override bypass a per-tenant cap", async () => {
    process.env.SPEND_TENANT_MONTHLY_CAP_USD = "0.01";
    await expect(
      assertSeedWithinBudget({ tenantId: ids.tenant, priorityOverride: true }),
    ).rejects.toMatchObject({ scope: "tenant" });
  });
});
