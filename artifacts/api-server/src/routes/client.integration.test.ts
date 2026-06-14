import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  invitePinsTable,
  orgsTable,
  orgTenantsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { canonicalizePinCode, generatePinCode, hashPinCode } from "../lib/auth/pin";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the client-admin onboarding surface against a real
// Postgres, over HTTP through a throwaway listener. Same self-cleaning harness as
// the auth suite: every row is namespaced by a unique run id and deleted
// afterwards, so the suite is safe to run repeatedly against the dev database.
const RUN = `ctest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  otherClientOrg: "",
  tenantA: "",
  tenantB: "",
  owner: "",
  member: "",
  clientAdmin: "",
  otherClientAdmin: "",
  clientViewer: "",
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

async function seedPin(opts: {
  scopeOrgId: string | null;
  scopeRole: "provider-member" | "client-admin" | "client-viewer" | null;
}): Promise<{ id: string; code: string }> {
  const code = generatePinCode();
  const codeHash = hashPinCode(canonicalizePinCode(code)!, SECRET);
  const inserted = await db
    .insert(invitePinsTable)
    .values({
      codeHash,
      label: RUN,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdBy: ids.owner,
      scopeOrgId: opts.scopeOrgId,
      scopeRole: opts.scopeRole,
    })
    .returning({ id: invitePinsTable.id });
  return { id: inserted[0].id, code };
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
  const [otherClientOrg] = await db
    .insert(orgsTable)
    .values({ name: `${RUN} Other Client`, type: "client" })
    .returning({ id: orgsTable.id });
  ids.providerOrg = providerOrg.id;
  ids.clientOrg = clientOrg.id;
  ids.otherClientOrg = otherClientOrg.id;

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

  // The client org sees tenant A; the other client org sees tenant B.
  await db.insert(orgTenantsTable).values([
    { orgId: ids.clientOrg, tenantId: ids.tenantA },
    { orgId: ids.otherClientOrg, tenantId: ids.tenantB },
  ]);

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.member = await seedUser("member", "provider-member", ids.providerOrg);
  ids.clientAdmin = await seedUser("client-admin", "client-admin", ids.clientOrg);
  ids.otherClientAdmin = await seedUser("other-admin", "client-admin", ids.otherClientOrg);
  ids.clientViewer = await seedUser("client-viewer", "client-viewer", ids.clientOrg);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    await db.delete(orgTenantsTable).where(
      inArray(orgTenantsTable.orgId, [ids.clientOrg, ids.otherClientOrg]),
    );
    await db.delete(invitePinsTable).where(like(invitePinsTable.label, `${RUN}%`));
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenantA, ids.tenantB]));
    await db.delete(orgsTable).where(
      inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg, ids.otherClientOrg]),
    );
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("the client onboarding router refuses everyone but a client-admin", () => {
  it("requires a session at all", async () => {
    const r = await api("/api/client/viewer-pins");
    expect(r.status).toBe(401);
  });

  it("forbids a provider-owner", async () => {
    const session = await loginSession("owner");
    const r = await api("/api/client/viewer-pins", { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("forbids a provider-member", async () => {
    const session = await loginSession("member");
    const r = await api("/api/client/viewer-pins", { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });

  it("forbids a client-viewer", async () => {
    const session = await loginSession("client-viewer");
    const r = await api("/api/client/viewer-pins", { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });
});

describe("a client-admin mints viewer invites into their own org only", () => {
  it("mints a viewer PIN scoped to the admin's own org and the viewer role", async () => {
    const session = await loginSession("client-admin");
    const r = await api("/api/client/viewer-pins", {
      method: "POST",
      body: { label: `${RUN} team viewer`, maxUses: 1, expiresInDays: 14 },
      session,
    });
    expect(r.status).toBe(201);
    const pin = (r.json as { pin: { code: string; scopeRole: string; scopeOrgId: string } }).pin;
    expect(typeof pin.code).toBe("string");
    expect(pin.scopeRole).toBe("client-viewer");
    expect(pin.scopeOrgId).toBe(ids.clientOrg);

    // The minted code self-registers a client-viewer into the admin's own org.
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: { email: email("invited"), displayName: "Invited", password: PASSWORD, pin: pin.code },
    });
    expect(reg.status).toBe(201);
    expect(reg.json).toMatchObject({
      user: { role: "client-viewer", orgId: ids.clientOrg, email: email("invited") },
    });
  });

  it("accepts an explicit scope that matches the forced own-org viewer scope", async () => {
    const session = await loginSession("client-admin");
    const r = await api("/api/client/viewer-pins", {
      method: "POST",
      body: { label: `${RUN} explicit`, scopeRole: "client-viewer", scopeOrgId: ids.clientOrg },
      session,
    });
    expect(r.status).toBe(201);
  });

  it("rejects a role-widening attempt loudly", async () => {
    const session = await loginSession("client-admin");
    const r = await api("/api/client/viewer-pins", {
      method: "POST",
      body: { scopeRole: "client-admin" },
      session,
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "scope_role_forbidden" });
  });

  it("rejects an org-widening attempt loudly", async () => {
    const session = await loginSession("client-admin");
    const r = await api("/api/client/viewer-pins", {
      method: "POST",
      body: { scopeOrgId: ids.otherClientOrg },
      session,
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "scope_org_forbidden" });
  });
});

describe("listing is fenced to the admin's own org viewer invites", () => {
  it("returns only own-org viewer PINs, not other orgs or other roles", async () => {
    await seedPin({ scopeOrgId: ids.clientOrg, scopeRole: "client-viewer" });
    await seedPin({ scopeOrgId: ids.otherClientOrg, scopeRole: "client-viewer" });
    await seedPin({ scopeOrgId: ids.clientOrg, scopeRole: "client-admin" });

    const session = await loginSession("client-admin");
    const r = await api("/api/client/viewer-pins", { session });
    expect(r.status).toBe(200);
    const pins = (r.json as { pins: { scopeOrgId: string; scopeRole: string }[] }).pins;
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) {
      expect(p.scopeOrgId).toBe(ids.clientOrg);
      expect(p.scopeRole).toBe("client-viewer");
    }
  });
});

describe("revoke is fenced to the admin's own org viewer invites", () => {
  it("revokes an own-org viewer PIN", async () => {
    const seeded = await seedPin({ scopeOrgId: ids.clientOrg, scopeRole: "client-viewer" });
    const session = await loginSession("client-admin");
    const r = await api(`/api/client/viewer-pins/${seeded.id}/revoke`, { method: "POST", session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });

    const list = await api("/api/client/viewer-pins", { session });
    const found = (list.json as { pins: { id: string; state: string }[] }).pins.find(
      (p) => p.id === seeded.id,
    );
    expect(found?.state).toBe("revoked");
  });

  it("returns 404 for a viewer PIN in another org", async () => {
    const seeded = await seedPin({ scopeOrgId: ids.otherClientOrg, scopeRole: "client-viewer" });
    const session = await loginSession("client-admin");
    const r = await api(`/api/client/viewer-pins/${seeded.id}/revoke`, { method: "POST", session });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "not_found" });
  });

  it("returns 404 for a non-viewer PIN in the admin's own org", async () => {
    const seeded = await seedPin({ scopeOrgId: ids.clientOrg, scopeRole: "client-admin" });
    const session = await loginSession("client-admin");
    const r = await api(`/api/client/viewer-pins/${seeded.id}/revoke`, { method: "POST", session });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "not_found" });
  });
});

describe("a client seat never reaches the provider side", () => {
  it("forbids a client-admin from the owner-gated admin, spend and operations surfaces", async () => {
    const session = await loginSession("client-admin");
    const admin = await api("/api/admin/users", { session });
    expect(admin.status).toBe(403);
    const spend = await api("/api/spend", { session });
    expect(spend.status).toBe(403);
    const operations = await api("/api/operations", { session });
    expect(operations.status).toBe(403);
  });

  it("forbids a bound client-viewer from the break-glass signal read", async () => {
    // The client org is bound to tenant A, so tenant fencing passes; the
    // provider-only gate on the signal read is what refuses the client seat,
    // with no grant and no KMS in play.
    const session = await loginSession("client-viewer");
    const r = await api(`/api/security/tenants/${ids.tenantA}/signals`, { session });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });
});
