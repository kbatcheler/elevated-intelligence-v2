import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDescriptor } from "@workspace/connectors";
import type { Connector, DerivedSignalSet } from "@workspace/connectors";
import type { Logger } from "@workspace/cortex";
import {
  connectorRunsTable,
  connectorsTable,
  db,
  derivedSignalsTable,
  tenantConnectionsTable,
  tenantsTable,
} from "@workspace/db";
import { EnvSecretStore } from "../secrets/secretStore";
import { refreshConnectedTenant } from "./connectedRefresh";

// The boundary refresh persists real rows, so this runs against a real database.
// Throwaway tenants own everything; deleting them cascades to connections, runs
// and signals, so the suite is safe to run repeatedly. No live warehouse is
// touched: a stub connector stands in for the extraction, which is exactly the
// caller seam this service is built around (the connector returns math, the
// caller persists it).
const RUN = `refresh-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return log;
  },
} as unknown as Logger;

const secretStore = new EnvSecretStore();

let tenantA = "";
let tenantB = "";
let connectionA = "";

function stubConnector(key: string, set: unknown): Connector {
  const descriptor = getDescriptor(key)!;
  return {
    key: descriptor.key,
    family: descriptor.family,
    layers: descriptor.layers,
    authMethod: descriptor.authMethod,
    deployment: descriptor.deployment,
    signalsProduced: descriptor.signalsProduced,
    async extractSignals() {
      // Return the provided payload verbatim, including a deliberately invalid
      // one, so the caller's guard, not the connector, is what is under test.
      return set as DerivedSignalSet;
    },
  };
}

function validSet(tenantId: string, signals: DerivedSignalSet["signals"]): DerivedSignalSet {
  return {
    source: "redshift",
    tenantId,
    generatedAt: new Date().toISOString(),
    signals,
  };
}

async function ensureConnectorRow(key: string): Promise<void> {
  const d = getDescriptor(key)!;
  await db
    .insert(connectorsTable)
    .values({
      key: d.key,
      name: d.name,
      family: d.family,
      layers: d.layers,
      authMethod: d.authMethod,
      deployment: d.deployment,
      signalsProduced: d.signalsProduced,
      status: d.status,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  await ensureConnectorRow("redshift");
  await ensureConnectorRow("salesforce");
  await ensureConnectorRow("netsuite");

  const a = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-a`, url: `https://${RUN}-a.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantA = a[0]!.id;

  const b = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-b`, url: `https://${RUN}-b.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantB = b[0]!.id;

  const conn = await db
    .insert(tenantConnectionsTable)
    .values({
      tenantId: tenantA,
      connectorKey: "redshift",
      status: "connected",
      authRef: "TEST_WAREHOUSE_REF",
      scopeConfig: { measures: [] },
      deploymentMode: "boundary",
    })
    .returning({ id: tenantConnectionsTable.id });
  connectionA = conn[0]!.id;

  // Tenant B: one edge connection and one boundary-but-unimplemented connection,
  // to prove honest handling without ever reaching a real extraction.
  await db.insert(tenantConnectionsTable).values([
    {
      tenantId: tenantB,
      connectorKey: "salesforce",
      status: "connected",
      authRef: "TEST_EDGE_REF",
      deploymentMode: "edge",
    },
    {
      tenantId: tenantB,
      connectorKey: "netsuite",
      status: "connected",
      authRef: "TEST_BOUNDARY_REF",
      deploymentMode: "boundary",
    },
  ]);
});

afterAll(async () => {
  for (const id of [tenantA, tenantB]) {
    if (id) await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
});

describe("connected refresh: boundary runtime", () => {
  it("runs a connected boundary connector, fans signals across its layers, and records the run", async () => {
    const layerCount = getDescriptor("redshift")!.layers.length;
    const set = validSet(tenantA, [
      { key: "gross_margin_pct", kind: "ratio", value: 0.42, window: "P30D", unit: "ratio" },
      { key: "status_distribution", kind: "distribution", value: [3, 5, 2] },
    ]);

    const results = await refreshConnectedTenant(tenantA, log, {
      getConnector: (key) => stubConnector(key, set),
      secretStore,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      connectorKey: "redshift",
      deployment: "boundary",
      status: "refreshed",
      signalsCount: 2,
    });

    const runs = await db
      .select()
      .from(connectorRunsTable)
      .where(eq(connectorRunsTable.tenantConnectionId, connectionA));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("success");
    expect(runs[0]!.signalsCount).toBe(2);
    expect(runs[0]!.finishedAt).not.toBeNull();
    expect(runs[0]!.provenanceRootHash).toBeTruthy();

    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantA));
    // Two signals fanned across every layer the connector feeds.
    expect(signals).toHaveLength(2 * layerCount);
    expect(new Set(signals.map((s) => s.layerKey)).size).toBe(layerCount);
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(
      new Set(["gross_margin_pct", "status_distribution"]),
    );
    // Only math is stored: a numeric scalar and a numeric vector, nothing else.
    const margin = signals.find((s) => s.signalKey === "gross_margin_pct")!;
    expect(margin.value).toBe(0.42);
    const dist = signals.find((s) => s.signalKey === "status_distribution")!;
    expect(dist.value).toEqual([3, 5, 2]);

    const connection = await db
      .select({ lastRunAt: tenantConnectionsTable.lastRunAt })
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connectionA));
    expect(connection[0]!.lastRunAt).not.toBeNull();
  });

  it("supersedes the prior signals on the next refresh (ephemeral, latest only)", async () => {
    const layerCount = getDescriptor("redshift")!.layers.length;
    const set = validSet(tenantA, [{ key: "win_rate_pct", kind: "ratio", value: 0.27 }]);

    await refreshConnectedTenant(tenantA, log, {
      getConnector: (key) => stubConnector(key, set),
      secretStore,
    });

    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantA));
    // The previous two signals are gone; only the new one remains, fanned out.
    expect(signals).toHaveLength(1 * layerCount);
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(new Set(["win_rate_pct"]));
  });

  it("fails the run loudly when a connector returns raw content, writing nothing new", async () => {
    const layerCount = getDescriptor("redshift")!.layers.length;
    // A raw email in a value: rejected by the DerivedSignalSet guard.
    const rawSet = {
      source: "redshift",
      tenantId: tenantA,
      generatedAt: new Date().toISOString(),
      signals: [{ key: "leaked", kind: "score", value: "person@example.com" }],
    };

    const results = await refreshConnectedTenant(tenantA, log, {
      getConnector: (key) => stubConnector(key, rawSet),
      secretStore,
    });

    expect(results[0]!.status).toBe("error");
    expect(results[0]!.reason).toContain("derive-and-discard violation");

    const runs = await db
      .select()
      .from(connectorRunsTable)
      .where(eq(connectorRunsTable.tenantConnectionId, connectionA));
    // The latest run is the failed one, recorded as error.
    const latest = runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]!;
    expect(latest.status).toBe("error");

    // The prior good signals are untouched: the guard throws before any delete.
    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantA));
    expect(signals).toHaveLength(1 * layerCount);
    expect(new Set(signals.map((s) => s.signalKey))).toEqual(new Set(["win_rate_pct"]));
  });
});

describe("connected refresh: honest handling", () => {
  it("skips edge connectors and rejects declared-only boundary connectors honestly", async () => {
    const results = await refreshConnectedTenant(tenantB, log, { secretStore });

    const byKey = new Map(results.map((r) => [r.connectorKey, r]));

    const edge = byKey.get("salesforce")!;
    expect(edge.deployment).toBe("edge");
    expect(edge.status).toBe("skipped_edge");

    const boundary = byKey.get("netsuite")!;
    expect(boundary.deployment).toBe("boundary");
    expect(boundary.status).toBe("error");
    expect(boundary.reason).toContain("available, not connected");

    // No signals were written for tenant B: nothing was faked.
    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantB));
    expect(signals).toHaveLength(0);
  });
});
