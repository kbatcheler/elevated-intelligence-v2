import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDescriptor } from "@workspace/connectors";
import { connectorsTable, db, tenantConnectionsTable, tenantsTable } from "@workspace/db";
import type { AlertEvent } from "../alerts/alerter";
import {
  NotImplementedTokenRefresher,
  type RefreshLogger,
  type TokenRefresher,
  runDueOAuthRefreshes,
} from "./oauthRefresh";

// The scheduler persists real rows, so this runs against a real database. A
// throwaway tenant owns everything; deleting it cascades to its connections, so
// the suite is safe to run repeatedly. No live OAuth provider is touched: an
// injected refresher stands in for the renewal, exactly the seam the scheduler
// is built around. runDueOAuthRefreshes scans connected connections globally, so
// every assertion is scoped to the specific connection under test.
const RUN = `oauth-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const log: RefreshLogger = { info() {}, error() {} };

function capturing(): { events: AlertEvent[]; alerter: { emit: (e: AlertEvent) => Promise<void> } } {
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

// A refresher that throws if reached. Used to prove a non-oauth or not-due
// connection is never handed to a renewal.
const failIfCalled: TokenRefresher = {
  refresh: () => Promise.reject(new Error("refresher should not have been called")),
};

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

let tenantId = "";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function newConnection(opts: {
  connectorKey: string;
  tokenExpiresAt: Date | null;
  status?: "connected" | "error";
}): Promise<string> {
  const rows = await db
    .insert(tenantConnectionsTable)
    .values({
      tenantId,
      connectorKey: opts.connectorKey,
      status: opts.status ?? "connected",
      authRef: "TEST_OAUTH_REF",
      deploymentMode: getDescriptor(opts.connectorKey)!.deployment,
      tokenExpiresAt: opts.tokenExpiresAt,
    })
    .returning({ id: tenantConnectionsTable.id });
  return rows[0]!.id;
}

beforeAll(async () => {
  await ensureConnectorRow("salesforce"); // oauth2
  await ensureConnectorRow("redshift"); // warehouseCredential (not oauth2)
  const t = await db
    .insert(tenantsTable)
    .values({ name: RUN, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantId = t[0]!.id;
});

afterAll(async () => {
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("OAuth refresh scheduler", () => {
  it("renews a token inside its lead window, clearing any prior error", async () => {
    const now = new Date();
    const connId = await newConnection({
      connectorKey: "salesforce",
      tokenExpiresAt: new Date(now.getTime() + 30 * MINUTE), // within the 1h lead
    });
    const renewedExpiry = new Date(now.getTime() + 30 * DAY);
    const { events, alerter } = capturing();

    const outcomes = await runDueOAuthRefreshes({
      now,
      refresher: { refresh: () => Promise.resolve({ tokenExpiresAt: renewedExpiry }) },
      alerter,
      log,
    });

    const mine = outcomes.find((o) => o.connectionId === connId);
    expect(mine?.status).toBe("renewed");

    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("connected");
    expect(conn[0]!.tokenExpiresAt?.getTime()).toBe(renewedExpiry.getTime());
    expect(conn[0]!.lastErrorCode).toBeNull();

    // A clean renewal raises no alert for this connection.
    expect(events.filter((e) => e.entityId === connId)).toHaveLength(0);
  });

  it("flips a connection to error and alerts when a renewal fails", async () => {
    const now = new Date();
    const connId = await newConnection({
      connectorKey: "salesforce",
      tokenExpiresAt: new Date(now.getTime() + 10 * MINUTE),
    });
    const { events, alerter } = capturing();

    const outcomes = await runDueOAuthRefreshes({
      now,
      refresher: { refresh: () => Promise.reject(new Error("refresh token expired")) },
      alerter,
      log,
    });

    const mine = outcomes.find((o) => o.connectionId === connId);
    expect(mine?.status).toBe("failed");

    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("error");
    expect(conn[0]!.lastErrorCode).toBe("reauthentication_required");
    expect(conn[0]!.lastErrorMessage).toBeTruthy();

    const alerts = events.filter((e) => e.entityId === connId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("oauth_refresh_failed");
    expect(alerts[0]!.severity).toBe("critical");
  });

  it("leaves a token that is not yet inside its lead window untouched", async () => {
    const now = new Date();
    const farExpiry = new Date(now.getTime() + 10 * DAY);
    const connId = await newConnection({ connectorKey: "salesforce", tokenExpiresAt: farExpiry });
    const { events, alerter } = capturing();

    const outcomes = await runDueOAuthRefreshes({ now, refresher: failIfCalled, alerter, log });

    expect(outcomes.find((o) => o.connectionId === connId)).toBeUndefined();
    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("connected");
    expect(conn[0]!.tokenExpiresAt?.getTime()).toBe(farExpiry.getTime());
    expect(events.filter((e) => e.entityId === connId)).toHaveLength(0);
  });

  it("never refreshes a non-oauth connection, even with a token expiry set", async () => {
    const now = new Date();
    const connId = await newConnection({
      connectorKey: "redshift", // warehouseCredential, not oauth2
      tokenExpiresAt: new Date(now.getTime() + 5 * MINUTE),
    });

    const outcomes = await runDueOAuthRefreshes({
      now,
      refresher: failIfCalled, // throws if reached; proves redshift is skipped
      alerter: capturing().alerter,
      log,
    });

    expect(outcomes.find((o) => o.connectionId === connId)).toBeUndefined();
    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("connected");
  });

  it("treats the default not-implemented refresher as an honest failed renewal", async () => {
    const now = new Date();
    const connId = await newConnection({
      connectorKey: "salesforce",
      tokenExpiresAt: new Date(now.getTime() + 10 * MINUTE),
    });
    const { events, alerter } = capturing();

    const outcomes = await runDueOAuthRefreshes({
      now,
      refresher: new NotImplementedTokenRefresher(),
      alerter,
      log,
    });

    const mine = outcomes.find((o) => o.connectionId === connId);
    expect(mine?.status).toBe("failed");
    expect(mine?.reason).toContain("available, not connected");

    const conn = await db
      .select()
      .from(tenantConnectionsTable)
      .where(eq(tenantConnectionsTable.id, connId));
    expect(conn[0]!.status).toBe("error");
    expect(conn[0]!.lastErrorCode).toBe("reauthentication_required");
    expect(events.filter((e) => e.entityId === connId)).toHaveLength(1);
  });
});
