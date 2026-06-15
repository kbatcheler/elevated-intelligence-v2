import {
  getBenchmarkMinCohort,
  getBenchmarkNoiseBand,
  getBenchmarkRecomputeIntervalMs,
  runBenchmarkRecompute,
  type BenchmarkLogger,
} from "./benchmarks";

// The scheduled benchmark recompute loop (Phase X). It mirrors the retention
// purge, the alert notifier, and the backup archive loops exactly: started ONLY
// from the server entrypoint, never from app.ts, so importing the app in a test
// never starts a timer. Each tick recomputes the cohorts and stats from the
// opted-in tenants' de-identified math; a tick failure is logged and never
// crashes the loop; ticks never overlap; the timer is unref'd so it does not keep
// the process alive on its own. The scheduler's authority is the system itself.

export interface BenchmarkSchedulerHandle {
  stop(): void;
}

export function startBenchmarkRecompute(
  log: BenchmarkLogger,
  options: { intervalMs?: number } = {},
): BenchmarkSchedulerHandle {
  const intervalMs = options.intervalMs ?? getBenchmarkRecomputeIntervalMs();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await runBenchmarkRecompute({
        now: new Date(),
        minCohort: getBenchmarkMinCohort(),
        noiseBand: getBenchmarkNoiseBand(),
        authority: { userId: null, role: "system" },
        log,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "benchmark recompute tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
