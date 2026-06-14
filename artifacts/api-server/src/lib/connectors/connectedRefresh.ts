import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  getConnector as defaultGetConnector,
  getDescriptor,
  guardedExtractSignals,
  isImplemented,
} from "@workspace/connectors";
import type { Connector, ConnectorContext, ExtractionScope } from "@workspace/connectors";
import type { Logger } from "@workspace/cortex";
import { connectorRunsTable, db, tenantConnectionsTable } from "@workspace/db";
import type { TenantConnection } from "@workspace/db";
import { getSecretStore, type SecretStore } from "../secrets/secretStore";
import { persistDerivedSignalSet, resolveConnectionLayers } from "./persistSignals";

// The boundary runtime from Part 3, Tier 1 of the connectors spec. It refreshes
// every connected, boundary-deployed connector for a tenant in process: it runs
// extractSignals inside our deployment boundary on the client's read-only
// credential, derives only math, and persists it through the shared path. The
// raw extraction never touches disk or our database; it is discarded when each
// run returns. Edge connectors are not run here. Their extraction runs inside
// the in-client agent, and their signals arrive through the ingestion route.

export type ConnectionRefreshStatus = "refreshed" | "skipped_edge" | "error";

export interface ConnectionRefreshResult {
  connectorKey: string;
  deployment: "edge" | "boundary";
  status: ConnectionRefreshStatus;
  signalsCount?: number;
  reason?: string;
}

// Injection seams so the service is testable without a live warehouse. Tests
// supply a stub connector; production uses the registry's getConnector, which
// throws an honest "available, not connected" for a declared-only key.
export interface ConnectedRefreshDeps {
  getConnector?: (key: string) => Connector;
  secretStore?: SecretStore;
  now?: () => Date;
}

// Build the capabilities an extraction is given: a secret resolver, a stable
// non-reversible tokenizer, a clock, and a log sink. There is deliberately no
// database handle and no filesystem capability on this context, so a connector
// cannot persist anything. The token is a one-way HMAC keyed by a per-deployment
// salt, so our store can never reverse a token back to the original identifier.
function buildConnectorContext(
  secretStore: SecretStore,
  tokenSalt: string,
  now: () => Date,
  log: Logger,
): ConnectorContext {
  return {
    resolveSecret: async (ref: string) => {
      const value = await secretStore.get(ref);
      if (value === null || value === "") {
        throw new Error(
          'Required secret "' + ref + '" is not configured. Set it as an environment secret.',
        );
      }
      return value;
    },
    tokenize: (value: string) => createHmac("sha256", tokenSalt).update(value).digest("hex").slice(0, 32),
    now,
    log: (event, fields) => log.info({ event, ...(fields ?? {}) }, "connector"),
  };
}

export async function refreshConnectedTenant(
  tenantId: string,
  log: Logger,
  deps: ConnectedRefreshDeps = {},
): Promise<ConnectionRefreshResult[]> {
  const getConnector = deps.getConnector ?? defaultGetConnector;
  const secretStore = deps.secretStore ?? getSecretStore();
  const now = deps.now ?? (() => new Date());

  // Resolve a token salt once per refresh. SESSION_SECRET is read through the
  // secret store, never process.env at the call site; a fixed fallback keeps the
  // tokenizer non-reversible even where it is unset.
  const tokenSalt =
    (await secretStore.get("SESSION_SECRET")) ?? "ei-v2-derived-signal-token-salt";

  const connections = await db
    .select()
    .from(tenantConnectionsTable)
    .where(
      and(
        eq(tenantConnectionsTable.tenantId, tenantId),
        eq(tenantConnectionsTable.status, "connected"),
      ),
    );

  const results: ConnectionRefreshResult[] = [];
  for (const connection of connections) {
    results.push(
      await refreshOneConnection(connection, {
        getConnector,
        secretStore,
        tokenSalt,
        now,
        log,
      }),
    );
  }
  return results;
}

interface RefreshOneCtx {
  getConnector: (key: string) => Connector;
  secretStore: SecretStore;
  tokenSalt: string;
  now: () => Date;
  log: Logger;
}

async function refreshOneConnection(
  connection: TenantConnection,
  ctx: RefreshOneCtx,
): Promise<ConnectionRefreshResult> {
  const connectorKey = connection.connectorKey;
  const descriptor = getDescriptor(connectorKey);
  if (!descriptor) {
    return { connectorKey, deployment: "boundary", status: "error", reason: "unknown connector" };
  }
  const deployment = descriptor.deployment;

  // Edge connectors run inside the in-client agent, never in process. Their
  // signals arrive through the ingestion route, so the refresh leaves them be.
  if (deployment === "edge") {
    return { connectorKey, deployment, status: "skipped_edge" };
  }

  // A boundary connector whose runtime is not implemented is reported honestly
  // as "available, not connected". We never return a stub set that fakes data.
  if (!isImplemented(connectorKey)) {
    return {
      connectorKey,
      deployment,
      status: "error",
      reason: "available, not connected: its runtime is not implemented yet",
    };
  }

  if (!connection.authRef) {
    return {
      connectorKey,
      deployment,
      status: "error",
      reason: "connection has no auth reference; cannot resolve its credential",
    };
  }

  // Open the run row before extraction so a crash still leaves an audit record.
  const inserted = await db
    .insert(connectorRunsTable)
    .values({ tenantConnectionId: connection.id, status: "running" })
    .returning({ id: connectorRunsTable.id });
  const runId = inserted[0]!.id;

  try {
    const connector = ctx.getConnector(connectorKey);
    const scope: ExtractionScope = {
      tenantId: connection.tenantId,
      connectorKey,
      authRef: connection.authRef,
      config:
        connection.scopeConfig === null
          ? undefined
          : (connection.scopeConfig as Record<string, unknown>),
    };
    const connectorCtx = buildConnectorContext(ctx.secretStore, ctx.tokenSalt, ctx.now, ctx.log);

    // The raw extraction lives only for the duration of this call. Its output is
    // a de-identified DerivedSignalSet; the raw data is discarded on return. The
    // guard blocks any filesystem write during extraction and asserts the result
    // is derive-and-discard math before we persist it.
    const set = await guardedExtractSignals(connector, scope, connectorCtx);

    const persisted = await persistDerivedSignalSet({
      tenantId: connection.tenantId,
      connectorKey,
      set,
      layers: resolveConnectionLayers(connectorKey),
      computedAt: ctx.now(),
    });

    await db
      .update(connectorRunsTable)
      .set({
        status: "success",
        finishedAt: ctx.now(),
        signalsCount: persisted.signalsCount,
        provenanceRootHash: persisted.rootHash,
      })
      .where(eq(connectorRunsTable.id, runId));

    await db
      .update(tenantConnectionsTable)
      .set({ lastRunAt: ctx.now() })
      .where(eq(tenantConnectionsTable.id, connection.id));

    return { connectorKey, deployment, status: "refreshed", signalsCount: persisted.signalsCount };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(connectorRunsTable)
      .set({ status: "error", finishedAt: ctx.now() })
      .where(eq(connectorRunsTable.id, runId));
    ctx.log.error({ connectorKey, reason }, "connector refresh failed");
    return { connectorKey, deployment, status: "error", reason };
  }
}
