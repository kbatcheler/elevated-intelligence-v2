import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  diagnosisShareTokensTable,
  provenanceLedgerTable,
  tenantLayersTable,
  tenantsTable,
} from "@workspace/db";
import app from "../app";
import { mintShareToken } from "../lib/sellability/shareTokens";

// End-to-end exercise of the ONLY unauthenticated data surface (Phase AB): the
// public shareable diagnosis. A valid opaque token returns a board-pack-level
// diagnosis with NO session cookie; an unknown token is a uniform 404. All rows
// are namespaced by a unique run id and removed afterwards, so the suite is
// self-cleaning and safe to run repeatedly. No model is called: the projection
// reads only persisted layer content.
const RUN = `ptest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// A real registry layer key so the tenant_layers FK to layers.key holds.
const LAYER_KEY = "business-performance";

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
let tenantId = "";
let validToken = "";

async function get(
  path: string,
): Promise<{ status: number; json: unknown; setCookie: string[] }> {
  const res = await fetch(base + path);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `${RUN} Tenant`, url: "https://p.example.com", status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantId = tenant.id;

  await db.insert(tenantLayersTable).values({
    tenantId,
    layerKey: LAYER_KEY,
    content: layerContent,
    generatorModel: "test-fixture",
  });

  // The plaintext token is returned exactly once at mint; only its hash is
  // stored, so this is the sole place the test can learn a working link.
  const minted = await mintShareToken({ tenantId, createdBy: null });
  validToken = minted.token;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  try {
    await db
      .delete(diagnosisShareTokensTable)
      .where(inArray(diagnosisShareTokensTable.tenantId, [tenantId]));
    await db.delete(provenanceLedgerTable).where(inArray(provenanceLedgerTable.tenantId, [tenantId]));
    await db.delete(tenantLayersTable).where(inArray(tenantLayersTable.tenantId, [tenantId]));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantId]));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe("GET /api/public/diagnosis/:token", () => {
  it("404s an unknown token with a uniform shape", async () => {
    const r = await get(`/api/public/diagnosis/not-a-real-token-${RUN}`);
    expect(r.status).toBe(404);
    expect((r.json as { error?: string }).error).toBe("not_found");
  });

  it("returns a board-pack diagnosis for a valid token with no session cookie", async () => {
    const r = await get(`/api/public/diagnosis/${validToken}`);
    expect(r.status).toBe(200);
    const diagnosis = (
      r.json as {
        diagnosis?: { layers?: unknown; poweredBy?: { label?: string; href?: string } };
      }
    ).diagnosis;
    expect(diagnosis).toBeTruthy();
    expect(Array.isArray(diagnosis?.layers)).toBe(true);
    // The viral mark is a constant brand attribution, never a computed figure.
    expect(diagnosis?.poweredBy?.label).toBe("Powered by Elevated Intelligence");
    // The public surface is sessionless: it must never mint an ei_session cookie.
    expect(r.setCookie.some((c) => c.startsWith("ei_session="))).toBe(false);
  });
});
