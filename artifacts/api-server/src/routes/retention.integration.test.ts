import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  orgsTable,
  retentionEventsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { verifyChain } from "../lib/provenance/ledger";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the retention surface over HTTP against a real
// Postgres: erasure is owner-only, token-scoped erasure is rejected as
// unsupported, an erasure removes the tenant's signals and appends a redaction
// without breaking the chain, and the audit is readable. Rows are namespaced by
// a run id and removed afterwards so the suite is self-cleaning.
const RUN = "retroute-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
const EMAIL_PREFIX = RUN + "-";
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const MISSING_TENANT = "00000000-0000-0000-0000-000000000000";

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

const ids = {
  providerOrg: "",
  clientOrg: "",
  owner: "",
  member: "",
  outsider: "",
  tenant: "",
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
  ids.outsider = await seedUser("outsider", "client-viewer", ids.clientOrg);

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: RUN + " Tenant", url: "https://t." + RUN + ".example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant!.id;

  await db.insert(derivedSignalsTable).values([
    {
      tenantId: ids.tenant,
      layerKey: "business-performance",
      signalKey: "a",
      value: 0.5,
      sourceConnectorKey: "redshift",
      provenanceRef: "rootA",
    },
    {
      tenantId: ids.tenant,
      layerKey: "business-performance",
      signalKey: "b",
      value: 0.6,
      sourceConnectorKey: "redshift",
      provenanceRef: "rootB",
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    await db.delete(retentionEventsTable).where(eq(retentionEventsTable.tenantId, ids.tenant));
    // derived_signals and provenance_ledger cascade off the tenant.
    await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
    await db.delete(usersTable).where(like(usersTable.email, EMAIL_PREFIX + "%"));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

const erasePath = (id: string): string => "/api/retention/tenants/" + id + "/derived-signals";
const eventsPath = (id: string): string => "/api/retention/tenants/" + id + "/events";

describe("retention erasure route", () => {
  it("rejects an unauthenticated erasure", async () => {
    const r = await api(erasePath(ids.tenant), { method: "DELETE" });
    expect(r.status).toBe(401);
  });

  it("forbids a non-owner provider member", async () => {
    const member = await loginSession("member");
    const r = await api(erasePath(ids.tenant), { method: "DELETE", session: member });
    expect(r.status).toBe(403);
  });

  it("forbids a client seat", async () => {
    const outsider = await loginSession("outsider");
    const r = await api(erasePath(ids.tenant), { method: "DELETE", session: outsider });
    expect(r.status).toBe(403);
  });

  it("rejects a token-scoped erasure as unsupported for aggregate signals", async () => {
    const owner = await loginSession("owner");
    const r = await api(erasePath(ids.tenant), {
      method: "DELETE",
      session: owner,
      body: { tokenRef: "tok_123" },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe(
      "token_erasure_not_supported_for_aggregate_signals",
    );
    // Nothing was erased by the rejected request.
    const rows = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenant));
    expect(rows).toHaveLength(2);
  });

  it("returns 404 for an unknown tenant", async () => {
    const owner = await loginSession("owner");
    const r = await api(erasePath(MISSING_TENANT), { method: "DELETE", session: owner });
    expect(r.status).toBe(404);
  });

  it("erases the tenant's signals, appends a redaction, and audits the owner", async () => {
    const owner = await loginSession("owner");
    const r = await api(erasePath(ids.tenant), { method: "DELETE", session: owner });
    expect(r.status).toBe(200);
    const body = r.json as { deletedCount: number; redactionLedgerEntryId: string };
    expect(body.deletedCount).toBe(2);
    expect(body.redactionLedgerEntryId).toBeTruthy();

    const rows = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenant));
    expect(rows).toHaveLength(0);

    const verify = await verifyChain(ids.tenant);
    expect(verify.ok).toBe(true);

    const audit = await db
      .select()
      .from(retentionEventsTable)
      .where(eq(retentionEventsTable.tenantId, ids.tenant));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("tenant_erasure");
    expect(audit[0]!.authorityUserId).toBe(ids.owner);
  });
});

describe("retention events route", () => {
  it("forbids a non-owner from reading the audit", async () => {
    const member = await loginSession("member");
    const r = await api(eventsPath(ids.tenant), { session: member });
    expect(r.status).toBe(403);
  });

  it("returns the tenant's retention audit to the owner", async () => {
    const owner = await loginSession("owner");
    const r = await api(eventsPath(ids.tenant), { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as { events: { action: string }[] };
    expect(body.events.some((e) => e.action === "tenant_erasure")).toBe(true);
  });
});
