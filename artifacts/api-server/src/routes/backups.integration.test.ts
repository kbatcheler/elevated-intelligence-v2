import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupEventsTable, db, orgsTable, provenanceLedgerTable, tenantsTable, usersTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { appendEntry, type LedgerVerifyRow, verifyLedgerEntries } from "../lib/provenance/ledger";
import { LocalFsArchiveStore, setArchiveStore } from "../lib/backups/archiveStore";
import { exportLedgerArchive, verifyLedgerArchiveObject } from "../lib/backups/ledgerArchive";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// The backup surface end to end against a real Postgres: the ledger archive
// export (verifiable object + one honest audit row + skip-unchanged), and the
// owner-only HTTP routes (trigger, events, status). This is the ONLY file in the
// suite that writes backup_events, so its writes never race another file's; the
// global ledger can still change underneath it, so the export assertions hold to
// what is deterministic (this tenant's own chain, and the skip invariant) rather
// than to a global truth. All rows are namespaced by a run id and removed after.
const RUN = "backups-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
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
let archiveRoot = "";
let store: LocalFsArchiveStore;
const createdShas: string[] = [];

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
  apiPath: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.session) headers["cookie"] = "ei_session=" + opts.session;
  const res = await fetch(base + apiPath, {
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
  archiveRoot = await mkdtemp(path.join(tmpdir(), "ei-backups-test-"));
  store = new LocalFsArchiveStore(archiveRoot);
  // The HTTP route uses the active store; point it at the temp dir so the route
  // never writes into the default location, and reset it afterwards.
  setArchiveStore(store);

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

  // A fresh tenant with a clean three-entry chain. Its unique content hashes make
  // the whole-ledger digest unique to this run, so the first export is guaranteed
  // to archive (its digest cannot equal any prior recorded snapshot).
  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.one", sourceRef: "verified:https://a" });
  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.two", sourceRef: "modelled:(none)" });
  await appendEntry({ tenantId: ids.tenant, claimPath: "layer.three", sourceRef: "verified:https://c" });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  try {
    if (createdShas.length > 0) {
      await db.delete(backupEventsTable).where(inArray(backupEventsTable.sha256, createdShas));
    }
    // derived_signals and provenance_ledger cascade off the tenant.
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [ids.tenant]));
    await db.delete(usersTable).where(like(usersTable.email, EMAIL_PREFIX + "%"));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ids.providerOrg, ids.clientOrg]));
  } finally {
    setSecretStore(null);
    setArchiveStore(null);
    await rm(archiveRoot, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("exportLedgerArchive", () => {
  it("archives the ledger to a write-once object and records one honest audit row", async () => {
    const res = await exportLedgerArchive({ store, now: new Date() });
    expect(res.status).toBe("archived");
    expect(res.objectKey).toBeTruthy();
    createdShas.push(res.sha256);

    expect(res.storeProvider).toBe("local");
    expect(res.entryCount).toBeGreaterThanOrEqual(3);

    // The object exists and its bytes hash to exactly the recorded digest.
    const bytes = await store.get(res.objectKey!);
    expect(bytes).not.toBeNull();
    expect(createHash("sha256").update(bytes!).digest("hex")).toBe(res.sha256);

    // This tenant's chain re-verifies out of the archived object, independent of
    // any other tenant present in the shared ledger.
    const parsed = JSON.parse(bytes!.toString("utf8")) as {
      entries: {
        id: string;
        tenantId: string | null;
        claimPath: string | null;
        sourceRef: string | null;
        contentHash: string;
        prevHash: string | null;
      }[];
    };
    const mine: LedgerVerifyRow[] = parsed.entries
      .filter((e) => e.tenantId === ids.tenant)
      .map((e) => ({
        id: e.id,
        claimPath: e.claimPath,
        sourceRef: e.sourceRef,
        contentHash: e.contentHash,
        prevHash: e.prevHash,
      }));
    expect(mine).toHaveLength(3);
    expect(verifyLedgerEntries(ids.tenant, mine).ok).toBe(true);

    // Exactly one audit row for this digest, and it agrees with the result.
    const audit = await db
      .select()
      .from(backupEventsTable)
      .where(inArray(backupEventsTable.sha256, [res.sha256]));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("ledger_archive");
    expect(audit[0]!.objectKey).toBe(res.objectKey);
    expect(audit[0]!.storeProvider).toBe("local");
    expect(audit[0]!.entryCount).toBe(res.entryCount);
    expect(audit[0]!.tenantCount).toBe(res.tenantCount);
    expect(audit[0]!.chainVerified).toBe(res.chainVerified);
    expect(audit[0]!.authorityRole).toBe("system");
    expect(audit[0]!.authorityUserId).toBeNull();
  });

  it("verifies an archived object back: bytes match the recorded digest", async () => {
    const res = await exportLedgerArchive({ store, now: new Date() });
    if (res.status === "archived") createdShas.push(res.sha256);
    const key = res.objectKey;
    // Whatever the latest archived object is, reading it back re-confirms its
    // recorded digest over the actual bytes.
    if (key) {
      const verify = await verifyLedgerArchiveObject(key, res.sha256, store);
      expect(verify.sha256).toBe(res.sha256);
    }
    // A tampered expectation is caught.
    if (key) {
      const bad = await verifyLedgerArchiveObject(key, "0".repeat(64), store);
      expect(bad.ok).toBe(false);
      expect(bad.detail).toMatch(/do not match recorded sha256/);
    }
    // A missing object is reported, not thrown.
    const missing = await verifyLedgerArchiveObject("ledger/does-not-exist.json", "x", store);
    expect(missing.ok).toBe(false);
    expect(missing.detail).toMatch(/not found/);
  });

  it("skips a re-archive of byte-identical content (no new object, no new row)", async () => {
    const first = await exportLedgerArchive({ store, now: new Date() });
    const second = await exportLedgerArchive({ store, now: new Date() });
    if (first.status === "archived") createdShas.push(first.sha256);
    if (second.status === "archived") createdShas.push(second.sha256);

    // The skip-unchanged invariant: a second export of byte-identical content is
    // skipped. Since this is the only file that writes backup_events, the "last"
    // pointer cannot move under us between the two calls; the only thing that can
    // change is the global ledger, and if a concurrent test changed it the
    // digests differ and the second is a legitimate fresh archive instead.
    if (second.sha256 === first.sha256) {
      expect(second.status).toBe("skipped");
      expect(second.reason).toBe("no change since last archive");
      expect(second.objectKey).toBeUndefined();
    } else {
      expect(second.status).toBe("archived");
      expect(second.objectKey).toBeTruthy();
    }
  });
});

const ARCHIVE = "/api/backups/ledger-archive";
const EVENTS = "/api/backups/events";
const STATUS = "/api/backups/status";

describe("backups routes owner gating", () => {
  it("rejects unauthenticated access to every route", async () => {
    expect((await api(ARCHIVE, { method: "POST" })).status).toBe(401);
    expect((await api(EVENTS)).status).toBe(401);
    expect((await api(STATUS)).status).toBe(401);
  });

  it("forbids a non-owner provider member", async () => {
    const member = await loginSession("member");
    expect((await api(ARCHIVE, { method: "POST", session: member })).status).toBe(403);
    expect((await api(EVENTS, { session: member })).status).toBe(403);
    expect((await api(STATUS, { session: member })).status).toBe(403);
  });

  it("forbids a client seat", async () => {
    const outsider = await loginSession("outsider");
    expect((await api(STATUS, { session: outsider })).status).toBe(403);
  });
});

describe("backups routes (owner)", () => {
  it("triggers a ledger archive and returns an honest result", async () => {
    const owner = await loginSession("owner");
    const r = await api(ARCHIVE, { method: "POST", session: owner });
    expect(r.status).toBe(200);
    const body = r.json as {
      status: "archived" | "skipped";
      objectKey?: string;
      sha256: string;
      storeProvider: string;
      chainVerified: boolean;
    };
    expect(["archived", "skipped"]).toContain(body.status);
    expect(body.storeProvider).toBe("local");
    if (body.status === "archived") createdShas.push(body.sha256);
  });

  it("returns the backup audit history to the owner", async () => {
    const owner = await loginSession("owner");
    const r = await api(EVENTS, { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as { events: { action: string; objectKey: string }[] };
    expect(Array.isArray(body.events)).toBe(true);
    // The first export test above guarantees at least one ledger_archive row.
    expect(body.events.some((e) => e.action === "ledger_archive")).toBe(true);
  });

  it("reports status with the provider and cadence but no secret or bucket", async () => {
    const owner = await loginSession("owner");
    const r = await api(STATUS, { session: owner });
    expect(r.status).toBe(200);
    const body = r.json as {
      store: { provider: string; connected: boolean };
      archiveIntervalMs: number;
      lastArchive: { action: string } | null;
    };
    expect(body.store).toEqual({ provider: "local", connected: true });
    expect(typeof body.archiveIntervalMs).toBe("number");
    expect(body.archiveIntervalMs).toBeGreaterThan(0);
    // Honest status never carries a path, bucket, or credential field.
    expect(JSON.stringify(body)).not.toContain(archiveRoot);
  });
});
