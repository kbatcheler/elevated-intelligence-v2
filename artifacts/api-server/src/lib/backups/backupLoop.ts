import { exportLedgerArchive, type LedgerArchiveLogger } from "./ledgerArchive";

// The scheduled backup loop (Phase U). It mirrors the retention purge and the
// alert notifier loops exactly: started ONLY from the server entrypoint, never
// from app.ts, so importing the app in a test never starts a timer. Each tick
// archives the provenance ledger (skipping honestly when nothing changed); a tick
// failure is logged and never crashes the loop; ticks never overlap; the timer is
// unref'd so it does not keep the process alive on its own.

const DEFAULT_ARCHIVE_INTERVAL_MS = 12 * 60 * 60 * 1000;

function numEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getBackupArchiveIntervalMs(): number {
  return numEnv(process.env.BACKUP_ARCHIVE_INTERVAL_MS, DEFAULT_ARCHIVE_INTERVAL_MS);
}

export interface BackupSchedulerHandle {
  stop(): void;
}

export function startBackupArchive(
  log: LedgerArchiveLogger,
  options: { intervalMs?: number } = {},
): BackupSchedulerHandle {
  const intervalMs = options.intervalMs ?? getBackupArchiveIntervalMs();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await exportLedgerArchive({ now: new Date(), authority: { userId: null, role: "system" }, log });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "backup archive tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
