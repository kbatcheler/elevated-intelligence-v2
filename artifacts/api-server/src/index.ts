import app from "./app";
import { startAlertNotifier } from "./lib/alerts/notifier";
import { ensureProviderOrgAndOwner } from "./lib/auth/bootstrap";
import { startConnectorMaintenance } from "./lib/connectors/oauthRefresh";
import { logger } from "./lib/logger";

const port = Number(process.env.PORT ?? "3001");

if (Number.isNaN(port) || port <= 0) {
  throw new Error('Invalid PORT value: "' + process.env.PORT + '"');
}

// Guarantee a way in before accepting traffic. Bootstrap is idempotent and
// log-and-continue: a missing secret or DB hiccup must not stop the server from
// serving the rest of the API.
async function start(): Promise<void> {
  try {
    await ensureProviderOrgAndOwner();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err: message }, "owner bootstrap failed");
  }

  app.listen(port, () => {
    logger.info({ port }, "api-server listening");
  });

  // Start the in-process connector maintenance loop (OAuth token renewal). Only
  // here in the entrypoint, never in app.ts, so importing the app in tests does
  // not start a background timer.
  startConnectorMaintenance(logger);

  // Start the in-process alert notifier drainer (Phase P). It consumes the alert
  // seam, delivering each pending alert_events row to the env-configured sink
  // exactly once. Like the maintenance loop, started only here so importing the
  // app in tests never starts a timer.
  startAlertNotifier(logger);
}

void start();
