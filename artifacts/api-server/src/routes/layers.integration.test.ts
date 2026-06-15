import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, layersTable, orgsTable, usersTable, type InsertLayer } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the Phase AG custom-layer surface over HTTP against a
// real Postgres: creation and approval are owner-only, the guarded template
// rejects malformed input, a benchmark mapping must target a canonical layer, an
// unapproved custom layer is withheld from the runnable catalog (GET /layers) but
// visible on the owner console (GET /layers/custom), and approval admits it to the
// catalog idempotently. Rows are namespaced by a run id and removed afterwards.
const RUN = `aglayers-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL_PREFIX = `${RUN}-`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const CANON = `${RUN}-canonical`;
const NONCANON = `${RUN}-noncanon`;

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
const createdLayerKeys: string[] = [CANON, NONCANON];

const ids = { providerOrg: "", clientOrg: "", owner: "", member: "", outsider: "" };

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
    .values({
      email: email(local),
      displayName: local,
      passwordHash,
      role,
      status: "active",
      orgId,
    })
    .returning({ id: usersTable.id });
  return inserted[0]!.id;
}

async function insertLayer(over: Partial<InsertLayer> & { key: string }): Promise<void> {
  await db.insert(layersTable).values({
    key: over.key,
    name: over.name ?? over.key,
    description: over.description ?? "fixture",
    archetype: over.archetype ?? "Performance scorecard",
    heroDescription: over.heroDescription ?? "",
    ownerPersona: over.ownerPersona ?? "",
    diagnosticQuestion: over.diagnosticQuestion ?? "fixture question",
    metricDefinitions: over.metricDefinitions ?? { tiles: ["a", "b", "c", "d"] },
    rootCauses: over.rootCauses ?? [],
    actions: over.actions ?? [],
    gaps: over.gaps ?? { items: [], closedBy: "" },
    feeds: over.feeds ?? ["fixture"],
    moduleGroup: over.moduleGroup ?? "Test",
    isCanonical: over.isCanonical ?? true,
    sortOrder: over.sortOrder ?? 9000,
    approvedAt: over.approvedAt ?? null,
    approvedBy: over.approvedBy ?? null,
    benchmarkCanonicalKey: over.benchmarkCanonicalKey ?? null,
  });
}

function validBody(name: string): Record<string, unknown> {
  return {
    name,
    diagnosticQuestion: "What is the question this layer answers?",
    archetype: "Performance scorecard",
    metricDefinitions: { tiles: ["t1", "t2", "t3", "t4"] },
    feeds: ["source-a"],
  };
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
  ids.providerOrg = providerOrg!.id;
  ids.clientOrg = clientOrg!.id;

  ids.owner = await seedUser("owner", "provider-owner", ids.providerOrg);
  ids.member = await seedUser("member", "provider-member", ids.providerOrg);
  ids.outsider = await seedUser("outsider", "client-viewer", ids.clientOrg);

  // A canonical layer (a valid benchmark target, and the subject of the "canonical
  // cannot be approved" case) and a non-canonical custom layer (an invalid target).
  await insertLayer({ key: CANON, isCanonical: true, name: `${RUN} canonical` });
  await insertLayer({ key: NONCANON, isCanonical: false, name: `${RUN} noncanon` });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  try {
    await db.delete(layersTable).where(inArray(layersTable.key, createdLayerKeys));
    await db.delete(usersTable).where(like(usersTable.email, `${EMAIL_PREFIX}%`));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("custom layer surface authorization", () => {
  it("rejects unauthenticated access to every owner route", async () => {
    expect((await api("/api/layers", { method: "POST", body: validBody("x") })).status).toBe(401);
    expect((await api("/api/layers/custom")).status).toBe(401);
    expect((await api(`/api/layers/${CANON}/approve`, { method: "POST" })).status).toBe(401);
  });

  it("forbids a non-owner provider member and a client seat", async () => {
    const member = await loginSession("member");
    const outsider = await loginSession("outsider");
    expect(
      (await api("/api/layers", { method: "POST", session: member, body: validBody("x") })).status,
    ).toBe(403);
    expect((await api("/api/layers/custom", { session: member })).status).toBe(403);
    expect(
      (await api("/api/layers", { method: "POST", session: outsider, body: validBody("x") }))
        .status,
    ).toBe(403);
  });
});

describe("custom layer creation, validation, and approval", () => {
  let createdKey = "";

  it("rejects a malformed template (wrong tile count and bad archetype)", async () => {
    const owner = await loginSession("owner");
    const badTiles = await api("/api/layers", {
      method: "POST",
      session: owner,
      body: { ...validBody(`${RUN} bad tiles`), metricDefinitions: { tiles: ["a", "b"] } },
    });
    expect(badTiles.status).toBe(400);
    expect((badTiles.json as { error: string }).error).toBe("invalid_request");

    const badArch = await api("/api/layers", {
      method: "POST",
      session: owner,
      body: { ...validBody(`${RUN} bad arch`), archetype: "Not a real archetype" },
    });
    expect(badArch.status).toBe(400);
  });

  it("rejects a benchmark mapping that does not target a canonical layer", async () => {
    const owner = await loginSession("owner");
    const missing = await api("/api/layers", {
      method: "POST",
      session: owner,
      body: { ...validBody(`${RUN} bad map`), benchmarkCanonicalKey: `${RUN}-does-not-exist` },
    });
    expect(missing.status).toBe(400);
    expect((missing.json as { error: string }).error).toBe("invalid_benchmark_canonical_key");

    const nonCanon = await api("/api/layers", {
      method: "POST",
      session: owner,
      body: { ...validBody(`${RUN} bad map 2`), benchmarkCanonicalKey: NONCANON },
    });
    expect(nonCanon.status).toBe(400);
    expect((nonCanon.json as { error: string }).error).toBe("invalid_benchmark_canonical_key");
  });

  it("creates an unapproved custom layer mapped to a canonical benchmark", async () => {
    const owner = await loginSession("owner");
    const r = await api("/api/layers", {
      method: "POST",
      session: owner,
      body: { ...validBody(`${RUN} Custom Layer`), benchmarkCanonicalKey: CANON },
    });
    expect(r.status).toBe(201);
    const layer = (
      r.json as {
        layer: {
          key: string;
          isCanonical: boolean;
          approvedAt: string | null;
          benchmarkCanonicalKey: string | null;
        };
      }
    ).layer;
    expect(layer.isCanonical).toBe(false);
    expect(layer.approvedAt).toBeNull();
    expect(layer.benchmarkCanonicalKey).toBe(CANON);
    createdKey = layer.key;
    createdLayerKeys.push(createdKey);
  });

  it("withholds the pending custom layer from the catalog but shows it on the owner console", async () => {
    const owner = await loginSession("owner");
    const catalog = await api("/api/layers", { session: owner });
    const catalogKeys = (catalog.json as { layers: { key: string }[] }).layers.map((l) => l.key);
    expect(catalogKeys).toContain(CANON); // canonical is runnable
    expect(catalogKeys).not.toContain(createdKey); // pending custom is withheld

    const ownerConsole = await api("/api/layers/custom", { session: owner });
    const pending = (
      ownerConsole.json as { layers: { key: string; approvedAt: string | null }[] }
    ).layers.find((l) => l.key === createdKey);
    expect(pending).toBeDefined();
    expect(pending!.approvedAt).toBeNull();
  });

  it("rejects approving a canonical layer and a missing key", async () => {
    const owner = await loginSession("owner");
    const canon = await api(`/api/layers/${CANON}/approve`, { method: "POST", session: owner });
    expect(canon.status).toBe(400);
    expect((canon.json as { error: string }).error).toBe("only_custom_layers_require_approval");

    const missing = await api(`/api/layers/${RUN}-nope/approve`, {
      method: "POST",
      session: owner,
    });
    expect(missing.status).toBe(404);
  });

  it("approves the pending custom layer, admits it to the catalog, and is idempotent", async () => {
    const owner = await loginSession("owner");
    const approve = await api(`/api/layers/${createdKey}/approve`, {
      method: "POST",
      session: owner,
    });
    expect(approve.status).toBe(200);
    expect((approve.json as { layer: { approvedAt: string | null } }).layer.approvedAt).toBeTruthy();

    const catalog = await api("/api/layers", { session: owner });
    const catalogKeys = (catalog.json as { layers: { key: string }[] }).layers.map((l) => l.key);
    expect(catalogKeys).toContain(createdKey);

    const again = await api(`/api/layers/${createdKey}/approve`, {
      method: "POST",
      session: owner,
    });
    expect(again.status).toBe(200);
    expect((again.json as { layer: { alreadyApproved?: boolean } }).layer.alreadyApproved).toBe(
      true,
    );
  });
});
