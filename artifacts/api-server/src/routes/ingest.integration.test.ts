import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  ingestionKeysTable,
  orgsTable,
  provenanceLedgerTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the public Ingestion API and its admin console routes
// against a real Postgres, driven over HTTP through a throwaway listener. It
// proves the AE acceptance points for path (1): per-tenant keys are hashed and
// revocable, the surface is key gated, a valid post lands as encrypted derived
// math with a provenance entry tagged by the ingestion method, and a post of raw
// content is refused with nothing written. Rows are namespaced by a unique run id
// and removed afterwards, so the suite is self-cleaning.
const RUN = `ingest-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const LAYER = `${RUN}-layer`;
const SENTINEL = `RAW-SENTINEL-${RUN}@example.com`;

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

const ids = { providerOrg: "", clientOrg: "", tenant: "", owner: "", client: "" };

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

async function mintKey(session: string, label: string): Promise<{ keyId: string; token: string }> {
  const r = await api(`/api/tenants/${ids.tenant}/ingestion-keys`, {
    method: "POST",
    session,
    body: { label },
  });
  expect(r.status).toBe(201);
  const body = r.json as { keyId: string; token: string };
  return body;
}

beforeAll(async () => {
  setSecretStore(testStore);

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

  const t = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-t`, url: `https://${RUN}-t.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = t[0]!.id;

  // A self-cleaning test layer so ingestion's layer validation has a real,
  // enabled registry row to resolve without depending on the seed.
  const { layersTable } = await import("@workspace/db");
  await db.insert(layersTable).values({
    key: LAYER,
    name: "Ingest Test Layer",
    description: "ephemeral test layer",
    archetype: "Performance scorecard",
    heroDescription: "test",
    ownerPersona: "test",
    diagnosticQuestion: "is this layer real",
    metricDefinitions: { tiles: [] },
    rootCauses: [],
    actions: [],
    gaps: { items: [], closedBy: "test" },
    feeds: [],
    moduleGroup: "test",
    isCanonical: false,
    sortOrder: 9999,
  });

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
  if (ids.tenant) await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  const { layersTable } = await import("@workspace/db");
  await db.delete(layersTable).where(eq(layersTable.key, LAYER));
  await db.delete(usersTable).where(like(usersTable.email, `${RUN}-%`));
  for (const id of [ids.providerOrg, ids.clientOrg]) {
    if (id) await db.delete(orgsTable).where(eq(orgsTable.id, id));
  }
});

describe("ingestion key minting: provider only, token shown once", () => {
  it("issues a key to a provider and refuses a non-provider", async () => {
    const ownerSession = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenant}/ingestion-keys`, {
      method: "POST",
      session: ownerSession,
      body: { label: "primary" },
    });
    expect(r.status).toBe(201);
    const body = r.json as { keyId: string; token: string };
    expect(body.token.startsWith(`${body.keyId}.`)).toBe(true);
    // Only the scrypt hash is stored; the secret half never appears in the row.
    const stored = await db
      .select()
      .from(ingestionKeysTable)
      .where(eq(ingestionKeysTable.id, body.keyId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(body.token.split(".")[1]!);

    const clientSession = await loginSession("client");
    const denied = await api(`/api/tenants/${ids.tenant}/ingestion-keys`, {
      method: "POST",
      session: clientSession,
      body: { label: "sneaky" },
    });
    expect(denied.status).toBe(403);
  });
});

describe("ingestion API: key gated and revocable", () => {
  it("rejects missing, malformed, wrong and revoked keys", async () => {
    const noAuth = await api("/v1/ingest", { method: "POST", body: { layer: LAYER, signals: [] } });
    expect(noAuth.status).toBe(401);

    const malformed = await api("/v1/ingest", {
      method: "POST",
      token: "not-a-token",
      body: { layer: LAYER, signals: [] },
    });
    expect(malformed.status).toBe(401);

    const ownerSession = await loginSession("owner");
    const { keyId, token } = await mintKey(ownerSession, "gate-test");
    const secret = token.split(".")[1]!;

    const wrong = await api("/v1/ingest", {
      method: "POST",
      token: `${keyId}.${secret}tampered`,
      body: { layer: LAYER, signals: [{ key: "x", kind: "ratio", value: 0.5 }] },
    });
    expect(wrong.status).toBe(401);

    const ok = await api("/v1/ingest", {
      method: "POST",
      token,
      body: { layer: LAYER, signals: [{ key: "x", kind: "ratio", value: 0.5 }] },
    });
    expect(ok.status).toBe(202);

    const revoke = await api(`/api/tenants/${ids.tenant}/ingestion-keys/${keyId}/revoke`, {
      method: "POST",
      session: ownerSession,
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await api("/v1/ingest", {
      method: "POST",
      token,
      body: { layer: LAYER, signals: [{ key: "x", kind: "ratio", value: 0.5 }] },
    });
    expect(afterRevoke.status).toBe(401);
  });
});

describe("ingestion API: derive and discard", () => {
  it("persists numeric signals as encrypted math with a provenance entry", async () => {
    const ownerSession = await loginSession("owner");
    const { token } = await mintKey(ownerSession, "ingest-test");

    const r = await api("/v1/ingest", {
      method: "POST",
      token,
      body: {
        layer: LAYER,
        signals: [
          { key: "gross_margin_pct", kind: "ratio", value: 0.42, window: "P30D", unit: "ratio" },
          { key: "stage_distribution", kind: "distribution", value: [4, 2, 1] },
        ],
      },
    });
    expect(r.status).toBe(202);
    const body = r.json as { accepted: boolean; rootHash: string; signalsCount: number };
    expect(body.accepted).toBe(true);
    expect(body.rootHash).toBeTruthy();
    expect(body.signalsCount).toBe(2);

    const source = `ingest:api:${LAYER}`;
    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, source));
    expect(signals).toHaveLength(2);
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(
      new Set(["gross_margin_pct", "stage_distribution"]),
    );
    // The value is sealed: an encryption envelope, never the plaintext number.
    for (const s of signals) {
      const v = s.value as Record<string, unknown>;
      expect(typeof v).toBe("object");
      expect(v.ct).toBeTruthy();
      expect(v.alg).toBe("AES-256-GCM");
    }

    // Provenance recorded the ingestion method in the claim path, anchored to the
    // derived root hash, never to a raw artifact.
    const prov = await db
      .select()
      .from(provenanceLedgerTable)
      .where(eq(provenanceLedgerTable.tenantId, ids.tenant));
    expect(prov.some((p) => p.claimPath === `ingestion:api:${LAYER}`)).toBe(true);
    expect(prov.some((p) => p.sourceRef === body.rootHash)).toBe(true);
  });

  it("refuses raw content loudly and writes nothing", async () => {
    const ownerSession = await loginSession("owner");
    const { token } = await mintKey(ownerSession, "raw-test");

    const r = await api("/v1/ingest", {
      method: "POST",
      token,
      body: {
        layer: LAYER,
        signals: [{ key: "leaked", kind: "score", value: SENTINEL }],
      },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("invalid_signals");

    // The sentinel never reached the store under this feed's namespace.
    const source = `ingest:api:${LAYER}`;
    const after = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, source));
    expect(after.every((s) => JSON.stringify(s.value).indexOf(SENTINEL) === -1)).toBe(true);
  });

  it("rejects an unknown layer", async () => {
    const ownerSession = await loginSession("owner");
    const { token } = await mintKey(ownerSession, "layer-test");
    const r = await api("/v1/ingest", {
      method: "POST",
      token,
      body: { layer: `${RUN}-nope`, signals: [{ key: "x", kind: "ratio", value: 0.5 }] },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("unknown_layer");
  });
});

describe("ingestion API: public contract", () => {
  it("serves its OpenAPI document without a key", async () => {
    const r = await api("/v1/ingest/openapi.json");
    expect(r.status).toBe(200);
    const doc = r.json as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/"]).toBeTruthy();
  });
});
