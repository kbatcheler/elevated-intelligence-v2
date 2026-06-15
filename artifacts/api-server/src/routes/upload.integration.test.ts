import { createServer, type Server as HttpServer } from "node:http";
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
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth/password";
import { type SecretStore, setSecretStore } from "../lib/secrets/secretStore";

// End-to-end exercise of the manual-upload path (Phase AE, path 3). It proves the
// deterministic spreadsheet derive (csv, xlsx) and the contract derive (docx, pdf)
// through the in-boundary extraction seat, with the seat pointed at a real,
// in-process OpenAI-compatible conformance server (real transport and protocol,
// not a stub of our own code). It also proves strict type and size rejection, the
// honest "seat available, not connected" failure, provider-only access, and that
// no raw row, cell, or contract text survives in the store. Self-cleaning.
const RUN = `upload-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SECRET = "integration-test-session-secret-value";
const PASSWORD = "correct-horse-battery-staple";
const SENTINEL = `RAW-SENTINEL-${RUN}`;

const L = {
  csv: `${RUN}-csv`,
  xlsx: `${RUN}-xlsx`,
  doc: `${RUN}-doc`,
  pdf: `${RUN}-pdf`,
  text: `${RUN}-text`,
};

const CONTRACT_METRICS = {
  parties_count: 2,
  term_months: 24,
  total_value: 120000,
  obligations_count: 5,
  auto_renew: 1,
  days_to_expiry: 300,
};

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

// ----- zero-dependency fixture builders --------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A minimal STORE-method (uncompressed) ZIP writer, enough to assemble a real
// xlsx/docx the in-app reader can open. Built with Buffers only, no dependency.
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
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
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

function makeXlsx(): Buffer {
  const shared =
    '<?xml version="1.0"?><sst xmlns="x"><si><t>revenue</t></si><si><t>region</t></si>' +
    "<si><t>east</t></si><si><t>west</t></si></sst>";
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2"><v>10</v></c><c r="B2" t="s"><v>2</v></c></row>' +
    '<row r="3"><c r="A3"><v>20</v></c><c r="B3" t="s"><v>3</v></c></row>' +
    "</sheetData></worksheet>";
  return makeZip([
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
}

function makeDocx(): Buffer {
  const doc =
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
    `<w:p><w:r><w:t>Master Services Agreement ${SENTINEL}</w:t></w:r></w:p>` +
    "<w:p><w:r><w:t>Term 24 months. Total value 120000. Auto-renew yes.</w:t></w:r></w:p>" +
    "</w:body></w:document>";
  return makeZip([{ name: "word/document.xml", data: Buffer.from(doc, "utf8") }]);
}

function makePdf(): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (Master Services Agreement ${SENTINEL} Term 24 months) Tj ET`;
  const pdf =
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n" +
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n` +
    "trailer<</Root 1 0 R>>\n%%EOF";
  return Buffer.from(pdf, "latin1");
}

// ----- harness ---------------------------------------------------------------

let server: Server;
let base: string;
let llm: HttpServer;
let llmBase: string;

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

async function upload(
  session: string,
  layer: string,
  filename: string,
  mime: string,
  bytes: Buffer,
): Promise<ApiResult> {
  const q = `?layer=${encodeURIComponent(layer)}&filename=${encodeURIComponent(filename)}`;
  const res = await fetch(base + `/api/tenants/${ids.tenant}/uploads` + q, {
    method: "POST",
    headers: { "content-type": mime, cookie: `ei_session=${session}` },
    body: bytes,
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

async function seedLayer(key: string): Promise<void> {
  const { layersTable } = await import("@workspace/db");
  await db.insert(layersTable).values({
    key,
    name: "Upload Test Layer",
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

function setSeatEnv(): void {
  process.env.LOCAL_MODEL_BASE_URL = llmBase;
  process.env.LOCAL_MODEL_MODEL = "conformance-extractor";
}
function clearSeatEnv(): void {
  delete process.env.LOCAL_MODEL_BASE_URL;
  delete process.env.LOCAL_MODEL_MODEL;
}

beforeAll(async () => {
  setSecretStore(testStore);

  // A real OpenAI-compatible conformance server for the contract extraction seat.
  await new Promise<void>((resolve) => {
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            model: "conformance-extractor",
            usage: { prompt_tokens: 12, completion_tokens: 8 },
            choices: [{ message: { role: "assistant", content: JSON.stringify(CONTRACT_METRICS) } }],
          }),
        );
      });
    });
    llm.listen(0, () => {
      const addr = llm.address() as AddressInfo;
      llmBase = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
  setSeatEnv();

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

  for (const key of Object.values(L)) await seedLayer(key);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  clearSeatEnv();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => llm.close(() => resolve()));
  if (ids.tenant) await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  const { layersTable } = await import("@workspace/db");
  for (const key of Object.values(L)) await db.delete(layersTable).where(eq(layersTable.key, key));
  await db.delete(usersTable).where(like(usersTable.email, `${RUN}-%`));
  for (const id of [ids.providerOrg, ids.clientOrg]) {
    if (id) await db.delete(orgsTable).where(eq(orgsTable.id, id));
  }
});

async function signalsFor(layer: string) {
  return db
    .select()
    .from(derivedSignalsTable)
    .where(eq(derivedSignalsTable.sourceConnectorKey, `ingest:upload:${layer}`));
}

describe("manual upload: spreadsheets derive deterministic numeric math", () => {
  it("derives per-column aggregates from a CSV and discards the rows", async () => {
    const session = await loginSession("owner");
    const csv = `revenue,region\n10,east ${SENTINEL}\n20,west ${SENTINEL}\n`;
    const r = await upload(session, L.csv, "q1.csv", "text/csv", Buffer.from(csv, "utf8"));
    expect(r.status).toBe(201);
    const body = r.json as {
      fileType: string;
      kind: string;
      signalsCount: number;
      derived: string[];
      discarded: { rawRows?: number };
    };
    expect(body.fileType).toBe("csv");
    expect(body.kind).toBe("spreadsheet");
    expect(body.signalsCount).toBe(5);
    expect(body.derived).toContain("revenue.mean = 15");
    expect(body.discarded.rawRows).toBe(2);

    const rows = await signalsFor(L.csv);
    expect(rows).toHaveLength(5);
    for (const s of rows) {
      const v = s.value as Record<string, unknown>;
      expect(v.alg).toBe("AES-256-GCM");
      expect(JSON.stringify(v)).not.toContain(SENTINEL);
    }
    const prov = await db
      .select()
      .from(provenanceLedgerTable)
      .where(eq(provenanceLedgerTable.tenantId, ids.tenant));
    expect(prov.some((p) => p.claimPath === `ingestion:upload:${L.csv}`)).toBe(true);
  });

  it("derives per-column aggregates from an xlsx workbook", async () => {
    const session = await loginSession("owner");
    const r = await upload(
      session,
      L.xlsx,
      "book.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      makeXlsx(),
    );
    expect(r.status).toBe(201);
    const body = r.json as { fileType: string; signalsCount: number; derived: string[] };
    expect(body.fileType).toBe("xlsx");
    expect(body.signalsCount).toBe(5);
    expect(body.derived).toContain("revenue.mean = 15");
    expect(body.derived).toContain("revenue.max = 20");
  });

  it("rejects a spreadsheet with no numeric columns", async () => {
    const session = await loginSession("owner");
    const csv = "name,city\nalice,paris\nbob,rome\n";
    const r = await upload(session, L.text, "names.csv", "text/csv", Buffer.from(csv, "utf8"));
    expect(r.status).toBe(422);
    expect((r.json as { error: string }).error).toBe("no_numeric_columns");
    expect(await signalsFor(L.text)).toHaveLength(0);
  });
});

describe("manual upload: contracts derive numeric metrics via the in-boundary seat", () => {
  it("derives contract metrics from a docx and discards the text", async () => {
    setSeatEnv();
    const session = await loginSession("owner");
    const r = await upload(
      session,
      L.doc,
      "msa.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      makeDocx(),
    );
    expect(r.status).toBe(201);
    const body = r.json as {
      kind: string;
      signalsCount: number;
      derived: string[];
      discarded: { rawTextChars?: number };
    };
    expect(body.kind).toBe("contract");
    expect(body.signalsCount).toBe(6);
    expect(body.derived).toContain("contract.term_months = 24 months");
    expect(body.discarded.rawTextChars).toBeGreaterThan(0);

    const rows = await signalsFor(L.doc);
    expect(rows).toHaveLength(6);
    for (const s of rows) {
      expect(JSON.stringify(s.value)).not.toContain(SENTINEL);
    }
  });

  it("derives contract metrics from a pdf content stream", async () => {
    setSeatEnv();
    const session = await loginSession("owner");
    const r = await upload(session, L.pdf, "msa.pdf", "application/pdf", makePdf());
    expect(r.status).toBe(201);
    const body = r.json as { kind: string; signalsCount: number };
    expect(body.kind).toBe("contract");
    expect(body.signalsCount).toBe(6);
    const rows = await signalsFor(L.pdf);
    expect(rows.every((s) => JSON.stringify(s.value).indexOf(SENTINEL) === -1)).toBe(true);
  });

  it("fails loudly when the extraction seat is available but not connected", async () => {
    clearSeatEnv();
    const session = await loginSession("owner");
    const r = await upload(
      session,
      L.doc,
      "msa.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      makeDocx(),
    );
    expect(r.status).toBe(503);
    expect((r.json as { error: string }).error).toBe("local_extraction_seat_not_connected");
    setSeatEnv();
  });
});

describe("manual upload: strict validation and access control", () => {
  it("rejects an unsupported file type", async () => {
    const session = await loginSession("owner");
    const r = await upload(session, L.csv, "logo.png", "image/png", Buffer.from([1, 2, 3, 4]));
    expect(r.status).toBe(400);
    expect((r.json as { error: string }).error).toBe("unsupported_file_type");
  });

  it("rejects an oversized upload", async () => {
    const session = await loginSession("owner");
    const big = Buffer.alloc(10 * 1024 * 1024 + 512 * 1024, 65);
    const r = await upload(session, L.csv, "big.csv", "text/csv", big);
    expect(r.status).toBe(413);
    expect((r.json as { error: string }).error).toBe("file_too_large");
  });

  it("refuses a non-provider", async () => {
    const session = await loginSession("client");
    const csv = "revenue\n10\n20\n";
    const r = await upload(session, L.csv, "q1.csv", "text/csv", Buffer.from(csv, "utf8"));
    expect(r.status).toBe(403);
  });
});
