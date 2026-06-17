import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  committedActionsTable,
  db,
  layersTable,
  tenantLayersTable,
} from "@workspace/db";
import { ingestDerivedSignalSet } from "../lib/ingestion/ingestCore";
import { assertIngestibleLayer, IngestionLayerError } from "../lib/ingestion/layers";
import { requireIngestionKey } from "../middleware/ingestionAuth";
import { createRateLimiter } from "../middleware/rateLimit";

// The MCP server (Phase AE, ingestion path 5). It speaks raw JSON-RPC 2.0 over a
// single HTTP endpoint so an external MCP client (Claude Desktop, an agent, a
// script) can call it with nothing but the per-tenant ingestion bearer key. No
// SDK and no new dependency: the protocol is a handful of method names over the
// JSON body Express already parses. The tenant is resolved from the key, never
// from the params, exactly like the Ingestion API. One tool writes
// (submit_signals, through the shared derive-and-discard terminus); three read
// back honestly (get_layer, get_diagnosis, get_actions) and never fabricate a
// result when there is no diagnosis yet.
export const mcpRouter = Router();

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "elevated-intelligence-ingestion";
const SERVER_VERSION = "1.0.0";

// JSON-RPC standard error codes.
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const mcpLimiter = createRateLimiter({
  name: "mcp",
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => req.ingestionKey?.id ?? req.ip ?? "unknown",
});

// ----- tool definitions (advertised by tools/list) ---------------------------

const TOOLS = [
  {
    name: "submit_signals",
    description:
      "Submit a set of derived numeric signals for one layer. The body must be derived math, not raw records; non-numeric content is rejected.",
    inputSchema: {
      type: "object",
      required: ["layer", "signals"],
      properties: {
        layer: { type: "string", description: "The target layer key." },
        signals: {
          type: "array",
          description: "An array of derived signals (key, kind, numeric value).",
          items: { type: "object" },
        },
        generatedAt: { type: "string" },
        windowStart: { type: "string" },
        windowEnd: { type: "string" },
      },
    },
  },
  {
    name: "get_layer",
    description: "Read the registry definition of a layer (archetype, diagnostic question, metric definitions).",
    inputSchema: {
      type: "object",
      required: ["layer"],
      properties: { layer: { type: "string", description: "The layer key." } },
    },
  },
  {
    name: "get_diagnosis",
    description:
      "Read the latest generated diagnosis for this tenant and layer. Returns hasDiagnosis=false when none has been generated yet.",
    inputSchema: {
      type: "object",
      required: ["layer"],
      properties: { layer: { type: "string", description: "The layer key." } },
    },
  },
  {
    name: "get_actions",
    description:
      "Read the recommended actions for this tenant and layer: the layer's static actions, the generated actions from the latest diagnosis, and the actions already committed.",
    inputSchema: {
      type: "object",
      required: ["layer"],
      properties: { layer: { type: "string", description: "The layer key." } },
    },
  },
] as const;

// ----- JSON-RPC envelope helpers ---------------------------------------------

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: unknown, error: JsonRpcError): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error };
}

// An MCP tool result wraps a JSON payload in a single text content block. isError
// flags a tool-level failure (a bad layer, say) without failing the JSON-RPC
// call itself, which is how MCP surfaces a recoverable tool error to the client.
function toolText(payload: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  };
}

// ----- tool implementations --------------------------------------------------

const layerArgs = z.object({ layer: z.string().min(1).max(120) });
const submitArgs = z.object({
  layer: z.string().min(1).max(120),
  signals: z.array(z.unknown()).max(5000),
  generatedAt: z.string().min(1).max(40).optional(),
  windowStart: z.string().min(1).max(40).optional(),
  windowEnd: z.string().min(1).max(40).optional(),
});

async function callSubmitSignals(tenantId: string, args: unknown): Promise<Record<string, unknown>> {
  const parsed = submitArgs.safeParse(args);
  if (!parsed.success) {
    return toolText({ error: "invalid_arguments", detail: parsed.error.issues[0]?.message }, true);
  }
  const body = parsed.data;
  try {
    await assertIngestibleLayer(tenantId, body.layer);
  } catch (err) {
    if (err instanceof IngestionLayerError) {
      return toolText({ error: err.code, layer: body.layer }, true);
    }
    throw err;
  }
  try {
    const result = await ingestDerivedSignalSet({
      tenantId,
      method: "mcp",
      feedKey: body.layer,
      layers: [body.layer],
      signals: body.signals,
      generatedAt: body.generatedAt,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
    });
    return toolText({
      accepted: true,
      rootHash: result.rootHash,
      signalsCount: result.signalsCount,
      layers: result.layers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signal set";
    if (/derive|signal|numeric|raw|strict|expected/i.test(message)) {
      return toolText({ error: "invalid_signals", detail: message }, true);
    }
    throw err;
  }
}

async function callGetLayer(args: unknown): Promise<Record<string, unknown>> {
  const parsed = layerArgs.safeParse(args);
  if (!parsed.success) {
    return toolText({ error: "invalid_arguments", detail: parsed.error.issues[0]?.message }, true);
  }
  const rows = await db
    .select({
      key: layersTable.key,
      name: layersTable.name,
      description: layersTable.description,
      archetype: layersTable.archetype,
      ownerPersona: layersTable.ownerPersona,
      diagnosticQuestion: layersTable.diagnosticQuestion,
      metricDefinitions: layersTable.metricDefinitions,
      actions: layersTable.actions,
      moduleGroup: layersTable.moduleGroup,
      isCanonical: layersTable.isCanonical,
    })
    .from(layersTable)
    .where(eq(layersTable.key, parsed.data.layer))
    .limit(1);
  if (!rows[0]) {
    return toolText({ error: "unknown_layer", layer: parsed.data.layer }, true);
  }
  return toolText({ layer: rows[0] });
}

async function callGetDiagnosis(tenantId: string, args: unknown): Promise<Record<string, unknown>> {
  const parsed = layerArgs.safeParse(args);
  if (!parsed.success) {
    return toolText({ error: "invalid_arguments", detail: parsed.error.issues[0]?.message }, true);
  }
  const rows = await db
    .select({
      layerKey: tenantLayersTable.layerKey,
      content: tenantLayersTable.content,
      confounders: tenantLayersTable.confounders,
      verifiedClaims: tenantLayersTable.verifiedClaims,
      modelledClaims: tenantLayersTable.modelledClaims,
      generatedAt: tenantLayersTable.generatedAt,
    })
    .from(tenantLayersTable)
    .where(
      and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, parsed.data.layer)),
    )
    .orderBy(desc(tenantLayersTable.generatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    // Honest empty state: there is no diagnosis yet, and we never invent one.
    return toolText({ hasDiagnosis: false, layer: parsed.data.layer });
  }
  return toolText({
    hasDiagnosis: true,
    layer: row.layerKey,
    generatedAt: row.generatedAt,
    content: row.content,
    confounders: row.confounders,
    verifiedClaims: row.verifiedClaims,
    modelledClaims: row.modelledClaims,
  });
}

async function callGetActions(tenantId: string, args: unknown): Promise<Record<string, unknown>> {
  const parsed = layerArgs.safeParse(args);
  if (!parsed.success) {
    return toolText({ error: "invalid_arguments", detail: parsed.error.issues[0]?.message }, true);
  }
  const layer = parsed.data.layer;
  const layerRows = await db
    .select({ actions: layersTable.actions })
    .from(layersTable)
    .where(eq(layersTable.key, layer))
    .limit(1);
  if (!layerRows[0]) {
    return toolText({ error: "unknown_layer", layer }, true);
  }
  const diagRows = await db
    .select({ content: tenantLayersTable.content })
    .from(tenantLayersTable)
    .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layer)))
    .orderBy(desc(tenantLayersTable.generatedAt))
    .limit(1);
  const generated = Array.isArray(
    (diagRows[0]?.content as { actions?: unknown } | undefined)?.actions,
  )
    ? ((diagRows[0]!.content as { actions: unknown[] }).actions as unknown[])
    : [];
  const committed = await db
    .select({
      id: committedActionsTable.id,
      title: committedActionsTable.title,
      status: committedActionsTable.status,
      committedAt: committedActionsTable.committedAt,
    })
    .from(committedActionsTable)
    .where(and(eq(committedActionsTable.tenantId, tenantId), eq(committedActionsTable.layerKey, layer)));
  return toolText({
    layer,
    registryActions: layerRows[0].actions,
    generatedActions: generated,
    committedActions: committed,
  });
}

async function dispatchToolCall(
  tenantId: string,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "submit_signals":
      return callSubmitSignals(tenantId, args);
    case "get_layer":
      return callGetLayer(args);
    case "get_diagnosis":
      return callGetDiagnosis(tenantId, args);
    case "get_actions":
      return callGetActions(tenantId, args);
    default:
      return toolText({ error: "unknown_tool", name }, true);
  }
}

// ----- the single JSON-RPC endpoint ------------------------------------------

mcpRouter.post("/", requireIngestionKey, mcpLimiter, async (req, res, next) => {
  try {
    const tenantId = req.ingestionKey!.tenantId;
    const body = req.body as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      // Batch requests are intentionally unsupported; one call per request.
      res.json(rpcError(null, { code: INVALID_REQUEST, message: "expected a single JSON-RPC request object" }));
      return;
    }
    const msg = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      res.json(rpcError(msg.id, { code: INVALID_REQUEST, message: "not a valid JSON-RPC 2.0 request" }));
      return;
    }

    switch (msg.method) {
      case "initialize": {
        res.json(
          rpcResult(msg.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          }),
        );
        return;
      }
      case "tools/list": {
        res.json(rpcResult(msg.id, { tools: TOOLS }));
        return;
      }
      case "tools/call": {
        const params = msg.params as { name?: unknown; arguments?: unknown } | undefined;
        if (!params || typeof params.name !== "string") {
          res.json(rpcError(msg.id, { code: INVALID_PARAMS, message: "tools/call requires a tool name" }));
          return;
        }
        const result = await dispatchToolCall(tenantId, params.name, params.arguments ?? {});
        res.json(rpcResult(msg.id, result));
        return;
      }
      case "ping": {
        res.json(rpcResult(msg.id, {}));
        return;
      }
      default: {
        res.json(rpcError(msg.id, { code: METHOD_NOT_FOUND, message: "unknown method: " + msg.method }));
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    const id = (req.body as { id?: unknown } | undefined)?.id ?? null;
    if (!res.headersSent) {
      res.json(rpcError(id, { code: INTERNAL_ERROR, message }));
      return;
    }
    next(err);
  }
});
