import { createHmac } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  ingestionKeysTable,
  layersTable,
  orgsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { createIngestionKey } from "../lib/ingestion/ingestionCredential";
import { processSftpDropOnce } from "../lib/ingestion/sftpDrop";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// Broad raw-absence acceptance for the whole ingestion suite (Phase AE). The five
// per-path tests each prove their own discard; this one proves the SYSTEM-WIDE
// invariant. It drives every path with a single unique sentinel planted only in
// genuinely raw positions (discarded rows, discarded cells, and rejected raw
// records), then performs the strong sweep: it scans EVERY text-like and jsonb
// column in the public schema, plus the SFTP inbound tree on disk, and asserts
// the sentinel appears nowhere. If any path ever persisted a raw artifact, this
// finds it. The sentinel is a unique per-run string, so a count of zero across
// the entire database is a real, not vacuous, guarantee.
const RUN = `rawsweep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const SENTINEL = `RAW-SWEEP-SENTINEL-${RUN}`;
const LAYER = `${RUN}-layer`;

const testStore: SecretStore = {
  async get(ref) {
    return ref === "SESSION_SECRET" ? SECRET : null;
  },
  async set() {},
  async delete() {},
};

const sftpLog = { info() {}, warn() {}, error() {} };

const ids = { providerOrg: "", clientOrg: "", tenant: "", owner: "" };
let server: Server;
let base: string;
let ingestToken = "";
let sftpRoot = "";

function emailFor(local: string): string {
  return `${RUN}-${local}@example.com`;
}

// ----- zero-dependency xlsx fixture (STORE-method zip) -----------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + f.data.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

// A workbook with one numeric column (revenue) and one non-numeric column whose
// cells carry the sentinel via a shared string. The sentinel ALSO rides in the
// numeric column's own header text, to prove that a raw header is never echoed
// into a stored signal key. The numeric math is kept under a generic positional
// key; the sentinel-bearing strings (header and cells) are parsed in memory and
// discarded.
function makeXlsxWithSentinel(): Buffer {
  const shared =
    '<?xml version="1.0"?><sst xmlns="x">' +
    `<si><t>revenue ${SENTINEL}</t></si><si><t>region</t></si>` +
    `<si><t>east ${SENTINEL}</t></si></sst>`;
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2"><v>10</v></c><c r="B2" t="s"><v>2</v></c></row>' +
    '<row r="3"><c r="A3"><v>20</v></c><c r="B3" t="s"><v>2</v></c></row>' +
    "</sheetData></worksheet>";
  return makeZip([
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
}

// ----- harness ---------------------------------------------------------------

function readSession(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = /^ei_session=([^;]*)/.exec(c);
    if (m) return m[1] === "" ? null : m[1];
  }
  return null;
}

async function loginOwner(): Promise<string> {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailFor("owner"), password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return readSession(res) as string;
}

async function seedLayer(key: string): Promise<void> {
  await db.insert(layersTable).values({
    key,
    name: "Raw Sweep Layer",
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
}

beforeAll(async () => {
  setSecretStore(testStore);
  sftpRoot = join(tmpdir(), RUN);
  await mkdir(sftpRoot, { recursive: true });

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

  const passwordHash = await hashPassword(PASSWORD);
  const [owner] = await db
    .insert(usersTable)
    .values({
      email: emailFor("owner"),
      displayName: "owner",
      passwordHash,
      role: "provider-owner",
      status: "active",
      orgId: ids.providerOrg,
    })
    .returning({ id: usersTable.id });
  ids.owner = owner!.id;

  const t = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-t`, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = t[0]!.id;

  await seedLayer(LAYER);

  const cred = await createIngestionKey();
  await db.insert(ingestionKeysTable).values({
    id: cred.keyId,
    tenantId: ids.tenant,
    label: "raw-sweep",
    tokenHash: cred.tokenHash,
  });
  ingestToken = cred.token;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(sftpRoot, { recursive: true, force: true });
  if (ids.tenant) await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  await db.delete(layersTable).where(eq(layersTable.key, LAYER));
  await db.delete(usersTable).where(like(usersTable.email, `${RUN}-%`));
  for (const id of [ids.providerOrg, ids.clientOrg]) {
    if (id) await db.delete(orgsTable).where(eq(orgsTable.id, id));
  }
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("Phase AE: system-wide raw-artifact absence", () => {
  it("drives every ingestion path with a sentinel, then proves it is stored nowhere", async () => {
    const session = await loginOwner();

    // Path 3a: manual upload of a CSV. The sentinel rides in the numeric column's
    // header AND in a non-numeric column's cells; only the revenue aggregates are
    // kept, under a generic positional key, so neither raw position is persisted.
    const csv = `revenue ${SENTINEL},region\n10,east ${SENTINEL}\n20,west ${SENTINEL}\n`;
    const upCsv = await fetch(
      base +
        `/api/tenants/${ids.tenant}/uploads?layer=${encodeURIComponent(LAYER)}&filename=q1.csv`,
      {
        method: "POST",
        headers: { "content-type": "text/csv", cookie: `ei_session=${session}` },
        body: Buffer.from(csv, "utf8"),
      },
    );
    expect(upCsv.status).toBe(201);

    // Path 3b: manual upload of an xlsx whose sentinel rides in a shared string.
    const upXlsx = await fetch(
      base +
        `/api/tenants/${ids.tenant}/uploads?layer=${encodeURIComponent(LAYER)}&filename=book.xlsx`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          cookie: `ei_session=${session}`,
        },
        body: makeXlsxWithSentinel(),
      },
    );
    expect(upXlsx.status).toBe(201);

    // Path 4: SFTP drop. A valid file carries the sentinel in raw rows; the
    // success path derives the math and DELETES the file from the inbound tree. A
    // malformed file (all-text, no numeric column) is REJECTED, and its raw bytes
    // are discarded too, not left parked on disk as a ".rejected" artifact.
    const dropDir = join(sftpRoot, ids.tenant, LAYER);
    await mkdir(dropDir, { recursive: true });
    const dropPath = join(dropDir, "drop.csv");
    await writeFile(dropPath, `revenue,region\n30,north ${SENTINEL}\n40,south ${SENTINEL}\n`);
    const badPath = join(dropDir, "bad.csv");
    await writeFile(badPath, `name,city\nalice ${SENTINEL},paris\nbob ${SENTINEL},rome\n`);
    const sftpSummary = await processSftpDropOnce(sftpLog, { root: sftpRoot, quietMs: 0 });
    expect(sftpSummary.processed).toBe(1);
    expect(sftpSummary.rejected).toBe(1);
    expect(await fileExists(dropPath)).toBe(false);
    expect(await fileExists(badPath)).toBe(false);

    // Path 1: Ingestion API. A valid numeric call is accepted; a raw call that
    // smuggles the sentinel as a non-numeric value is refused and stores nothing.
    const apiOk = await fetch(base + "/v1/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ layer: LAYER, signals: [{ key: "api_metric", kind: "ratio", value: 0.5 }] }),
    });
    expect(apiOk.status).toBe(202);

    const apiRaw = await fetch(base + "/v1/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ layer: LAYER, signals: [{ key: "leaked", kind: "score", value: SENTINEL }] }),
    });
    expect(apiRaw.status).toBe(400);

    // Path 1 (metadata guard): a numerically valid signal whose KEY smuggles
    // identifying free text (an email-shaped token carrying the sentinel) is
    // refused at the derive-and-discard boundary, so no raw key is persisted.
    const apiBadKey = await fetch(base + "/v1/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({
        layer: LAYER,
        signals: [{ key: `user@${SENTINEL}.example`, kind: "ratio", value: 0.5 }],
      }),
    });
    expect(apiBadKey.status).toBe(400);

    // Path 2: Webhooks. Mint a per-source signing secret, then deliver a valid
    // signed numeric payload (accepted) and a signed payload that smuggles the
    // sentinel as a non-numeric value (refused). Neither persists the sentinel.
    const mint = await fetch(base + `/api/tenants/${ids.tenant}/webhook-sources`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `ei_session=${session}` },
      body: JSON.stringify({ label: "raw-sweep-hook", targetLayer: LAYER }),
    });
    expect(mint.status).toBe(201);
    const minted = (await mint.json()) as { sourceId: string; signingSecret: string };

    async function deliverWebhook(payload: unknown): Promise<number> {
      const bodyStr = JSON.stringify(payload);
      const signature =
        "sha256=" + createHmac("sha256", minted.signingSecret).update(bodyStr).digest("hex");
      const res = await fetch(base + `/api/webhooks/${minted.sourceId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ei-signature": signature },
        body: bodyStr,
      });
      return res.status;
    }
    const hookOk = await deliverWebhook({
      signals: [{ key: "hook_metric", kind: "ratio", value: 0.25 }],
    });
    expect(hookOk).toBe(202);
    const hookRaw = await deliverWebhook({
      signals: [{ key: "leaked", kind: "score", value: SENTINEL }],
    });
    expect(hookRaw).toBe(400);

    // Path 5: MCP. A valid submit is accepted; a raw submit is a tool error.
    async function mcpCall(args: unknown): Promise<{ isError: boolean }> {
      const res = await fetch(base + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "submit_signals", arguments: args },
        }),
      });
      const body = (await res.json()) as {
        result?: { content?: Array<{ text: string }>; isError?: boolean };
      };
      return { isError: Boolean(body.result?.isError) };
    }
    const mcpOk = await mcpCall({ layer: LAYER, signals: [{ key: "mcp_metric", kind: "count", value: 3 }] });
    expect(mcpOk.isError).toBe(false);
    const mcpRaw = await mcpCall({ layer: LAYER, signals: [{ account: SENTINEL, email: "x@y.com" }] });
    expect(mcpRaw.isError).toBe(true);

    // Sanity: the derive-and-discard paths really did persist their math, so the
    // zero-sentinel result below is the discard working, not the writes failing.
    const stored = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, ids.tenant));
    expect(stored.length).toBeGreaterThan(0);

    // The strong sweep: every text-like and jsonb column in the public schema.
    const cols = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
          OR (data_type = 'ARRAY' AND udt_name = '_text')
        )
    `);
    const columnRows = cols.rows as Array<{ table_name: string; column_name: string }>;
    expect(columnRows.length).toBeGreaterThan(0);

    // The sentinel is our own [A-Za-z0-9-] string, safe to inline; identifiers
    // come from the catalog and are double-quoted.
    const probes = columnRows.map(
      (c) =>
        `SELECT count(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}"::text LIKE '%${SENTINEL}%'`,
    );
    const sweep = await db.execute(
      sql.raw(`SELECT COALESCE(SUM(n), 0)::int AS total FROM (${probes.join(" UNION ALL ")}) s`),
    );
    const total = Number((sweep.rows as Array<{ total: number }>)[0]!.total);
    expect(total).toBe(0);

    // And no raw artifact is parked in the SFTP inbound tree on disk: the success
    // path removed its file, leaving the tenant's layer drop directory empty.
    const remaining = await readdir(dropDir);
    expect(remaining).toHaveLength(0);
  });
});
