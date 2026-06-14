import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accessGrantsTable,
  db,
  derivedSignalsTable,
  orgsTable,
  orgTenantsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { appendEntry } from "../lib/provenance/ledger";
import { getKmsRuntime } from "../lib/security/kms";
import { encryptSignalValue } from "../lib/security/signalCrypto";
import { ensureActiveTenantKey } from "../lib/security/tenantKeyService";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Tier 3 security surface over HTTP against a real
// Postgres: tenant key lifecycle (owner only), break-glass (no standing access,
// every role gated and logged) and provenance verification. Rows are namespaced
// by a run id and removed afterwards so the suite is self-cleaning.
const RUN = "sectest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
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
const keyRefs: string[] = [];

const ids = {
  providerOrg: "",
  clientOrg: "",
  owner: "",
  member: "",
  outsider: "",
  tenantKeyed: "",
  tenantRevoke: "",
};

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member" | "client-viewer",
  orgId: string | null,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
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

async function provisionWithSignals(
  tenantId: string,
  signals: { layerKey: string; signalKey: string; value: number | number[]; window?: string }[],
): Promise<void> {
  const { kmsKeyRef } = await ensureActiveTenantKey(tenantId);
  keyRefs.push(kmsKeyRef);
  const rows = await Promise.all(
    signals.map(async (s) => ({
      tenantId,
      layerKey: s.layerKey,
      signalKey: s.signalKey,
      value: await encryptSignalValue(s.value, kmsKeyRef),
      window: s.window ?? null,
      sourceConnectorKey: "redshift",
    })),
  );
  await db.insert(derivedSignalsTable).values(rows);
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
  ids.outsider = await seedUser("outsider", "client-viewer", ids.clientOrg);

  const [tk] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Keyed", url: "https://keyed." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  const [tr] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Revoke", url: "https://revoke." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenantKeyed = tk!.id;
  ids.tenantRevoke = tr!.id;

  // The client org (outsider) is bound to NEITHER tenant, so it is fenced out.
  await provisionWithSignals(ids.tenantKeyed, [
    { layerKey: "business-performance", signalKey: "gross_margin_pct", value: 0.42, window: "P30D" },
    { layerKey: "business-performance", signalKey: "status_distribution", value: [3, 5, 2] },
  ]);
  await provisionWithSignals(ids.tenantRevoke, [
    { layerKey: "business-performance", signalKey: "win_rate_pct", value: 0.27 },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    await db.delete(derivedSignalsTable).where(
      inArray(derivedSignalsTable.tenantId, [ids.tenantKeyed, ids.tenantRevoke]),
    );
    // Delete the tenants before the users. access_grants.grantedBy references
    // users with ON DELETE RESTRICT, so the grant rows the break-glass tests
    // create must be cleared first; they cascade off the tenant (tenantId), which
    // releases the restrict and lets the users delete cleanly.
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenantKeyed, ids.tenantRevoke]));
    await db.delete(usersTable).where(like(usersTable.email, EMAIL_PREFIX + "%"));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
    for (const ref of keyRefs) await getKmsRuntime().destroyKey(ref);
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("tenant key lifecycle (owner only)", () => {
  it("requires authentication", async () => {
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/key");
    expect(r.status).toBe(401);
  });

  it("lets the owner read the key status", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/key", { session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ provisioned: true, status: "active" });
    expect((r.json as { kms: { provider: string } }).kms.provider).toBeTruthy();
    // The declared customer-managed KMS seam is surfaced honestly as available but
    // not connected, so the posture view never invents a customer key.
    const customerKms = (r.json as { customerKms: { connected: boolean; detail: string } }).customerKms;
    expect(customerKms.connected).toBe(false);
    expect(customerKms.detail).toContain("available, not connected");
  });

  it("rejects a non-owner from the key surface", async () => {
    const session = await loginSession("member");
    const status = await api("/api/security/tenants/" + ids.tenantKeyed + "/key", { session });
    expect(status.status).toBe(403);
    const provision = await api("/api/security/tenants/" + ids.tenantKeyed + "/key/provision", {
      method: "POST",
      session,
    });
    expect(provision.status).toBe(403);
  });
});

describe("break-glass: no standing access", () => {
  it("denies the owner a raw signal read without a grant", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", { session });
    expect(r.status).toBe(403);
    expect((r.json as { error: string }).error).toBe("break_glass_required");
  });

  it("denies a member a raw signal read without a grant", async () => {
    const session = await loginSession("member");
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", { session });
    expect(r.status).toBe(403);
    expect((r.json as { error: string }).error).toBe("break_glass_required");
  });

  it("fences out a seat with no access to the tenant before break-glass even applies", async () => {
    const session = await loginSession("outsider");
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", { session });
    expect(r.status).toBe(403);
    expect((r.json as { error: string }).error).toBe("forbidden");
  });

  it("enables a read under an owner-approved grant and logs every access", async () => {
    const ownerSession = await loginSession("owner");
    const created = await api("/api/security/tenants/" + ids.tenantKeyed + "/grants", {
      method: "POST",
      session: ownerSession,
      body: { userId: ids.member, reason: "audit review", expiresInMinutes: 60 },
    });
    expect(created.status).toBe(201);
    const grantId = (created.json as { grant: { id: string } }).grant.id;

    const memberSession = await loginSession("member");
    const read = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", {
      session: memberSession,
    });
    expect(read.status).toBe(200);
    const signals = (read.json as { signals: { signalKey: string; value: number | number[] }[] }).signals;
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(
      new Set(["gross_margin_pct", "status_distribution"]),
    );
    expect(signals.find((s) => s.signalKey === "gross_margin_pct")!.value).toBe(0.42);
    expect(signals.find((s) => s.signalKey === "status_distribution")!.value).toEqual([3, 5, 2]);

    // Every access appends an event tied to the grant and the user.
    const events = await api("/api/security/tenants/" + ids.tenantKeyed + "/access-events", {
      session: ownerSession,
    });
    expect(events.status).toBe(200);
    const list = (events.json as { events: { grantId: string; userId: string; action: string }[] }).events;
    expect(list.some((e) => e.grantId === grantId && e.userId === ids.member && e.action === "read_signals")).toBe(true);

    // Revoking the grant ends the access immediately.
    const revoke = await api("/api/security/grants/" + grantId + "/revoke", {
      method: "POST",
      session: ownerSession,
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", {
      session: memberSession,
    });
    expect(afterRevoke.status).toBe(403);
  });

  it("denies a read under an expired grant", async () => {
    const ownerSession = await loginSession("owner");
    const created = await api("/api/security/tenants/" + ids.tenantKeyed + "/grants", {
      method: "POST",
      session: ownerSession,
      body: { userId: ids.member, reason: "expiry case", expiresInMinutes: 60 },
    });
    const grantId = (created.json as { grant: { id: string } }).grant.id;
    // Force the grant into the past: an expired grant is no access.
    await db
      .update(accessGrantsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(accessGrantsTable.id, grantId));

    const memberSession = await loginSession("member");
    const r = await api("/api/security/tenants/" + ids.tenantKeyed + "/signals", {
      session: memberSession,
    });
    expect(r.status).toBe(403);
  });
});

describe("provenance verify (owner only)", () => {
  it("verifies the tenant chain for the owner and rejects a non-owner", async () => {
    await appendEntry({
      tenantId: ids.tenantKeyed,
      claimPath: "business-performance.margin",
      sourceRef: "verified:https://example.com/a",
    });
    await appendEntry({
      tenantId: ids.tenantKeyed,
      claimPath: "business-performance.win",
      sourceRef: "modelled:(none)",
    });

    const ownerSession = await loginSession("owner");
    const ok = await api("/api/security/tenants/" + ids.tenantKeyed + "/provenance/verify", {
      session: ownerSession,
    });
    expect(ok.status).toBe(200);
    expect((ok.json as { ok: boolean }).ok).toBe(true);

    const memberSession = await loginSession("member");
    const denied = await api("/api/security/tenants/" + ids.tenantKeyed + "/provenance/verify", {
      session: memberSession,
    });
    expect(denied.status).toBe(403);
  });
});

describe("crypto-shred via key revoke", () => {
  it("revokes the key and makes the raw signals unreadable even under a grant", async () => {
    const ownerSession = await loginSession("owner");
    const revoke = await api("/api/security/tenants/" + ids.tenantRevoke + "/key/revoke", {
      method: "POST",
      session: ownerSession,
    });
    expect(revoke.status).toBe(200);
    expect((revoke.json as { status: string }).status).toBe("revoked");

    // Status now reads revoked.
    const status = await api("/api/security/tenants/" + ids.tenantRevoke + "/key", {
      session: ownerSession,
    });
    expect((status.json as { status: string }).status).toBe("revoked");

    // A grant cannot resurrect crypto-shredded data: the read fails loud.
    await api("/api/security/tenants/" + ids.tenantRevoke + "/grants", {
      method: "POST",
      session: ownerSession,
      body: { userId: ids.member, reason: "post-shred", expiresInMinutes: 60 },
    });
    const memberSession = await loginSession("member");
    const read = await api("/api/security/tenants/" + ids.tenantRevoke + "/signals", {
      session: memberSession,
    });
    expect(read.status).toBe(409);
    expect((read.json as { error: string }).error).toBe("crypto_shredded");
  });
});
