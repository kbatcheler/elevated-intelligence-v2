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

// End-to-end exercise of the auth and access surface against a real Postgres,
// driven over HTTP through a throwaway listener. No supertest: a plain
// app.listen(0) plus fetch keeps the dependency footprint at zero. All rows are
// namespaced by a unique run id and deleted afterwards so the suite is
// self-cleaning and safe to run repeatedly against the dev database.
const RUN = `dtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  disabled: "",
};

async function seedUser(
  local: string,
  role: "provider-owner" | "provider-member" | "client-admin" | "client-viewer",
  orgId: string | null,
  status: "active" | "disabled" = "active",
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status, orgId })
    .returning({ id: usersTable.id });
  return inserted[0].id;
}

async function seedPin(opts: {
  expiresAt?: Date;
  revokedAt?: Date | null;
  maxUses?: number;
  useCount?: number;
  scopeOrgId?: string | null;
  scopeRole?: "provider-member" | "client-admin" | "client-viewer" | null;
}): Promise<string> {
  const code = generatePinCode();
  const codeHash = hashPinCode(canonicalizePinCode(code)!, SECRET);
  await db.insert(invitePinsTable).values({
    codeHash,
    label: RUN,
    maxUses: opts.maxUses ?? 1,
    useCount: opts.useCount ?? 0,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: opts.revokedAt ?? null,
    createdBy: ids.owner,
    scopeOrgId: opts.scopeOrgId ?? null,
    scopeRole: opts.scopeRole ?? null,
  });
  return code;
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
  ids.disabled = await seedUser("disabled", "provider-member", ids.providerOrg, "disabled");

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  try {
    await db.delete(orgTenantsTable).where(
      inArray(orgTenantsTable.orgId, [ids.clientOrg, ids.portfolioOrg, ids.providerOrg]),
    );
    await db.delete(invitePinsTable).where(like(invitePinsTable.label, `${RUN}%`));
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

describe("auth status and login", () => {
  it("reports unauthenticated without a cookie", async () => {
    const r = await api("/api/auth/status");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ authenticated: false });
  });

  it("logs in the owner and reports the session", async () => {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: { email: email("owner"), password: PASSWORD },
    });
    expect(r.status).toBe(200);
    const status = await api("/api/auth/status", { session: r.session });
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({
      authenticated: true,
      user: { role: "provider-owner", email: email("owner") },
    });
  });

  it("rejects a wrong password with a generic error", async () => {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: { email: email("owner"), password: "wrong-password" },
    });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: "invalid_credentials" });
  });

  it("rejects an unknown email with the same generic error", async () => {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: { email: email("nobody"), password: PASSWORD },
    });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a disabled account at login", async () => {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: { email: email("disabled"), password: PASSWORD },
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "account_disabled" });
  });
});

describe("registration and the four PIN failure modes", () => {
  it("registers a member with a valid minted PIN, then rejects reuse as used-up", async () => {
    const ownerSession = await loginSession("owner");
    const mint = await api("/api/admin/pins", {
      method: "POST",
      body: { label: `${RUN} mint`, maxUses: 1 },
      session: ownerSession,
    });
    expect(mint.status).toBe(201);
    const code = (mint.json as { pin: { code: string } }).pin.code;
    expect(typeof code).toBe("string");

    const ok = await api("/api/auth/register", {
      method: "POST",
      body: { email: email("fresh-1"), displayName: "Fresh One", password: PASSWORD, pin: code },
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ user: { role: "provider-member", email: email("fresh-1") } });

    const reuse = await api("/api/auth/register", {
      method: "POST",
      body: { email: email("fresh-2"), displayName: "Fresh Two", password: PASSWORD, pin: code },
    });
    expect(reuse.status).toBe(403);
    expect(reuse.json).toEqual({ error: "invalid_or_used_pin" });
  });

  it("returns one byte-identical error for wrong, expired, revoked and used-up PINs", async () => {
    const expiredCode = await seedPin({ expiresAt: new Date(Date.now() - 1000) });
    const revokedCode = await seedPin({ revokedAt: new Date() });
    const usedUpCode = await seedPin({ maxUses: 1, useCount: 1 });
    const wrongCode = generatePinCode(); // never inserted

    const attempts = await Promise.all(
      [expiredCode, revokedCode, usedUpCode, wrongCode].map((pin, i) =>
        api("/api/auth/register", {
          method: "POST",
          body: {
            email: email(`pinfail-${i}`),
            displayName: "Pin Fail",
            password: PASSWORD,
            pin,
          },
        }),
      ),
    );

    for (const a of attempts) {
      expect(a.status).toBe(403);
      expect(a.json).toEqual({ error: "invalid_or_used_pin" });
    }
    // All four responses are indistinguishable.
    const serialized = attempts.map((a) => `${a.status}:${JSON.stringify(a.json)}`);
    expect(new Set(serialized).size).toBe(1);
  });

  it("honours a scoped PIN by placing the user in the scoped org and role", async () => {
    const scopedCode = await seedPin({
      scopeOrgId: ids.clientOrg,
      scopeRole: "client-viewer",
    });
    const r = await api("/api/auth/register", {
      method: "POST",
      body: {
        email: email("scoped"),
        displayName: "Scoped",
        password: PASSWORD,
        pin: scopedCode,
      },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      user: { role: "client-viewer", orgId: ids.clientOrg, email: email("scoped") },
    });
  });
});

describe("owner gate on the admin surface", () => {
  it("forbids a provider-member from the Access console", async () => {
    const memberSession = await loginSession("member");
    const users = await api("/api/admin/users", { session: memberSession });
    expect(users.status).toBe(403);
    expect(users.json).toEqual({ error: "forbidden" });

    const mint = await api("/api/admin/pins", {
      method: "POST",
      body: { maxUses: 1 },
      session: memberSession,
    });
    expect(mint.status).toBe(403);
  });

  it("requires a session for the admin surface at all", async () => {
    const r = await api("/api/admin/users");
    expect(r.status).toBe(401);
  });
});

describe("tenant fencing", () => {
  it("requires authentication for tenant routes", async () => {
    const r = await api(`/api/tenants/${ids.tenantA}`);
    expect(r.status).toBe(401);
  });

  it("lets a provider-member see any tenant", async () => {
    const memberSession = await loginSession("member");
    const a = await api(`/api/tenants/${ids.tenantA}`, { session: memberSession });
    const b = await api(`/api/tenants/${ids.tenantB}`, { session: memberSession });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("fences a client-viewer to its bound tenant only", async () => {
    const session = await loginSession("client-viewer");
    const a = await api(`/api/tenants/${ids.tenantA}`, { session });
    const b = await api(`/api/tenants/${ids.tenantB}`, { session });
    expect(a.status).toBe(200);
    expect(b.status).toBe(403);
    expect(b.json).toEqual({ error: "forbidden" });
  });

  it("lets a portfolio user see its whole bound set", async () => {
    const session = await loginSession("portfolio-user");
    const a = await api(`/api/tenants/${ids.tenantA}`, { session });
    const b = await api(`/api/tenants/${ids.tenantB}`, { session });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe("disable takes effect on a live session", () => {
  it("rejects a still-valid cookie the moment the account is disabled", async () => {
    // A fresh provider-member who can reach tenant routes while active.
    const victimId = await seedUser("victim", "provider-member", ids.providerOrg);
    const session = await loginSession("victim");

    const before = await api(`/api/tenants/${ids.tenantA}`, { session });
    expect(before.status).toBe(200);

    const ownerSession = await loginSession("owner");
    const disable = await api(`/api/admin/users/${victimId}/disable`, {
      method: "POST",
      session: ownerSession,
    });
    expect(disable.status).toBe(200);

    // Same cookie, now rejected, without waiting for the cookie to expire.
    const after = await api(`/api/tenants/${ids.tenantA}`, { session });
    expect(after.status).toBe(401);
    const status = await api("/api/auth/status", { session });
    expect(status.json).toEqual({ authenticated: false });
  });
});

describe("disable guards", () => {
  it("refuses to let an owner disable their own account", async () => {
    const ownerSession = await loginSession("owner");
    const r = await api(`/api/admin/users/${ids.owner}/disable`, {
      method: "POST",
      session: ownerSession,
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "cannot_disable_self" });
  });

  it("can disable and then re-enable a member", async () => {
    const ownerSession = await loginSession("owner");
    const disable = await api(`/api/admin/users/${ids.member}/disable`, {
      method: "POST",
      session: ownerSession,
    });
    expect(disable.status).toBe(200);
    const enable = await api(`/api/admin/users/${ids.member}/enable`, {
      method: "POST",
      session: ownerSession,
    });
    expect(enable.status).toBe(200);
    // The member can log in again after re-enable.
    await loginSession("member");
  });
});
