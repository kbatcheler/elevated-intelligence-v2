import app from "./app";
import { startAlertNotifier } from "./lib/alerts/notifier";
import { ensureProviderOrgAndOwner } from "./lib/auth/bootstrap";
import { startBackupArchive } from "./lib/backups/backupLoop";
import { startBenchmarkRecompute } from "./lib/benchmarks/benchmarkLoop";
import { startConnectorMaintenance } from "./lib/connectors/oauthRefresh";
import { logger } from "./lib/logger";
import { startPushMorningBrief } from "./lib/push/pushBrief";
import { startRetentionPurge } from "./lib/retention/retention";

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

  // Start the in-process retention purge loop (Phase S). Each tick removes
  // derived signals past the configured TTL and audits what it removed. Started
  // only here so importing the app in tests never starts a timer.
  startRetentionPurge(logger);

  // Start the in-process backup archive loop (Phase U). Each tick exports the
  // provenance ledger to durable object storage, skipping honestly when nothing
  // changed. Started only here so importing the app in tests never starts a timer.
  startBackupArchive(logger);

  // Start the in-process benchmark recompute loop (Phase X). Each tick rebuilds
  // the opted-in cohorts and their percentile distributions from de-identified
  // math, never writing a stat below the k-anonymity floor. Started only here so
  // importing the app in tests never starts a timer.
  startBenchmarkRecompute(logger);

  // Start the in-process Morning Brief loop (Phase Z). Each tick evaluates the
  // push rules into recorded, ranked, idempotent events and drains the pending
  // ones to their channel as one digest per recipient. Started only here so
  // importing the app in tests never starts a timer.
  startPushMorningBrief(logger);
}

void start();
