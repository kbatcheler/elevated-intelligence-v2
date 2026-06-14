import { and, eq, isNotNull } from "drizzle-orm";
import { getDescriptor } from "@workspace/connectors";
import { db, tenantConnectionsTable } from "@workspace/db";
import type { InsertTenantConnection, TenantConnection } from "@workspace/db";
import { type Alerter, getAlerter } from "../alerts/alerter";

// OAuth token refresh (Phase O). An oauth2 connection's access token expires; the
// scheduler renews it before expiry without a human in the loop. There is no
// oauth2 connector RUNTIME in the system yet (every oauth2 connector is declared
// "available, not connected"), so the default refresher honestly reports that a
// renewal is not implemented. The scheduler is therefore proven with an injected
// refresher in tests, exactly as the edge agent and boundary runtime are proven
// with injected stubs. When a real oauth2 runtime exists it implements
// TokenRefresher and is wired here; nothing else in this module changes.

// A minimal log sink. Kept local so this module works with the server's small
// logger as well as the richer cortex logger; both satisfy it structurally.
export interface RefreshLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

// What a successful renewal yields: the new expiry, and an optional rotated
// credential reference (when the provider rotates the stored secret's handle).
export interface TokenRefreshResult {
  tokenExpiresAt: Date;
  authRef?: string;
}

export interface TokenRefresher {
  refresh(connection: TenantConnection): Promise<TokenRefreshResult>;
}

// The default refresher. No oauth2 runtime is connected, so a renewal cannot be
// performed; this throws honestly rather than faking a new expiry. The scheduler
// treats the throw as a failed refresh: the connection is flipped to error with
// "re-authentication required" and an alert is raised.
export class NotImplementedTokenRefresher implements TokenRefresher {
  refresh(connection: TenantConnection): Promise<TokenRefreshResult> {
    return Promise.reject(
      new Error(
        'available, not connected: no OAuth refresh runtime for connector "' +
          connection.connectorKey +
          '"',
      ),
    );
  }
}

export interface RunDueRefreshesDeps {
  now: Date;
  refresher: TokenRefresher;
  alerter: Alerter;
  log: RefreshLogger;
}

export interface OAuthRefreshOutcome {
  connectionId: string;
  connectorKey: string;
  status: "renewed" | "failed";
  reason?: string;
}

// Renew every connected oauth2 connection whose token is at or within its refresh
// lead window of expiry. Free of any timer: the caller supplies the clock and the
// dependencies, so this is exercised directly in tests and the interval is
// started only from the server entrypoint.
export async function runDueOAuthRefreshes(
  deps: RunDueRefreshesDeps,
): Promise<OAuthRefreshOutcome[]> {
  const nowMs = deps.now.getTime();

  // Candidate set: connected connections that have a token expiry recorded. The
  // per-connector lead time varies by descriptor, so the window is applied in
  // memory below rather than in SQL.
  const candidates = await db
    .select()
    .from(tenantConnectionsTable)
    .where(
      and(
        eq(tenantConnectionsTable.status, "connected"),
        isNotNull(tenantConnectionsTable.tokenExpiresAt),
      ),
    );

  const outcomes: OAuthRefreshOutcome[] = [];
  for (const connection of candidates) {
    const descriptor = getDescriptor(connection.connectorKey);
    if (!descriptor || descriptor.authMethod !== "oauth2") continue;
    if (!connection.tokenExpiresAt) continue;

    const dueAtMs = connection.tokenExpiresAt.getTime() - descriptor.oauthRefreshLeadSeconds * 1000;
    if (nowMs < dueAtMs) continue; // not yet inside the refresh window

    try {
      const result = await deps.refresher.refresh(connection);
      const update: Partial<InsertTenantConnection> = {
        tokenExpiresAt: result.tokenExpiresAt,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      };
      if (result.authRef) update.authRef = result.authRef;
      await db
        .update(tenantConnectionsTable)
        .set(update)
        .where(eq(tenantConnectionsTable.id, connection.id));
      deps.log.info(
        { connectorKey: connection.connectorKey, connectionId: connection.id },
        "oauth token renewed",
      );
      outcomes.push({
        connectionId: connection.id,
        connectorKey: connection.connectorKey,
        status: "renewed",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(tenantConnectionsTable)
        .set({
          status: "error",
          lastErrorCode: "reauthentication_required",
          lastErrorAt: deps.now,
          lastErrorMessage: reason,
        })
        .where(eq(tenantConnectionsTable.id, connection.id));
      deps.log.error(
        { connectorKey: connection.connectorKey, connectionId: connection.id, reason },
        "oauth token refresh failed",
      );

      // A failed renewal is a discrete, critical event that needs human re-auth.
      // Recording the alert is best-effort so it never masks the refresh failure.
      try {
        await deps.alerter.emit({
          type: "oauth_refresh_failed",
          severity: "critical",
          tenantId: connection.tenantId,
          connectorKey: connection.connectorKey,
          entityType: "connection",
          entityId: connection.id,
          message:
            'OAuth token refresh failed for "' +
            connection.connectorKey +
            '"; re-authentication required',
          details: { code: "reauthentication_required" },
        });
      } catch (alertErr) {
        const m = alertErr instanceof Error ? alertErr.message : String(alertErr);
        deps.log.error({ connectionId: connection.id, reason: m }, "failed to record oauth alert");
      }

      outcomes.push({
        connectionId: connection.id,
        connectorKey: connection.connectorKey,
        status: "failed",
        reason,
      });
    }
  }

  return outcomes;
}

export interface MaintenanceSchedulerHandle {
  stop(): void;
}

// Start the in-process maintenance loop. Called ONLY from the server entrypoint,
// never from app.ts, so importing the app in a test never starts a timer. Each
// tick renews due OAuth tokens with the default (not-implemented) refresher and
// the default alerter; a tick failure is logged and never crashes the loop. The
// timer is unref'd so it does not keep the process alive on its own.
export function startConnectorMaintenance(
  log: RefreshLogger,
  options: { intervalMs?: number } = {},
): MaintenanceSchedulerHandle {
  const intervalMs = options.intervalMs ?? 15 * 60 * 1000;
  const refresher = new NotImplementedTokenRefresher();
  const alerter = getAlerter();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await runDueOAuthRefreshes({ now: new Date(), refresher, alerter, log });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "connector maintenance tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
