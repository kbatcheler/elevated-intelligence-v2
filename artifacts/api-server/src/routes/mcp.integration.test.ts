import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  ingestionKeysTable,
  layersTable,
  tenantLayersTable,
  tenantsTable,
} from "@workspace/db";
import app from "../app";
import { createIngestionKey } from "../lib/ingestion/ingestionCredential";

// End-to-end exercise of the MCP server (Phase AE, path 5). It proves an external
// MCP client can speak raw JSON-RPC 2.0 over HTTP with nothing but the per-tenant
// ingestion bearer key: initialize, tools/list, and all four tools. submit_signals
// writes through the shared derive-and-discard terminus (and rejects raw records);
// the read tools return honestly, including the empty-diagnosis state. A missing or
// revoked key is a flat 401.
const RUN = `mcp-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SENTINEL = `RAW-SENTINEL-${RUN}`;

const ids = { tenant: "" };
let token = "";
let revokedToken = "";
let server: Server;
let base: string;
const L = { feed: `${RUN}-feed` };

async function seedLayer(key: string, actions: string[]): Promise<void> {
  await db.insert(layersTable).values({
    key,
    name: "MCP Test Layer",
    description: "ephemeral test layer",
    archetype: "Performance scorecard",
    heroDescription: "test",
    ownerPersona: "test",
    diagnosticQuestion: "is this layer real",
    metricDefinitions: { tiles: [] },
    rootCauses: [],
    actions,
    gaps: { items: [], closedBy: "test" },
    feeds: [],
    moduleGroup: "test",
    isCanonical: false,
    sortOrder: 9999,
  });
}

interface RpcResponse {
  status: number;
  body: { jsonrpc?: string; id?: unknown; result?: unknown; error?: { code: number; message: string } };
}

async function rpc(method: string, params: unknown, bearer: string | null, id: number): Promise<RpcResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  const res = await fetch(base + "/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  let body: RpcResponse["body"] = {};
  try {
    body = (await res.json()) as RpcResponse["body"];
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

// Unwrap an MCP tool result's single text content block back into JSON.
function toolPayload(result: unknown): { payload: any; isError: boolean } {
  const r = result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
  const text = r.content?.[0]?.text ?? "{}";
  return { payload: JSON.parse(text), isError: Boolean(r.isError) };
}

beforeAll(async () => {
  const t = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-t`, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  ids.tenant = t[0]!.id;

  await seedLayer(L.feed, ["Tighten approval thresholds", "Review the worst-performing cohort"]);

  const active = await createIngestionKey();
  await db.insert(ingestionKeysTable).values({
    id: active.keyId,
    tenantId: ids.tenant,
    label: "mcp-active",
    tokenHash: active.tokenHash,
  });
  token = active.token;

  const revoked = await createIngestionKey();
  await db.insert(ingestionKeysTable).values({
    id: revoked.keyId,
    tenantId: ids.tenant,
    label: "mcp-revoked",
    tokenHash: revoked.tokenHash,
    status: "revoked",
  });
  revokedToken = revoked.token;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (ids.tenant) await db.delete(tenantsTable).where(eq(tenantsTable.id, ids.tenant));
  await db.delete(layersTable).where(eq(layersTable.key, L.feed));
});

describe("mcp server: protocol", () => {
  it("handshakes via initialize and lists the four tools", async () => {
    const init = await rpc("initialize", {}, token, 1);
    expect(init.status).toBe(200);
    expect((init.body.result as { protocolVersion: string }).protocolVersion).toBeTruthy();

    const list = await rpc("tools/list", {}, token, 2);
    const tools = (list.body.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_actions",
      "get_diagnosis",
      "get_layer",
      "submit_signals",
    ]);
  });

  it("rejects a request with no key", async () => {
    const res = await rpc("tools/list", {}, null, 3);
    expect(res.status).toBe(401);
  });

  it("rejects a request with a revoked key", async () => {
    const res = await rpc("tools/list", {}, revokedToken, 4);
    expect(res.status).toBe(401);
  });

  it("returns method-not-found for an unknown method", async () => {
    const res = await rpc("does/not/exist", {}, token, 5);
    expect(res.body.error?.code).toBe(-32601);
  });
});

describe("mcp server: tools", () => {
  it("submit_signals writes derived math through the shared terminus", async () => {
    const res = await rpc(
      "tools/call",
      {
        name: "submit_signals",
        arguments: {
          layer: L.feed,
          signals: [
            { key: "win_rate", kind: "ratio", value: 0.42 },
            { key: "deals.count", kind: "count", value: 17 },
          ],
        },
      },
      token,
      6,
    );
    const { payload, isError } = toolPayload(res.body.result);
    expect(isError).toBe(false);
    expect(payload.accepted).toBe(true);
    expect(payload.signalsCount).toBe(2);

    const rows = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, `ingest:mcp:${L.feed}`));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect((r.value as { alg?: string }).alg).toBe("AES-256-GCM");
  });

  it("submit_signals rejects raw, non-numeric records as a tool error", async () => {
    const res = await rpc(
      "tools/call",
      {
        name: "submit_signals",
        arguments: { layer: L.feed, signals: [{ customer: SENTINEL, email: "a@b.com" }] },
      },
      token,
      7,
    );
    const { isError } = toolPayload(res.body.result);
    expect(isError).toBe(true);
    // The raw record must not have landed anywhere.
    const rows = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.sourceConnectorKey, `ingest:mcp:${L.feed}`));
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);
  });

  it("get_layer returns the registry definition", async () => {
    const res = await rpc("tools/call", { name: "get_layer", arguments: { layer: L.feed } }, token, 8);
    const { payload, isError } = toolPayload(res.body.result);
    expect(isError).toBe(false);
    expect(payload.layer.key).toBe(L.feed);
    expect(payload.layer.archetype).toBe("Performance scorecard");
  });

  it("get_diagnosis is honest when none exists, then reads the latest", async () => {
    const empty = await rpc("tools/call", { name: "get_diagnosis", arguments: { layer: L.feed } }, token, 9);
    expect(toolPayload(empty.body.result).payload.hasDiagnosis).toBe(false);

    await db.insert(tenantLayersTable).values({
      tenantId: ids.tenant,
      layerKey: L.feed,
      content: {
        headline_finding: "win rate slipping",
        actions: [{ title: "Coach the team", detail: "x", basis: "verified", confidence: 0.8 }],
      },
      generatorModel: "test-model",
    });

    const present = await rpc("tools/call", { name: "get_diagnosis", arguments: { layer: L.feed } }, token, 10);
    const { payload } = toolPayload(present.body.result);
    expect(payload.hasDiagnosis).toBe(true);
    expect(payload.content.headline_finding).toBe("win rate slipping");
  });

  it("get_actions combines registry, generated, and committed actions", async () => {
    const res = await rpc("tools/call", { name: "get_actions", arguments: { layer: L.feed } }, token, 11);
    const { payload, isError } = toolPayload(res.body.result);
    expect(isError).toBe(false);
    expect(payload.registryActions).toContain("Tighten approval thresholds");
    expect(payload.generatedActions[0].title).toBe("Coach the team");
    expect(Array.isArray(payload.committedActions)).toBe(true);
  });

  it("rejects a write to an unknown layer as a tool error", async () => {
    const res = await rpc(
      "tools/call",
      { name: "submit_signals", arguments: { layer: `${RUN}-nope`, signals: [{ key: "x", kind: "count", value: 1 }] } },
      token,
      12,
    );
    expect(toolPayload(res.body.result).isError).toBe(true);
  });
});
