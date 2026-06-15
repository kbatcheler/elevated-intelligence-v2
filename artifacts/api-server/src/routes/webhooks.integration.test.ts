import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  orgsTable,
  provenanceLedgerTable,
  tenantsTable,
  usersTable,
  webhookSourcesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the inbound webhook receiver against a real Postgres.
// It proves the AE acceptance points for path (2): a per-source signing secret is
// minted once and sealed (never stored plaintext), a delivery is accepted only
// when its HMAC over the raw body verifies, a tampered or unsigned delivery is
// refused, a revoked source stops accepting, and an accepted delivery lands as
// encrypted derived math with a provenance entry tagged webhook. Self-cleaning.
const RUN = `webhook-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

// A signed webhook delivery: the signature is computed over the exact bytes sent,
// the same bytes the receiver recovers as the raw body. An optional override lets
// a test sign a different payload than it sends, to prove tamper detection.
async function deliver(
  sourceId: string,
  body: unknown,
  secret: string,
  opts: { signOver?: string; signature?: string } = {},
): Promise<ApiResult> {
  const payload = JSON.stringify(body);
  const signed = opts.signOver ?? payload;
  const signature =
    opts.signature ?? "sha256=" + createHmac("sha256", secret).update(signed).digest("hex");
  const res = await fetch(base + "/api/webhooks/" + sourceId, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ei-signature": signature },
    body: payload,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, session: null };
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

async function mintSource(
  session: string,
  label: string,
): Promise<{ sourceId: string; signingSecret: string }> {
  const r = await api(`/api/tenants/${ids.tenant}/webhook-sources`, {
    method: "POST",
    session,
    body: { label, targetLayer: LAYER },
  });
  expect(r.status).toBe(201);
  return r.json as { sourceId: string; signingSecret: string };
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

  const { layersTable } = await import("@workspace/db");
  await db.insert(layersTable).values({
    key: LAYER,
    name: "Webhook Test Layer",
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

describe("webhook source minting: provider only, secret sealed and shown once", () => {
  it("mints for a provider, seals the secret, refuses a non-provider", async () => {
    const ownerSession = await loginSession("owner");
    const { sourceId, signingSecret } = await mintSource(ownerSession, "primary");
    expect(signingSecret.length).toBeGreaterThan(20);

    // The stored secret is ciphertext, never the plaintext that was returned.
    const stored = await db
      .select()
      .from(webhookSourcesTable)
      .where(eq(webhookSourcesTable.id, sourceId));
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0]!.signingSecretCipher)).not.toContain(signingSecret);

    const clientSession = await loginSession("client");
    const denied = await api(`/api/tenants/${ids.tenant}/webhook-sources`, {
      method: "POST",
      session: clientSession,
      body: { label: "sneaky", targetLayer: LAYER },
    });
    expect(denied.status).toBe(403);
  });
});

describe("webhook delivery: HMAC gated, derive and discard", () => {
  it("accepts a correctly signed delivery and persists encrypted math + provenance", async () => {
    const ownerSession = await loginSession("owner");
    const { sourceId, signingSecret } = await mintSource(ownerSession, "deliver-test");

    const r = await deliver(
      sourceId,
      {
        signals: [
          { key: "events_per_min", kind: "aggregate", value: 17.5, window: "PT1M" },
          { key: "error_ratio", kind: "ratio", value: 0.02 },
        ],
      },
      signingSecret,
    );
    expect(r.status).toBe(202);
    const body = r.json as { accepted: boolean; rootHash: string; signalsCount: number };
    expect(body.accepted).toBe(true);
    expect(body.signalsCount).toBe(2);

    const source = `ingest:webhook:${sourceId}`;
    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, source));
    expect(signals).toHaveLength(2);
    for (const s of signals) {
      const v = s.value as Record<string, unknown>;
      expect(v.ct).toBeTruthy();
      expect(v.alg).toBe("AES-256-GCM");
    }

    const prov = await db
      .select()
      .from(provenanceLedgerTable)
      .where(eq(provenanceLedgerTable.tenantId, ids.tenant));
    expect(prov.some((p) => p.claimPath === `ingestion:webhook:${LAYER}`)).toBe(true);
    expect(prov.some((p) => p.sourceRef === body.rootHash)).toBe(true);
  });

  it("rejects an unsigned, a wrong, and a tampered delivery", async () => {
    const ownerSession = await loginSession("owner");
    const { sourceId, signingSecret } = await mintSource(ownerSession, "sig-test");
    const payload = { signals: [{ key: "x", kind: "ratio", value: 0.5 }] };

    // No signature header.
    const unsigned = await fetch(base + "/api/webhooks/" + sourceId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(unsigned.status).toBe(401);

    // Signed with the wrong secret.
    const wrong = await deliver(sourceId, payload, "not-the-secret");
    expect(wrong.status).toBe(401);

    // Signature computed over a different body than the one sent.
    const tampered = await deliver(sourceId, payload, signingSecret, {
      signOver: JSON.stringify({ signals: [{ key: "y", kind: "ratio", value: 0.9 }] }),
    });
    expect(tampered.status).toBe(401);
  });

  it("stops accepting once the source is revoked", async () => {
    const ownerSession = await loginSession("owner");
    const { sourceId, signingSecret } = await mintSource(ownerSession, "revoke-test");
    const payload = { signals: [{ key: "x", kind: "ratio", value: 0.5 }] };

    const ok = await deliver(sourceId, payload, signingSecret);
    expect(ok.status).toBe(202);

    const revoke = await api(`/api/tenants/${ids.tenant}/webhook-sources/${sourceId}/revoke`, {
      method: "POST",
      session: ownerSession,
    });
    expect(revoke.status).toBe(200);

    const after = await deliver(sourceId, payload, signingSecret);
    expect(after.status).toBe(404);
  });

  it("refuses raw content even when correctly signed, writing nothing", async () => {
    const ownerSession = await loginSession("owner");
    const { sourceId, signingSecret } = await mintSource(ownerSession, "raw-test");

    const r = await deliver(
      sourceId,
      { signals: [{ key: "leaked", kind: "score", value: SENTINEL }] },
      signingSecret,
    );
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("invalid_signals");

    const source = `ingest:webhook:${sourceId}`;
    const after = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, source));
    expect(after.every((s) => JSON.stringify(s.value).indexOf(SENTINEL) === -1)).toBe(true);
  });
});
