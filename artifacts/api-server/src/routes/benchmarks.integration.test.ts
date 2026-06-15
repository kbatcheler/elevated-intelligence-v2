import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  benchmarkCohortsTable,
  benchmarkConsentEventsTable,
  benchmarkEventsTable,
  benchmarkStatsTable,
  db,
  orgsTable,
  orgTenantsTable,
  tenantLayersTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// The Phase X benchmarking surface end to end against a real Postgres: the
// owner-only control routes (recompute, events, status), the tenant-scoped
// consent routes (default-off, audited, read-only seat refused), and the
// layer-detail cohort wiring (the honest lock state below the k floor). Every row
// is namespaced by a run id and removed afterwards. Recompute does a global
// rebuild, but it is a pure function of the current opt-in state and each file
// uses a unique segment, so concurrent files never disturb each other's segment.
const RUN = "benchroute-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const EMAIL_PREFIX = RUN + "-";
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";

// Two run-unique segments so the lock count is deterministic (one tenant each)
// and no other file's cohort can ever collide.
const CONSENT_SECTOR = RUN + "-sec";
const CONSENT_BAND = RUN + "-band";
const LAYER_SECTOR = RUN + "-lsec";
const LAYER_BAND = RUN + "-lband";
const CONSENT_SEGMENT = CONSENT_SECTOR + "|" + CONSENT_BAND;
const LAYER_SEGMENT = LAYER_SECTOR + "|" + LAYER_BAND;
const LAYER_KEY = "business-performance";

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
const auditRowIds: string[] = [];

const ids = {
  providerOrg: "",
  clientOrg: "",
  owner: "",
  member: "",
  viewer: "",
  consentTenant: "",
  layerTenant: "",
  unboundTenant: "",
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
  apiPath: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session) headers["cookie"] = "ei_session=" + opts.session;
  const res = await fetch(base + apiPath, {
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

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member" | "client-viewer",
  orgId: string,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
}

beforeAll(async () => {
  setSecretStore(testStore);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Provider", type: "provider" })
    .returning({ id: orgsTable.id });
  const [clientOrg] = await db
    .insert(orgsTable)
    .values({ name: RUN + " Client", type: "client" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;
  ids.clientOrg = clientOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.member = await seedUser("member", "provider-member", ids.providerOrg);
  ids.viewer = await seedUser("viewer", "client-viewer", ids.clientOrg);

  const [consentTenant] = await db
    .insert(tenantsTable)
    .values({
      name: RUN + " Consent",
      url: "https://consent." + RUN + ".example.com",
      status: "ready",
      sector: CONSENT_SECTOR,
      revenueBand: CONSENT_BAND,
    })
    .returning({ id: tenantsTable.id });
  const [layerTenant] = await db
    .insert(tenantsTable)
    .values({
      name: RUN + " Layer",
      url: "https://layer." + RUN + ".example.com",
      status: "ready",
      sector: LAYER_SECTOR,
      revenueBand: LAYER_BAND,
    })
    .returning({ id: tenantsTable.id });
  const [unboundTenant] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Unbound", url: "https://unbound." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.consentTenant = consentTenant!.id;
  ids.layerTenant = layerTenant!.id;
  ids.unboundTenant = unboundTenant!.id;

  // The viewer's client org sees only the consent tenant: it can READ it but the
  // viewer seat cannot WRITE consent. The unbound tenant proves tenant fencing.
  await db.insert(orgTenantsTable).values([{ orgId: ids.clientOrg, tenantId: ids.consentTenant }]);

  // A minimal generated layer for the layer tenant, so the layer-detail route
  // returns 200 and we can assert the cohort wiring on it.
  await db.insert(tenantLayersTable).values({
    tenantId: ids.layerTenant,
    layerKey: LAYER_KEY,
    content: {},
    generatorModel: "integration-test",
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    if (auditRowIds.length > 0) {
      await db.delete(benchmarkEventsTable).where(inArray(benchmarkEventsTable.id, auditRowIds));
    }
    await db
      .delete(benchmarkStatsTable)
      .where(inArray(benchmarkStatsTable.cohortSegmentKey, [CONSENT_SEGMENT, LAYER_SEGMENT]));
    await db
      .delete(benchmarkCohortsTable)
      .where(inArray(benchmarkCohortsTable.segmentKey, [CONSENT_SEGMENT, LAYER_SEGMENT]));
    await db
      .delete(benchmarkConsentEventsTable)
      .where(inArray(benchmarkConsentEventsTable.tenantId, [ids.consentTenant, ids.layerTenant]));
    // tenant_layers cascades off the tenant.
    await db
      .delete(tenantsTable)
      .where(inArray(tenantsTable.id, [ids.consentTenant, ids.layerTenant, ids.unboundTenant]));
    await db.delete(orgTenantsTable).where(inArray(orgTenantsTable.orgId, [ids.clientOrg]));
    await db.delete(usersTable).where(like(usersTable.email, EMAIL_PREFIX + "%"));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

const RECOMPUTE = "/api/benchmarks/recompute";
const EVENTS = "/api/benchmarks/events";
const STATUS = "/api/benchmarks/status";

describe("benchmarks owner-only routes gating", () => {
  it("rejects unauthenticated access to every route", async () => {
    expect((await api(RECOMPUTE, { method: "POST" })).status).toBe(401);
    expect((await api(EVENTS)).status).toBe(401);
    expect((await api(STATUS)).status).toBe(401);
  });

  it("forbids a non-owner provider member", async () => {
    const member = await loginSession("member");
    expect((await api(RECOMPUTE, { method: "POST", session: member })).status).toBe(403);
    expect((await api(EVENTS, { session: member })).status).toBe(403);
    expect((await api(STATUS, { session: member })).status).toBe(403);
  });

  it("forbids a client seat", async () => {
    const viewer = await loginSession("viewer");
    expect((await api(STATUS, { session: viewer })).status).toBe(403);
    expect((await api(RECOMPUTE, { method: "POST", session: viewer })).status).toBe(403);
  });
});

describe("benchmarks owner routes", () => {
  it("recomputes and returns honest identity-free run counts", async () => {
    const owner = await loginSession("owner");
    const r = await api(RECOMPUTE, { method: "POST", session: owner });
    expect(r.status).toBe(200);
    const body = r.json as {
      cohortCount: number;
      statCount: number;
      skippedTenantCount: number;
      contributingTenantCount: number;
      minCohort: number;
      auditRowId: string;
    };
    expect(typeof body.cohortCount).toBe("number");
    expect(typeof body.statCount).toBe("number");
    expect(typeof body.skippedTenantCount).toBe("number");
    expect(typeof body.contributingTenantCount).toBe("number");
    expect(body.minCohort).toBeGreaterThan(0);
    expect(typeof body.auditRowId).toBe("string");
    auditRowIds.push(body.auditRowId);
    // The whole payload is aggregate: it never names a tenant.
    expect(JSON.stringify(body)).not.toContain(ids.consentTenant);
    expect(JSON.stringify(body)).not.toContain(ids.layerTenant);
  });

  it("returns the recompute audit history to the owner", async () => {
    const owner = await loginSession("owner");
    const r = await api(EVENTS, { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as { events: { action: string }[] };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.some((e) => e.action === "recompute")).toBe(true);
  });

  it("reports status with config and aggregate counts only", async () => {
    const owner = await loginSession("owner");
    const r = await api(STATUS, { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as {
      minCohort: number;
      noiseBand: number;
      recomputeIntervalMs: number;
      cohortCount: number;
      statCount: number;
      lastRecompute: { action: string } | null;
    };
    expect(body.minCohort).toBeGreaterThan(0);
    expect(body.noiseBand).toBeGreaterThan(0);
    expect(body.recomputeIntervalMs).toBeGreaterThan(0);
    expect(typeof body.cohortCount).toBe("number");
    expect(typeof body.statCount).toBe("number");
  });
});

describe("benchmark consent (tenant-scoped, audited)", () => {
  it("defaults to off with an empty audit", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      session: owner,
    });
    expect(r.status).toBe(200);
    const body = r.json as { optIn: boolean; events: unknown[] };
    expect(body.optIn).toBe(false);
    expect(body.events).toEqual([]);
  });

  it("opts in, logs one audit row, and is idempotent", async () => {
    const owner = await loginSession("owner");
    const first = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: true, reason: "join the network" },
      session: owner,
    });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ optIn: true, changed: true });

    // Re-posting the same state changes nothing and writes no second row.
    const again = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: true },
      session: owner,
    });
    expect(again.json).toEqual({ optIn: true, changed: false });

    const read = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      session: owner,
    });
    const body = read.json as {
      optIn: boolean;
      events: { action: string; authorityRole: string; reason: string | null }[];
    };
    expect(body.optIn).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.action).toBe("opt_in");
    expect(body.events[0]!.authorityRole).toBe("provider-owner");
    expect(body.events[0]!.reason).toBe("join the network");
  });

  it("opts out and appends a second audit row, newest first", async () => {
    const owner = await loginSession("owner");
    const out = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: false },
      session: owner,
    });
    expect(out.json).toEqual({ optIn: false, changed: true });

    const read = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      session: owner,
    });
    const body = read.json as { optIn: boolean; events: { action: string }[] };
    expect(body.optIn).toBe(false);
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.action).toBe("opt_out");
    expect(body.events[1]!.action).toBe("opt_in");
  });

  it("refuses a client-viewer changing consent on a tenant it can read", async () => {
    // The consent tenant IS in the viewer's org scope, so this is the read-only
    // seat rule, not tenant fencing.
    const viewer = await loginSession("viewer");
    const r = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: true },
      session: viewer,
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("fences a client seat out of a tenant it cannot access", async () => {
    const viewer = await loginSession("viewer");
    const r = await api("/api/tenants/" + ids.unboundTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: true },
      session: viewer,
    });
    expect(r.status).toBe(403);
  });

  it("rejects a malformed consent body", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.consentTenant + "/benchmark-consent", {
      method: "POST",
      body: { optIn: "yes" },
      session: owner,
    });
    expect(r.status).toBe(400);
  });
});

describe("layer detail cohort wiring", () => {
  it("returns no cohort before opt-in", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.layerTenant + "/layers/" + LAYER_KEY, {
      session: owner,
    });
    expect(r.status).toBe(200);
    const body = r.json as { cohortBenchmark: unknown; cohortLock: unknown };
    expect(body.cohortBenchmark).toBeNull();
    expect(body.cohortLock).toBeNull();
  });

  it("shows an honest lock (no contributor identity) once opted in below the floor", async () => {
    // Opt the layer tenant in directly; its segment is unique so the live count
    // is exactly one and no stat exists, which is the lock path.
    await db
      .update(tenantsTable)
      .set({ benchmarkOptIn: true })
      .where(eq(tenantsTable.id, ids.layerTenant));

    const owner = await loginSession("owner");
    const r = await api("/api/tenants/" + ids.layerTenant + "/layers/" + LAYER_KEY, {
      session: owner,
    });
    expect(r.status).toBe(200);
    const body = r.json as {
      cohortBenchmark: unknown;
      cohortLock: { sector: string; revenueBand: string; currentCount: number; unlocksAt: number } | null;
    };
    expect(body.cohortBenchmark).toBeNull();
    expect(body.cohortLock).not.toBeNull();
    expect(body.cohortLock!.currentCount).toBe(1);
    expect(body.cohortLock!.unlocksAt).toBeGreaterThan(1);
    expect(body.cohortLock!.sector).toBe(LAYER_SECTOR);
    expect(body.cohortLock!.revenueBand).toBe(LAYER_BAND);
    // The lock is structurally identity-free: never a contributor id.
    expect(JSON.stringify(body.cohortLock)).not.toContain(ids.layerTenant);
  });
});
