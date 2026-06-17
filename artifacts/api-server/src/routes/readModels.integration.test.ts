import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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

// End-to-end exercise of the tenant read-model surfaces (Phase AK efficacy and
// Phase AM as-of replay and diligence-pack export) against a real Postgres,
// driven over HTTP through a throwaway listener, mirroring the decisions
// integration harness. These routes are pure reads behind requireTenantAccess:
// they compute from persisted state, so the deterministic guard paths (auth,
// validation) and a real 200 read are exercised, never a fabricated figure. All
// rows are run-namespaced and removed afterwards.
const RUN = `rmtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const LAYER_KEY = "business-performance";

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

const layerContent = {
  narrative:
    "Renewal recovery is leaking because dunning stops after a single retry, so recoverable revenue is lost each cycle.",
  headline_finding: "Dunning stops too early",
  headline_impact: "Lost renewals",
  headline_lever: "Add staged retries",
  causes: [
    {
      title: "Single retry only",
      impact: "Lost recoveries",
      detail: "The system makes one attempt then gives up.",
      confidence: 60,
      basis: "modelled",
    },
  ],
  actions: [
    {
      title: "Stage the retries",
      detail: "Retry on day 1, 3 and 7 with escalating messaging.",
      impact: "Recovers about 18000 dollars per quarter",
      confidence: 72,
      basis: "modelled",
    },
  ],
  hypotheses: [],
  proof: { items: [] },
  gaps: [],
  metrics: [
    { label: "Recovery rate", value: "41%", tone: "warn", confidence: 55, basis: "modelled" },
  ],
  confidence: 64,
  confidence_gap: 20,
};

let server: Server;
let base: string;
const ids = { providerOrg: "", clientOrg: "", tenant: "", owner: "", clientViewer: "" };

interface ApiResult {
  status: number;
  json: unknown;
  text: string;
  contentType: string | null;
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
  const contentType = res.headers.get("content-type");
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, contentType, session: readSession(res, opts.session ?? null) };
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
  role: "provider-owner" | "provider-member" | "client-viewer",
  orgId: string | null,
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await db
    .insert(usersTable)
    .values({ email: email(local), displayName: local, passwordHash, role, status: "active", orgId })
    .returning({ id: usersTable.id });
  return inserted[0].id;
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
  ids.providerOrg = providerOrg.id;
  ids.clientOrg = clientOrg.id;

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant`, url: "https://rm.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = tenant.id;
  await db.insert(orgTenantsTable).values({ orgId: ids.clientOrg, tenantId: ids.tenant });

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.clientViewer = await seedUser("client-viewer", "client-viewer", ids.clientOrg);

  await db.insert(tenantLayersTable).values({
    tenantId: ids.tenant,
    layerKey: LAYER_KEY,
    content: layerContent,
    generatorModel: "test-fixture",
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  try {
    await db.delete(tenantLayersTable).where(inArray(tenantLayersTable.tenantId, [ids.tenant]));
    await db.delete(orgTenantsTable).where(inArray(orgTenantsTable.orgId, [ids.clientOrg, ids.providerOrg]));
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenant]));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("GET /api/tenants/:id/efficacy", () => {
  it("requires authentication", async () => {
    const r = await api(`/api/tenants/${ids.tenant}/efficacy`);
    expect(r.status).toBe(401);
  });

  it("returns the data-efficacy rollup for an authorised provider seat", async () => {
    const session = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenant}/efficacy`, { session });
    expect(r.status).toBe(200);
    const efficacy = (r.json as { efficacy?: { rollup?: { score: unknown; n: unknown }; layers?: unknown } })
      .efficacy;
    expect(efficacy).toBeTruthy();
    expect(efficacy?.rollup).toBeTruthy();
    expect(typeof efficacy?.rollup?.n).toBe("number");
    expect(Array.isArray(efficacy?.layers)).toBe(true);
  });

  it("lets a client-viewer of the tenant org read it too", async () => {
    const session = await loginSession("client-viewer");
    const r = await api(`/api/tenants/${ids.tenant}/efficacy`, { session });
    expect(r.status).toBe(200);
  });
});

describe("GET /api/tenants/:id/as-of", () => {
  it("requires authentication", async () => {
    const at = encodeURIComponent(new Date().toISOString());
    const r = await api(`/api/tenants/${ids.tenant}/as-of?at=${at}`);
    expect(r.status).toBe(401);
  });

  it("400s a missing as-of instant", async () => {
    const session = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenant}/as-of`, { session });
    expect(r.status).toBe(400);
    expect((r.json as { error?: string }).error).toBe("invalid_as_of_date");
  });

  it("400s an unparseable as-of instant", async () => {
    const session = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenant}/as-of?at=not-a-date`, { session });
    expect(r.status).toBe(400);
    expect((r.json as { error?: string }).error).toBe("invalid_as_of_date");
  });

  it("reconstructs the tenant state as of a valid instant", async () => {
    const session = await loginSession("owner");
    const at = encodeURIComponent(new Date().toISOString());
    const r = await api(`/api/tenants/${ids.tenant}/as-of?at=${at}`, { session });
    expect(r.status).toBe(200);
    expect((r.json as { asOf?: unknown }).asOf).toBeTruthy();
  });
});

describe("GET /api/tenants/:id/diligence-pack.html", () => {
  it("requires authentication", async () => {
    const r = await api(`/api/tenants/${ids.tenant}/diligence-pack.html`);
    expect(r.status).toBe(401);
  });

  it("serves a self-contained HTML diligence pack for an authorised seat", async () => {
    const session = await loginSession("owner");
    const r = await api(`/api/tenants/${ids.tenant}/diligence-pack.html`, { session });
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/html");
    expect(r.text).toContain("<");
  });
});
