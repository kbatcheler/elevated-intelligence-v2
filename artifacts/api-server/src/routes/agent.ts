import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { assertDerivedSignalSet, getDescriptor } from "@workspace/connectors";
import { connectorRunsTable, db, tenantConnectionsTable } from "@workspace/db";
import {
  persistDerivedSignalSet,
  resolveConnectionLayers,
} from "../lib/connectors/persistSignals";
import { logger } from "../lib/logger";
import { requireAgent } from "../middleware/agentAuth";

// The surface the in-client extraction agent talks to. Every route here is gated
// by the per-tenant agent credential (requireAgent), never by a user session and
// never by a proxy-injected client certificate header. It is mounted under
// /api/agent ahead of the session gate so it has its own, separate trust root.
export const agentRouter: Router = Router();

agentRouter.use(requireAgent);

// Register: the agent announces itself and confirms its credential is live. It
// is the agent's first call after install. Identity is echoed back so the agent
// can log which tenant it is bound to; requireAgent has already refreshed
// lastSeenAt.
agentRouter.post("/register", (req, res) => {
  const agent = req.agent!;
  res.json({ ok: true, agentId: agent.id, tenantId: agent.tenantId, label: agent.label });
});

// Config pull: the connectors this agent is responsible for running. Only the
// tenant's connected, edge-deployed connectors are returned; boundary connectors
// run in our own runtime, not in the agent. authRef is a pointer the agent
// resolves against its own local secret store, never a secret value, and no
// secret ever crosses this response.
agentRouter.get("/config", async (req, res, next) => {
  try {
    const agent = req.agent!;
    const connections = await db
      .select()
      .from(tenantConnectionsTable)
      .where(
        and(
          eq(tenantConnectionsTable.tenantId, agent.tenantId),
          eq(tenantConnectionsTable.status, "connected"),
        ),
      );
    const connectors = [];
    for (const connection of connections) {
      const descriptor = getDescriptor(connection.connectorKey);
      if (!descriptor || descriptor.deployment !== "edge") continue;
      connectors.push({
        connectorKey: connection.connectorKey,
        authRef: connection.authRef,
        scopeConfig: connection.scopeConfig ?? null,
        layers: descriptor.layers,
        deployment: descriptor.deployment,
      });
    }
    res.json({ tenantId: agent.tenantId, connectors });
  } catch (err) {
    next(err);
  }
});

// Signal ingest: the agent posts a DerivedSignalSet it produced locally. This is
// the edge half of derive and discard. The set is validated as derived math (not
// raw records) before anything is written, it must belong to this agent's
// tenant, and it must name a connector the tenant has actually connected as an
// edge deployment. Persistence runs through the single shared path, so an edge
// ingest and an in-process boundary refresh obey the same guard and the same
// supersede semantics.
agentRouter.post("/signals", async (req, res, next) => {
  const agent = req.agent!;

  let source: string;
  try {
    const set = assertDerivedSignalSet(req.body);
    if (set.tenantId !== agent.tenantId) {
      res.status(403).json({ error: "tenant_mismatch" });
      return;
    }
    source = set.source;
  } catch (err) {
    res.status(400).json({
      error: "derive_and_discard_violation",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const connRows = await db
      .select()
      .from(tenantConnectionsTable)
      .where(
        and(
          eq(tenantConnectionsTable.tenantId, agent.tenantId),
          eq(tenantConnectionsTable.connectorKey, source),
          eq(tenantConnectionsTable.status, "connected"),
        ),
      )
      .limit(1);
    const connection = connRows[0];
    if (!connection) {
      res.status(409).json({ error: "no_connected_connection", connectorKey: source });
      return;
    }
    const descriptor = getDescriptor(source);
    if (!descriptor || descriptor.deployment !== "edge") {
      res.status(409).json({ error: "not_an_edge_connector", connectorKey: source });
      return;
    }

    // Open the run row before persisting so a crash still leaves an audit record.
    const inserted = await db
      .insert(connectorRunsTable)
      .values({ tenantConnectionId: connection.id, status: "running" })
      .returning({ id: connectorRunsTable.id });
    const runId = inserted[0]!.id;

    try {
      const persisted = await persistDerivedSignalSet({
        tenantId: agent.tenantId,
        connectorKey: source,
        set: req.body,
        layers: resolveConnectionLayers(source),
      });
      const now = new Date();
      await db
        .update(connectorRunsTable)
        .set({
          status: "success",
          finishedAt: now,
          signalsCount: persisted.signalsCount,
          provenanceRootHash: persisted.rootHash,
        })
        .where(eq(connectorRunsTable.id, runId));
      await db
        .update(tenantConnectionsTable)
        .set({ lastRunAt: now })
        .where(eq(tenantConnectionsTable.id, connection.id));
      res.status(202).json({
        ok: true,
        runId,
        signalsCount: persisted.signalsCount,
        provenanceRootHash: persisted.rootHash,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(connectorRunsTable)
        .set({ status: "error", finishedAt: new Date() })
        .where(eq(connectorRunsTable.id, runId));
      logger.error({ connectorKey: source, reason }, "agent signal ingest failed");
      res.status(400).json({ error: "ingest_failed", detail: reason });
    }
  } catch (err) {
    next(err);
  }
});
