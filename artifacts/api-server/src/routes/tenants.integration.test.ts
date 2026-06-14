import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  committedActionsTable,
  db,
  orgsTable,
  orgTenantsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the tenant list and committed-actions surface against a
// real Postgres, driven over HTTP through a throwaway listener, mirroring the
// auth integration test. All rows are namespaced by a unique run id and deleted
// afterwards so the suite is self-cleaning and safe to run repeatedly.
const RUN = `ttest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

const ids = {
  providerOrg: "",
  clientOrg: "",
  portfolioOrg: "",
  tenantA: "",
  tenantB: "",
  owner: "",
  member: "",
  clientViewer: "",
  portfolioUser: "",
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

function tenantIds(json: unknown): string[] {
  const list = (json as { tenants?: { id: string }[] }).tenants ?? [];
  return list.map((t) => t.id);
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
  const [portfolioOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Portfolio`, type: "portfolio" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg.id;
  ids.clientOrg = clientOrg.id;
  ids.portfolioOrg = portfolioOrg.id;

  const [tenantA] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant A`, url: "https://a.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  const [tenantB] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant B`, url: "https://b.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantA = tenantA.id;
  ids.tenantB = tenantB.id;

  // Client org sees only tenant A. Portfolio org sees A and B.
  await db.insert(orgTenantsTable).values([
    { orgId: ids.clientOrg, tenantId: ids.tenantA },
    { orgId: ids.portfolioOrg, tenantId: ids.tenantA },
    { orgId: ids.portfolioOrg, tenantId: ids.tenantB },
  ]);

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.member = await seedUser("member", "provider-member", ids.providerOrg);
  ids.clientViewer = await seedUser("client-viewer", "client-viewer", ids.clientOrg);
  ids.portfolioUser = await seedUser("portfolio-user", "client-admin", ids.portfolioOrg);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    await db.delete(committedActionsTable).where(
      inArray(committedActionsTable.tenantId, [ids.tenantA, ids.tenantB]),
    );
    await db.delete(orgTenantsTable).where(
      inArray(orgTenantsTable.orgId, [ids.clientOrg, ids.portfolioOrg, ids.providerOrg]),
    );
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenantA, ids.tenantB]));
    await db.delete(orgsTable).where(
      inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg, ids.portfolioOrg]),
    );
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("GET /api/tenants access filtering", () => {
  it("requires authentication", async () => {
    const r = await api("/api/tenants");
    expect(r.status).toBe(401);
  });

  it("lets a provider seat see every tenant", async () => {
    const session = await loginSession("member");
    const r = await api("/api/tenants", { session });
    expect(r.status).toBe(200);
    const got = tenantIds(r.json);
    expect(got).toContain(ids.tenantA);
    expect(got).toContain(ids.tenantB);
  });

  it("fences a client seat to its bound tenant only", async () => {
    const session = await loginSession("client-viewer");
    const r = await api("/api/tenants", { session });
    expect(r.status).toBe(200);
    const got = tenantIds(r.json);
    expect(got).toContain(ids.tenantA);
    expect(got).not.toContain(ids.tenantB);
  });

  it("returns a portfolio seat its whole bound set", async () => {
    const session = await loginSession("portfolio-user");
    const r = await api("/api/tenants", { session });
    expect(r.status).toBe(200);
    const got = tenantIds(r.json);
    expect(got).toContain(ids.tenantA);
    expect(got).toContain(ids.tenantB);
  });
});

describe("committed actions", () => {
  const validBody = {
    layerKey: "business-performance",
    title: "Reprice the underpriced enterprise segment",
    detail: "Lift list price 6 percent on the segment showing the widest discount leakage.",
    predictedImpact: "Recovers an estimated 2.1 points of gross margin within two quarters.",
    timing: "This quarter",
    owner: "CFO",
    basis: "modelled" as const,
    confidence: 72,
  };

  it("lets a client-admin commit an action and reads it back in the track record", async () => {
    // A client-admin acting on its own tenant may write; a client-viewer may not.
    const session = await loginSession("portfolio-user");
    const created = await api(`/api/tenants/${ids.tenantA}/actions`, {
      method: "POST",
      body: validBody,
      session,
    });
    expect(created.status).toBe(201);
    const action = (created.json as { action: Record<string, unknown> }).action;
    expect(action).toMatchObject({
      tenantId: ids.tenantA,
      layerKey: "business-performance",
      title: validBody.title,
      predictedImpact: validBody.predictedImpact,
      actionOwner: "CFO",
      basis: "modelled",
      confidence: 72,
      status: "committed",
      committedBy: ids.portfolioUser,
    });

    const list = await api(`/api/tenants/${ids.tenantA}/actions`, { session });
    expect(list.status).toBe(200);
    const listIds = (list.json as { actions: { id: string }[] }).actions.map((a) => a.id);
    expect(listIds).toContain(action.id);
  });

  it("advances a committed action through its honest lifecycle", async () => {
    const session = await loginSession("portfolio-user");
    const created = await api(`/api/tenants/${ids.tenantA}/actions`, {
      method: "POST",
      body: validBody,
      session,
    });
    const actionId = (created.json as { action: { id: string } }).action.id;

    const advanced = await api(`/api/tenants/${ids.tenantA}/actions/${actionId}/status`, {
      method: "POST",
      body: { status: "in_progress", note: "Pricing committee briefed." },
      session,
    });
    expect(advanced.status).toBe(200);
    expect((advanced.json as { action: { status: string; note: string } }).action).toMatchObject({
      status: "in_progress",
      note: "Pricing committee briefed.",
    });
  });

  it("rejects an invalid commit body", async () => {
    const session = await loginSession("portfolio-user");
    const r = await api(`/api/tenants/${ids.tenantA}/actions`, {
      method: "POST",
      body: { layerKey: "", title: "", basis: "guessed", confidence: 200 },
      session,
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "invalid_input" });
  });

  it("404s a status update for an action that does not exist", async () => {
    const session = await loginSession("portfolio-user");
    const r = await api(
      `/api/tenants/${ids.tenantA}/actions/00000000-0000-0000-0000-000000000000/status`,
      { method: "POST", body: { status: "done" }, session },
    );
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "not_found" });
  });

  it("refuses a client-viewer committing to a tenant it can read (read-only seat)", async () => {
    // tenantA IS in the client-viewer's scope, so this is not tenant fencing:
    // it proves the viewer seat itself cannot write the track record.
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/actions`, {
      method: "POST",
      body: validBody,
      session,
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("refuses a client-viewer advancing an action it can read (read-only seat)", async () => {
    // A provider commits a real action on tenantA, then the read-only viewer,
    // which CAN read that action, is refused when it tries to advance it.
    const provider = await loginSession("member");
    const created = await api(`/api/tenants/${ids.tenantA}/actions`, {
      method: "POST",
      body: validBody,
      session: provider,
    });
    expect(created.status).toBe(201);
    const actionId = (created.json as { action: { id: string } }).action.id;

    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/actions/${actionId}/status`, {
      method: "POST",
      body: { status: "in_progress" },
      session,
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("fences a client seat out of committing to a tenant it cannot access", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantB}/actions`, {
      method: "POST",
      body: validBody,
      session,
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("does not leak one tenant's actions to another tenant scope", async () => {
    const session = await loginSession("member");
    // A provider commits to tenant B; it must not appear under tenant A.
    const created = await api(`/api/tenants/${ids.tenantB}/actions`, {
      method: "POST",
      body: validBody,
      session,
    });
    expect(created.status).toBe(201);
    const bId = (created.json as { action: { id: string } }).action.id;

    const aList = await api(`/api/tenants/${ids.tenantA}/actions`, { session });
    const aIds = (aList.json as { actions: { id: string }[] }).actions.map((a) => a.id);
    expect(aIds).not.toContain(bId);

    // Confirm the row really is bound to tenant B.
    const row = (
      await db
        .select({ tenantId: committedActionsTable.tenantId })
        .from(committedActionsTable)
        .where(eq(committedActionsTable.id, bId))
        .limit(1)
    )[0];
    expect(row.tenantId).toBe(ids.tenantB);
  });
});

interface OverviewRow {
  key: string;
  name: string;
  archetype: string;
  ownerPersona: string;
  sortOrder: number;
  feeds: string[];
  generated: boolean;
  headlineFinding: string | null;
  leadMetric: unknown;
  hero: unknown;
  topGap: unknown;
}

function overviewRows(json: unknown): OverviewRow[] {
  return (json as { overview?: OverviewRow[] }).overview ?? [];
}

describe("GET /api/tenants/:id/overview", () => {
  it("requires authentication", async () => {
    const r = await api(`/api/tenants/${ids.tenantA}/overview`);
    expect(r.status).toBe(401);
  });

  it("returns every registry layer in sort order for an accessible tenant", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/overview`, { session });
    expect(r.status).toBe(200);

    const rows = overviewRows(r.json);
    // The left join returns one row per registry layer even when the tenant has
    // no generated content, so the surface always knows the full registry.
    expect(rows.length).toBeGreaterThanOrEqual(14);

    const orders = rows.map((row) => row.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    for (const row of rows) {
      expect(typeof row.key).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.archetype).toBe("string");
      expect(Array.isArray(row.feeds)).toBe(true);
    }
  });

  it("marks ungenerated layers honestly rather than fabricating content", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/overview`, { session });
    const rows = overviewRows(r.json);

    // Tenant A has no tenant_layers rows in this suite, so every layer must
    // report generated:false with null content, never an invented stand-in.
    for (const row of rows) {
      expect(row.generated).toBe(false);
      expect(row.headlineFinding).toBeNull();
      expect(row.leadMetric).toBeNull();
      expect(row.hero).toBeNull();
      expect(row.topGap).toBeNull();
    }
  });

  it("fences a client seat out of a tenant it cannot access", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantB}/overview`, { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });
});

interface SignalRow {
  key: string;
  name: string;
  moduleGroup: string;
  feeds: string[];
  sortOrder: number;
  generated: boolean;
  headlineFinding: string | null;
  causes: unknown[];
  actions: unknown[];
  gaps: unknown[];
  hypotheses: unknown[];
  confounders: unknown[];
  verifiedCount: number;
  modelledCount: number;
}

function signalRows(json: unknown): SignalRow[] {
  return (json as { signals?: SignalRow[] }).signals ?? [];
}

describe("GET /api/tenants/:id/signals", () => {
  it("requires authentication", async () => {
    const r = await api(`/api/tenants/${ids.tenantA}/signals`);
    expect(r.status).toBe(401);
  });

  it("returns every registry layer in sort order with array signal fields", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/signals`, { session });
    expect(r.status).toBe(200);

    const rows = signalRows(r.json);
    expect(rows.length).toBeGreaterThanOrEqual(14);

    const orders = rows.map((row) => row.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    for (const row of rows) {
      expect(typeof row.key).toBe("string");
      expect(typeof row.moduleGroup).toBe("string");
      expect(Array.isArray(row.feeds)).toBe(true);
      // The signal arrays are always arrays, never null, so the pure derive
      // functions can map over them without guarding for null.
      expect(Array.isArray(row.causes)).toBe(true);
      expect(Array.isArray(row.actions)).toBe(true);
      expect(Array.isArray(row.gaps)).toBe(true);
      expect(Array.isArray(row.hypotheses)).toBe(true);
      expect(Array.isArray(row.confounders)).toBe(true);
      expect(typeof row.verifiedCount).toBe("number");
      expect(typeof row.modelledCount).toBe("number");
    }
  });

  it("marks ungenerated layers honestly with empty signals", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantA}/signals`, { session });
    const rows = signalRows(r.json);

    // Tenant A has no tenant_layers rows in this suite: every layer reports
    // generated:false with empty signal arrays and zero claim counts, never an
    // invented anomaly.
    for (const row of rows) {
      expect(row.generated).toBe(false);
      expect(row.headlineFinding).toBeNull();
      expect(row.causes).toEqual([]);
      expect(row.actions).toEqual([]);
      expect(row.gaps).toEqual([]);
      expect(row.hypotheses).toEqual([]);
      expect(row.confounders).toEqual([]);
      expect(row.verifiedCount).toBe(0);
      expect(row.modelledCount).toBe(0);
    }
  });

  it("fences a client seat out of a tenant it cannot access", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenantB}/signals`, { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });
});

interface ArchitectureStage {
  name: string;
  seat: string;
  role: string;
  provider: string;
  model: string;
  webSearch: boolean;
  grounding: boolean;
}

describe("GET /api/architecture", () => {
  it("requires authentication", async () => {
    const r = await api("/api/architecture");
    expect(r.status).toBe(401);
  });

  it("returns the three seats and the nine ordered layer stages", async () => {
    const session = await loginSession("client-viewer");
    const r = await api("/api/architecture", { session });
    expect(r.status).toBe(200);

    const body = r.json as {
      seats: Record<string, { provider: string; model: string }>;
      stages: ArchitectureStage[];
    };
    expect(Object.keys(body.seats).sort()).toEqual(["evaluator", "grounder", "reasoner"]);
    for (const seat of Object.values(body.seats)) {
      expect(typeof seat.provider).toBe("string");
      expect(seat.model.length).toBeGreaterThan(0);
    }

    expect(body.stages).toHaveLength(9);
    const names = body.stages.map((s) => s.name);
    expect(names).toEqual([
      "perceive",
      "hypothesise",
      "confound",
      "challenge",
      "narrate",
      "score",
      "hero",
      "peers",
      "supplements",
    ]);
    // Each stage resolves to a real seat and model; the grounded seats carry the
    // flags the page surfaces (perceive web search, confound/challenge grounding).
    for (const stage of body.stages) {
      expect(stage.model.length).toBeGreaterThan(0);
      expect(["reasoner", "evaluator", "grounder"]).toContain(stage.seat);
    }
    const byName = new Map(body.stages.map((s) => [s.name, s]));
    expect(byName.get("perceive")?.webSearch).toBe(true);
    expect(byName.get("confound")?.grounding).toBe(true);
    expect(byName.get("challenge")?.grounding).toBe(true);
  });
});
