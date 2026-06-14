import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDescriptor } from "@workspace/connectors";
import {
  connectorRunsTable,
  connectorsTable,
  db,
  derivedSignalsTable,
  edgeAgentsTable,
  orgsTable,
  tenantConnectionsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the in-client agent surface against a real Postgres,
// driven over HTTP through a throwaway listener. It proves the two acceptance
// points for the agent routes: config pull and signal ingest are tenant scoped
// and credential gated. Rows are namespaced by a unique run id and deleted
// afterwards, so the suite is self-cleaning and safe to run repeatedly. No live
// connector runs; the agent posts a DerivedSignalSet directly, which is exactly
// the edge half of the persistence seam under test.
const RUN = `agent-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  return `${RUN}-${local}@example.com`;
}

let server: Server;
let base: string;

const ids = {
  providerOrg: "",
  clientOrg: "",
  tenantA: "",
  tenantB: "",
  owner: "",
  client: "",
};

// The two connectors this suite leans on: salesforce is an edge deployment (runs
// in the agent), redshift is a boundary deployment (runs in our own runtime).
const EDGE_KEY = "salesforce";
const BOUNDARY_KEY = "redshift";
const UNCONNECTED_KEY = "netsuite";

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
  opts: { method?: string; body?: unknown; session?: string | null; token?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session) headers["cookie"] = `ei_session=${opts.session}`;
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
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
  role: "provider-owner" | "client-admin",
  orgId: string,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
}

async function ensureConnectorRow(key: string): Promise<void> {
  const d = getDescriptor(key)!;
  await db
    .insert(connectorsTable)
    .values({
      key: d.key,
      name: d.name,
      family: d.family,
      layers: d.layers,
      authMethod: d.authMethod,
      deployment: d.deployment,
      signalsProduced: d.signalsProduced,
      status: d.status,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  setSecretStore(testStore);

  await ensureConnectorRow(EDGE_KEY);
  await ensureConnectorRow(BOUNDARY_KEY);
  await ensureConnectorRow(UNCONNECTED_KEY);

  const [providerOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN}-provider`, type: "provider" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg!.id;

  const [clientOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN}-client`, type: "client" })
    .returning({ id: orgsTable.id });
  ids.clientOrg = clientOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.client = await seedUser("client", "client-admin", ids.clientOrg);

  const a = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-a`, url: `https://${RUN}-a.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantA = a[0]!.id;

  const b = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-b`, url: `https://${RUN}-b.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantB = b[0]!.id;

  // Tenant A: one connected edge connector (the agent runs it) and one connected
  // boundary connector (our runtime runs it). Config pull must return only the
  // edge one; ingest must accept only the edge one.
  await db.insert(tenantConnectionsTable).values([
    {
      tenantId: ids.tenantA,
      connectorKey: EDGE_KEY,
      status: "connected",
      authRef: "TENANT_A_EDGE_REF",
      scopeConfig: { measures: [] },
      deploymentMode: "edge",
    },
    {
      tenantId: ids.tenantA,
      connectorKey: BOUNDARY_KEY,
      status: "connected",
      authRef: "TENANT_A_BOUNDARY_REF",
      scopeConfig: { measures: [] },
      deploymentMode: "boundary",
    },
  ]);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of [ids.tenantA, ids.tenantB]) {
    if (id) await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
  await db.delete(usersTable).where(like(usersTable.email, `${RUN}-%`));
  for (const id of [ids.providerOrg, ids.clientOrg]) {
    if (id) await db.delete(orgsTable).where(eq(orgsTable.id, id));
  }
});

async function provisionAgent(tenantId: string, session: string, label: string): Promise<string> {
  const r = await api(`/api/tenants/${tenantId}/agents`, {
    method: "POST",
    session,
    body: { label },
  });
  expect(r.status).toBe(201);
  const token = (r.json as { token?: string }).token;
  expect(typeof token).toBe("string");
  return token as string;
}

describe("agent provisioning: provider only, token shown once", () => {
  it("issues a credential to a provider and refuses a non-provider", async () => {
    const ownerSession = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenantA}/agents`, {
      method: "POST",
      session: ownerSession,
      body: { label: "primary" },
    });
    expect(r.status).toBe(201);
    const body = r.json as { agentId: string; token: string };
    // The token is the agent id and a secret joined by a dot. The id half is the
    // public lookup key; the secret half is never stored in clear.
    expect(body.token.startsWith(`${body.agentId}.`)).toBe(true);
    const stored = await db
      .select()
      .from(edgeAgentsTable)
      .where(eq(edgeAgentsTable.id, body.agentId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(body.token.split(".")[1]!);

    const clientSession = await loginSession("client");
    const denied = await api(`/api/tenants/${ids.tenantA}/agents`, {
      method: "POST",
      session: clientSession,
      body: { label: "sneaky" },
    });
    expect(denied.status).toBe(403);
  });
});

describe("agent surface: credential gated", () => {
  it("rejects missing, malformed, wrong and revoked credentials", async () => {
    const noAuth = await api("/api/agent/register", { method: "POST" });
    expect(noAuth.status).toBe(401);

    const malformed = await api("/api/agent/register", { method: "POST", token: "not-a-token" });
    expect(malformed.status).toBe(401);

    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "gate-test");
    const [agentId, secret] = token.split(".");

    const wrongSecret = await api("/api/agent/register", {
      method: "POST",
      token: `${agentId}.${secret}tampered`,
    });
    expect(wrongSecret.status).toBe(401);

    const ok = await api("/api/agent/register", { method: "POST", token });
    expect(ok.status).toBe(200);
    expect((ok.json as { tenantId: string }).tenantId).toBe(ids.tenantA);

    const revoke = await api(`/api/tenants/${ids.tenantA}/agents/${agentId}/revoke`, {
      method: "POST",
      session: ownerSession,
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await api("/api/agent/register", { method: "POST", token });
    expect(afterRevoke.status).toBe(401);
  });
});

describe("agent config pull: tenant scoped, edge only", () => {
  it("returns only the tenant's connected edge connectors", async () => {
    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "config-test");

    const r = await api("/api/agent/config", { token });
    expect(r.status).toBe(200);
    const body = r.json as {
      tenantId: string;
      connectors: { connectorKey: string; deployment: string; authRef: string }[];
    };
    expect(body.tenantId).toBe(ids.tenantA);
    expect(body.connectors).toHaveLength(1);
    expect(body.connectors[0]!.connectorKey).toBe(EDGE_KEY);
    expect(body.connectors[0]!.deployment).toBe("edge");
    // authRef is a pointer the agent resolves locally, never a secret value.
    expect(body.connectors[0]!.authRef).toBe("TENANT_A_EDGE_REF");
    // The boundary connector is never handed to the agent.
    expect(body.connectors.some((c) => c.connectorKey === BOUNDARY_KEY)).toBe(false);
  });
});

describe("agent signal ingest: tenant scoped, derive and discard", () => {
  it("persists a valid edge DerivedSignalSet through the shared path", async () => {
    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "ingest-test");
    const layerCount = getDescriptor(EDGE_KEY)!.layers.length;

    const set = {
      source: EDGE_KEY,
      tenantId: ids.tenantA,
      generatedAt: new Date().toISOString(),
      signals: [
        { key: "pipeline_velocity", kind: "ratio", value: 0.61, window: "P30D", unit: "ratio" },
        { key: "stage_distribution", kind: "distribution", value: [4, 2, 1] },
      ],
    };

    const r = await api("/api/agent/signals", { method: "POST", token, body: set });
    expect(r.status).toBe(202);
    const body = r.json as { signalsCount: number; provenanceRootHash: string; runId: string };
    expect(body.signalsCount).toBe(2);
    expect(body.provenanceRootHash).toBeTruthy();

    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenantA));
    // Two signals fanned across every layer the edge connector feeds; nothing for
    // the boundary connector, which the agent never posts.
    expect(signals).toHaveLength(2 * layerCount);
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(
      new Set(["pipeline_velocity", "stage_distribution"]),
    );
    expect(new Set(signals.map((s) => s.sourceConnectorKey))).toEqual(new Set([EDGE_KEY]));

    const runs = await db
      .select()
      .from(connectorRunsTable)
      .where(eq(connectorRunsTable.id, body.runId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("success");
    expect(runs[0]!.signalsCount).toBe(2);
  });

  it("rejects a set whose tenant is not the agent's tenant", async () => {
    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "mismatch-test");
    const set = {
      source: EDGE_KEY,
      tenantId: ids.tenantB,
      generatedAt: new Date().toISOString(),
      signals: [{ key: "x", kind: "ratio", value: 0.5 }],
    };
    const r = await api("/api/agent/signals", { method: "POST", token, body: set });
    expect(r.status).toBe(403);
    expect((r.json as { error: string }).error).toBe("tenant_mismatch");
  });

  it("rejects raw content loudly, writing nothing", async () => {
    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "raw-test");
    const rawSet = {
      source: EDGE_KEY,
      tenantId: ids.tenantA,
      generatedAt: new Date().toISOString(),
      signals: [{ key: "leaked", kind: "score", value: "person@example.com" }],
    };
    const r = await api("/api/agent/signals", { method: "POST", token, body: rawSet });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("derive_and_discard_violation");
  });

  it("rejects a connector the tenant has not connected as an edge deployment", async () => {
    const ownerSession = await loginSession("owner");
    const token = await provisionAgent(ids.tenantA, ownerSession, "scope-test");

    // A connector with no connection row for this tenant.
    const unconnected = await api("/api/agent/signals", {
      method: "POST",
      token,
      body: {
        source: UNCONNECTED_KEY,
        tenantId: ids.tenantA,
        generatedAt: new Date().toISOString(),
        signals: [{ key: "x", kind: "ratio", value: 0.5 }],
      },
    });
    expect(unconnected.status).toBe(409);
    expect((unconnected.json as { error: string }).error).toBe("no_connected_connection");

    // A connected boundary connector: the agent must not post for it.
    const boundary = await api("/api/agent/signals", {
      method: "POST",
      token,
      body: {
        source: BOUNDARY_KEY,
        tenantId: ids.tenantA,
        generatedAt: new Date().toISOString(),
        signals: [{ key: "x", kind: "ratio", value: 0.5 }],
      },
    });
    expect(boundary.status).toBe(409);
    expect((boundary.json as { error: string }).error).toBe("not_an_edge_connector");
  });
});
