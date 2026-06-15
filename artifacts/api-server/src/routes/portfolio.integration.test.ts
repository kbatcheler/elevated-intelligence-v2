import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  committedActionsTable,
  db,
  layersTable,
  orgsTable,
  orgTenantsTable,
  outcomeMeasurementsTable,
  tenantLayersTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Portfolio Intelligence read against a real Postgres,
// over HTTP through a throwaway listener. Same self-cleaning harness as the
// client and auth suites: every row is namespaced by a unique run id and deleted
// afterwards, so the suite is safe to run repeatedly against the dev database.
//
// The shape under test is the scope fence: a provider seat sees every tenant; a
// portfolio-org seat sees ONLY the tenants its org is bound to; a client-org seat
// is refused with 403. The math (value on the table, ranking, gap patterns) is
// asserted on the portfolio-org response, where the tenant set is deterministic.
const RUN = `ptest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  owner: "",
  portfolioAdmin: "",
  clientAdmin: "",
  actionA: "",
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

function layerContent(description: string, confidence: number) {
  return {
    confidence,
    gaps: [{ kind: "INTEG", description, confidence_lift_pp: 25 }],
  };
}

beforeAll(async () => {
  setSecretStore(testStore);

  const firstLayer = (
    await db.select({ key: layersTable.key }).from(layersTable).orderBy(layersTable.sortOrder).limit(1)
  )[0];
  if (!firstLayer) throw new Error("layer registry is empty; cannot run portfolio integration test");
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

  // The portfolio org holds tenant A and tenant B; the client org holds tenant C.
  await db.insert(orgTenantsTable).values([
    { orgId: ids.portfolioOrg, tenantId: ids.tenantA },
    { orgId: ids.portfolioOrg, tenantId: ids.tenantB },
    { orgId: ids.clientOrg, tenantId: ids.tenantC },
  ]);

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.portfolioAdmin = await seedUser("portfolio-admin", "client-admin", ids.portfolioOrg);
  ids.clientAdmin = await seedUser("client-admin", "client-admin", ids.clientOrg);

  // Both portfolio tenants carry a generated layer with the same INTEG gap, so a
  // cross-portfolio pattern forms across exactly the two of them.
  await db.insert(tenantLayersTable).values([
    {
      tenantId: ids.tenantA,
      layerKey,
      content: layerContent("CRM not synced to the warehouse", 80),
      generatorModel: "integration-test",
    },
    {
      tenantId: ids.tenantB,
      layerKey,
      content: layerContent("CRM fields stale", 50),
      generatorModel: "integration-test",
    },
  ]);

  // Tenant A has a committed action with a 100000 prediction and a 40000 realized
  // measurement, so it carries 60000 of value still on the table. Tenant B has no
  // action, so its unrealized value is honestly null and it ranks below A.
  const [actionA] = await db
    .insert(committedActionsTable)
    .values({
      tenantId: ids.tenantA,
      layerKey,
      title: `${RUN} action A`,
      predictedValueUsd: "100000.00",
      basis: "modelled",
      confidence: 80,
      committedBy: ids.owner,
    })
    .returning({ id: committedActionsTable.id });
  ids.actionA = actionA.id;

  await db.insert(outcomeMeasurementsTable).values({
    actionId: ids.actionA,
    realizedValueUsd: "40000.00",
    basis: "modelled",
    status: "on_track",
    recordedBy: ids.owner,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    await db.delete(orgTenantsTable).where(
      inArray(orgTenantsTable.orgId, [ids.portfolioOrg, ids.clientOrg]),
    );
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    // Deleting the tenants cascades their tenant_layers, committed_actions and the
    // measurements that hang off those actions.
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenantA, ids.tenantB, ids.tenantC]));
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

interface PortfolioBody {
  portfolio: {
    scope: { type: string; orgId: string | null; orgName: string | null };
    totals: {
      tenantCount: number;
      valueIdentifiedUsd: number | null;
      valueRealizedUsd: number | null;
      unrealizedValueUsd: number | null;
      openGaps: { total: number; high: number; medium: number; low: number; severityScore: number };
    };
    tenants: {
      rank: number;
      tenantId: string;
      tenantName: string;
      valueIdentifiedUsd: number | null;
      valueRealizedUsd: number | null;
      unrealizedValueUsd: number | null;
      overallConfidence: number | null;
      openGaps: { total: number; high: number; medium: number; low: number };
    }[];
    patterns: { layerKey: string; kind: string | null; affectedTenants: number; tenantIds: string[] }[];
  };
}

describe("the portfolio summary is fenced by scope resolved from the session", () => {
  it("requires a session at all", async () => {
    const r = await api("/api/portfolio/summary");
    expect(r.status).toBe(401);
  });

  it("refuses a client-org seat with portfolio_only", async () => {
    const session = await loginSession("client-admin");
    const r = await api("/api/portfolio/summary", { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "portfolio_only" });
  });

  it("shows a provider seat every tenant as a provider-scoped portfolio", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/portfolio/summary", { session });
    expect(r.status).toBe(200);
    const body = r.json as PortfolioBody;
    expect(body.portfolio.scope.type).toBe("provider");
    const seen = new Set(body.portfolio.tenants.map((t) => t.tenantId));
    expect(seen.has(ids.tenantA)).toBe(true);
    expect(seen.has(ids.tenantB)).toBe(true);
    expect(seen.has(ids.tenantC)).toBe(true);
  });
});

describe("a portfolio-org seat sees only its bound tenants, ranked, with honest math", () => {
  it("fences the board to the two bound tenants and excludes the client-org tenant", async () => {
    const session = await loginSession("portfolio-admin");
    const r = await api("/api/portfolio/summary", { session });
    expect(r.status).toBe(200);
    const body = r.json as PortfolioBody;
    expect(body.portfolio.scope.type).toBe("portfolio");
    expect(body.portfolio.scope.orgId).toBe(ids.portfolioOrg);
    expect(body.portfolio.scope.orgName).toBe(`${RUN} Holdings`);
    const seen = new Set(body.portfolio.tenants.map((t) => t.tenantId));
    expect(seen).toEqual(new Set([ids.tenantA, ids.tenantB]));
    expect(seen.has(ids.tenantC)).toBe(false);
  });

  it("ranks the company with value on the table first and computes its figures from persisted state", async () => {
    const session = await loginSession("portfolio-admin");
    const r = await api("/api/portfolio/summary", { session });
    const body = r.json as PortfolioBody;

    const top = body.portfolio.tenants.find((t) => t.rank === 1);
    expect(top?.tenantId).toBe(ids.tenantA);
    expect(top?.valueIdentifiedUsd).toBe(100000);
    expect(top?.valueRealizedUsd).toBe(40000);
    expect(top?.unrealizedValueUsd).toBe(60000);
    expect(top?.overallConfidence).toBe(80);
    expect(top?.openGaps.high).toBe(1);

    const tenantB = body.portfolio.tenants.find((t) => t.tenantId === ids.tenantB);
    expect(tenantB?.unrealizedValueUsd).toBeNull();
    expect((tenantB?.rank ?? 0) > (top?.rank ?? 0)).toBe(true);

    expect(body.portfolio.totals.tenantCount).toBe(2);
    expect(body.portfolio.totals.valueIdentifiedUsd).toBe(100000);
    expect(body.portfolio.totals.unrealizedValueUsd).toBe(60000);
  });

  it("surfaces the shared INTEG gap as a cross-portfolio pattern across both companies", async () => {
    const session = await loginSession("portfolio-admin");
    const r = await api("/api/portfolio/summary", { session });
    const body = r.json as PortfolioBody;

    const pattern = body.portfolio.patterns.find((p) => p.layerKey === layerKey && p.kind === "INTEG");
    expect(pattern).toBeTruthy();
    expect(pattern?.affectedTenants).toBe(2);
    expect(new Set(pattern?.tenantIds)).toEqual(new Set([ids.tenantA, ids.tenantB]));
  });
});
