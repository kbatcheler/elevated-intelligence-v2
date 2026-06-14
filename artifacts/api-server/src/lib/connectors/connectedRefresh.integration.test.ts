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
  isEncryptedSignalEnvelope,
  tenantConnectionsTable,
  tenantsTable,
} from "@workspace/db";
import type { AlertEvent } from "../alerts/alerter";
import { EnvSecretStore } from "../secrets/secretStore";
import { decryptSignalValue } from "../security/signalCrypto";
import { getTenantKey } from "../security/tenantKeyService";
import { refreshConnectedTenant } from "./connectedRefresh";
import { ConnectorThrottleError, resetRateLimiter } from "./rateLimiter";

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
const noopSleep = (): Promise<void> => Promise.resolve();

function capturingAlerter(): {
  events: AlertEvent[];
  alerter: { emit: (e: AlertEvent) => Promise<void> };
} {
  const events: AlertEvent[] = [];
  return {
    events,
    alerter: {
      emit: (e: AlertEvent) => {
        events.push(e);
        return Promise.resolve();
      },
    },
  };
}

const createdTenantIds: string[] = [];
let tenantA = "";
let tenantB = "";
let connectionA = "";

// A stub boundary connector. With no cursor it returns the bare set form; with a
// cursor it returns the wrapper form, so the runtime's incremental handling is
// exercised through the real ExtractionResult union.
function stubConnector(key: string, set: unknown, nextWatermark?: string): Connector {
  const descriptor = getDescriptor(key)!;
  return {
    key: descriptor.key,
    family: descriptor.family,
    layers: descriptor.layers,
    authMethod: descriptor.authMethod,
    deployment: descriptor.deployment,
    signalsProduced: descriptor.signalsProduced,
    async extractSignals() {
      if (nextWatermark !== undefined) return { set: set as DerivedSignalSet, nextWatermark };
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

async function newTenant(): Promise<string> {
  const i = createdTenantIds.length;
  const rows = await db
    .insert(tenantsTable)
    .values({ name: `${RUN}-t${i}`, url: `https://${RUN}-t${i}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  const id = rows[0]!.id;
  createdTenantIds.push(id);
  return id;
}

async function newRedshiftConnection(tenantId: string): Promise<string> {
  const rows = await db
    .insert(tenantConnectionsTable)
    .values({
      tenantId,
      connectorKey: "redshift",
      status: "connected",
      authRef: "TEST_WAREHOUSE_REF",
      scopeConfig: { measures: [] },
      deploymentMode: "boundary",
    })
    .returning({ id: tenantConnectionsTable.id });
  return rows[0]!.id;
}

beforeAll(async () => {
  await ensureConnectorRow("redshift");
  await ensureConnectorRow("salesforce");
  await ensureConnectorRow("netsuite");

  tenantA = await newTenant();
  tenantB = await newTenant();
  connectionA = await newRedshiftConnection(tenantA);

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
  for (const id of createdTenantIds) {
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
    // Only math is stored, and it is stored encrypted: each value is an envelope
    // on disk, and decrypting under the tenant key recovers the numeric scalar
    // and numeric vector, nothing else.
    const tenantKey = await getTenantKey(tenantA);
    expect(tenantKey?.status).toBe("active");
    const activeKeyRef = tenantKey!.kmsKeyRef;
    const margin = signals.find((s) => s.signalKey === "gross_margin_pct")!;
    expect(isEncryptedSignalEnvelope(margin.value)).toBe(true);
    expect(await decryptSignalValue(margin.value, activeKeyRef)).toBe(0.42);
    const dist = signals.find((s) => s.signalKey === "status_distribution")!;
    expect(isEncryptedSignalEnvelope(dist.value)).toBe(true);
    expect(await decryptSignalValue(dist.value, activeKeyRef)).toEqual([3, 5, 2]);

    const connection = await db
      .select({
        lastRunAt: tenantConnectionsTable.lastRunAt,
        lastSuccessAt: tenantConnectionsTable.lastSuccessAt,
        status: tenantConnectionsTable.status,
      })
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connectionA));
    expect(connection[0]!.lastRunAt).not.toBeNull();
    // A success records lastSuccessAt (which drives read-time health) and keeps
    // the connection connected.
    expect(connection[0]!.lastSuccessAt).not.toBeNull();
    expect(connection[0]!.status).toBe("connected");
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

describe("connected refresh: operational reality (Phase O)", () => {
  it("retries a throttled source with capped backoff and recovers without failing the run", async () => {
    resetRateLimiter();
    const tenant = await newTenant();
    await newRedshiftConnection(tenant);
    const set = validSet(tenant, [{ key: "win_rate_pct", kind: "ratio", value: 0.5 }]);

    // The source throttles once, then succeeds: the run must recover, not fail.
    let calls = 0;
    const flaky = (key: string): Connector => {
      const base = stubConnector(key, set);
      return {
        ...base,
        extractSignals() {
          calls += 1;
          if (calls < 2) throw new ConnectorThrottleError("429");
          return Promise.resolve(set);
        },
      };
    };

    const { events, alerter } = capturingAlerter();
    const results = await refreshConnectedTenant(tenant, log, {
      getConnector: flaky,
      secretStore,
      alerter,
      sleep: noopSleep,
    });

    expect(results[0]!.status).toBe("refreshed");
    expect(calls).toBe(2); // threw once, then succeeded on retry
    expect(events).toHaveLength(0); // a recovered run fires no alert
  });

  it("flips a dead connection to error and fires exactly one transition alert", async () => {
    resetRateLimiter();
    const tenant = await newTenant();
    const connId = await newRedshiftConnection(tenant);
    const set = validSet(tenant, [{ key: "win_rate_pct", kind: "ratio", value: 0.5 }]);

    const dead = (key: string): Connector => {
      const base = stubConnector(key, set);
      return {
        ...base,
        extractSignals() {
          throw new Error("warehouse connection refused");
        },
      };
    };

    const { events, alerter } = capturingAlerter();
    const results = await refreshConnectedTenant(tenant, log, {
      getConnector: dead,
      secretStore,
      alerter,
      sleep: noopSleep,
    });
    expect(results[0]!.status).toBe("error");

    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("error");
    expect(conn[0]!.lastErrorCode).toBe("extraction_failed");
    expect(conn[0]!.lastErrorAt).not.toBeNull();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("connector_error_transition");
    expect(events[0]!.entityId).toBe(connId);

    // A second failing refresh does not re-alert: the connection is already error.
    const second = capturingAlerter();
    await refreshConnectedTenant(tenant, log, {
      getConnector: dead,
      secretStore,
      alerter: second.alerter,
      sleep: noopSleep,
    });
    expect(second.events).toHaveLength(0);
  });

  it("persists only the watermark for an incremental source, never the data behind it", async () => {
    resetRateLimiter();
    const tenant = await newTenant();
    const connId = await newRedshiftConnection(tenant);

    // Exercise the incremental seam by declaring the descriptor supports a cursor
    // for the duration of this test, then restoring it. The runtime persists only
    // the returned cursor, never any source data.
    const descriptor = getDescriptor("redshift")!;
    const savedIncremental = descriptor.incremental;
    descriptor.incremental = { supported: true, mode: "watermark" };
    try {
      const set = validSet(tenant, [{ key: "win_rate_pct", kind: "ratio", value: 0.5 }]);
      const results = await refreshConnectedTenant(tenant, log, {
        getConnector: (key) => stubConnector(key, set, "2026-06-14T08:00:00.000Z"),
        secretStore,
        sleep: noopSleep,
      });
      expect(results[0]!.status).toBe("refreshed");

      const conn = await db
        .select({ cursorWatermark: tenantConnectionsTable.cursorWatermark })
        .from(tenantConnectionsTable)
        .where(eq(tenantConnectionsTable.id, connId));
      expect(conn[0]!.cursorWatermark).toBe("2026-06-14T08:00:00.000Z");
    } finally {
      descriptor.incremental = savedIncremental;
    }
  });

  it("ignores a returned cursor when the source does not declare incremental support", async () => {
    resetRateLimiter();
    const tenant = await newTenant();
    const connId = await newRedshiftConnection(tenant);
    // redshift declares incremental unsupported, so a returned cursor is dropped
    // and the refresh stays a full derive.
    const set = validSet(tenant, [{ key: "win_rate_pct", kind: "ratio", value: 0.5 }]);
    await refreshConnectedTenant(tenant, log, {
      getConnector: (key) => stubConnector(key, set, "2026-06-14T09:00:00.000Z"),
      secretStore,
      sleep: noopSleep,
    });

    const conn = await db
      .select({ cursorWatermark: tenantConnectionsTable.cursorWatermark })
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.cursorWatermark).toBeNull();
  });
});
