import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDescriptor } from "@workspace/connectors";
import type { Connector, DerivedSignalSet, ExtractionScope } from "@workspace/connectors";
import type { ConnectorContext } from "@workspace/connectors";
import type { Logger } from "@workspace/cortex";
import {
  connectorRunsTable,
  connectorsTable,
  db,
  derivedSignalsTable,
  tenantConnectionsTable,
  tenantsTable,
} from "@workspace/db";
import { refreshConnectedTenant } from "../connectors/connectedRefresh";
import type { SecretStore } from "./secretStore";

// Phase Q acceptance: a connection authenticates by resolving its authRef through
// the SecretStore, and the resolved secret value is never persisted. This runs
// against a real database with a throwaway tenant; a stub boundary connector
// stands in for extraction and actually calls ctx.resolveSecret(scope.authRef),
// which is the real credential seam, then returns only math. We then sweep the
// rows this refresh wrote for the sentinel secret value and assert it is absent:
// the database holds the reference, never the value behind it.
const RUN = `secret-accept-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const AUTH_REF = "ACCEPT_WAREHOUSE_REF";
const SENTINEL = `ei-q-acceptance-sentinel-${Math.floor(Math.random() * 1e9)}`;

const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return log;
  },
} as unknown as Logger;

// A SecretStore that returns the sentinel only for the connection's authRef and
// records every ref it is asked to resolve, so the test can prove the runtime
// authenticated through the store rather than through process.env at the callsite.
const requested: string[] = [];
const recordingStore: SecretStore = {
  async get(ref: string) {
    requested.push(ref);
    if (ref === AUTH_REF) return SENTINEL;
    if (ref === "SESSION_SECRET") return "acceptance-token-salt";
    return null;
  },
  async set() {},
  async delete() {},
};

let resolvedCred: string | null = null;

function resolvingConnector(key: string, set: DerivedSignalSet): Connector {
  const d = getDescriptor(key)!;
  return {
    key: d.key,
    family: d.family,
    layers: d.layers,
    authMethod: d.authMethod,
    deployment: d.deployment,
    signalsProduced: d.signalsProduced,
    async extractSignals(scope: ExtractionScope, ctx: ConnectorContext) {
      // The connector authenticates by resolving its authRef through the store,
      // exactly as the real warehouse runtime does, then returns only math.
      resolvedCred = await ctx.resolveSecret(scope.authRef);
      return set;
    },
  };
}

// Walk up from the test's working directory to find the repo-root .replit so the
// sweep can prove the sentinel is not parked in deployment config either.
function findReplit(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".replit");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const createdTenantIds: string[] = [];
let tenantId = "";
let connectionId = "";

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

  const tenantRows = await db
    .insert(tenantsTable)
    .values({ name: RUN, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantId = tenantRows[0]!.id;
  createdTenantIds.push(tenantId);

  const connRows = await db
    .insert(tenantConnectionsTable)
    .values({
      tenantId,
      connectorKey: "redshift",
      status: "connected",
      authRef: AUTH_REF,
      scopeConfig: { measures: [] },
      deploymentMode: "boundary",
    })
    .returning({ id: tenantConnectionsTable.id });
  connectionId = connRows[0]!.id;
});

afterAll(async () => {
  for (const id of createdTenantIds) {
    if (id) await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
});

describe("Phase Q acceptance: authRef resolves through the SecretStore", () => {
  it("authenticates a connection by resolving its authRef and never persists the secret value", async () => {
    const set: DerivedSignalSet = {
      source: "redshift",
      tenantId,
      generatedAt: new Date().toISOString(),
      signals: [{ key: "win_rate_pct", kind: "ratio", value: 0.5, window: "P30D", unit: "ratio" }],
    };

    const results = await refreshConnectedTenant(tenantId, log, {
      getConnector: (key) => resolvingConnector(key, set),
      secretStore: recordingStore,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("refreshed");

    // The connection authenticated by resolving its authRef through the store.
    expect(requested).toContain(AUTH_REF);
    expect(resolvedCred).toBe(SENTINEL);

    // The database stores the reference, not the resolved secret value.
    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connectionId));
    expect(conn[0]!.authRef).toBe(AUTH_REF);
    expect(JSON.stringify(conn)).not.toContain(SENTINEL);

    // Neither the run audit rows nor the derived signals carry the secret value.
    const runs = await db
      .select()
      .from(connectorRunsTable)
      .where(eq(connectorRunsTable.tenantConnectionId, connectionId));
    expect(runs.length).toBeGreaterThan(0);
    expect(JSON.stringify(runs)).not.toContain(SENTINEL);

    const signals = await db
      .select()
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantId));
    expect(signals.length).toBeGreaterThan(0);
    expect(JSON.stringify(signals)).not.toContain(SENTINEL);

    // Criterion (c), the strong form: scan EVERY text-like and jsonb column in
    // the public schema for the sentinel, not just the rows this refresh wrote.
    // The sentinel is a unique stand-in for a real secret value; if the system
    // ever persisted a resolved secret anywhere, this finds it. Refs, password
    // hashes, wrapped DEKs, and local KMS material are not this value, so they
    // are correctly absent from the count.
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

    // The sentinel is our own generated [a-z0-9-] string, safe to inline; table
    // and column identifiers come from the catalog and are double-quoted.
    const probes = columnRows.map(
      (c) =>
        `SELECT count(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}"::text LIKE '%${SENTINEL}%'`,
    );
    const sweep = await db.execute(
      sql.raw(`SELECT COALESCE(SUM(n), 0)::int AS total FROM (${probes.join(" UNION ALL ")}) s`),
    );
    const total = Number((sweep.rows as Array<{ total: number }>)[0]!.total);
    expect(total).toBe(0);

    // And the secret value is not parked in deployment config (.replit).
    const replitPath = findReplit(process.cwd());
    expect(replitPath).not.toBeNull();
    expect(readFileSync(replitPath!, "utf8")).not.toContain(SENTINEL);
  });
});
