import type { Logger } from "@workspace/cortex";
import { drainPendingPushEvents } from "./pushNotifier";
import { runPushEvaluation, type PushEvaluationLogger } from "./pushEvaluator";

// The scheduled Morning Brief loop (Phase Z). It mirrors the retention purge, the
// backup archive and the alert notifier loops exactly: started ONLY from the
// server entrypoint, never from app.ts, so importing the app in a test never
// starts a timer. Each tick first evaluates rules into recorded events, then
// drains the pending ones to their channels as one ranked digest per recipient.
// A tick failure is logged and never crashes the loop; ticks never overlap; the
// timer is unref'd so it does not keep the process alive on its own.

const DEFAULT_BRIEF_INTERVAL_MS = 12 * 60 * 60 * 1000;

function numEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPushMorningBriefIntervalMs(): number {
  return numEnv(process.env.PUSH_MORNING_BRIEF_INTERVAL_MS, DEFAULT_BRIEF_INTERVAL_MS);
}

export interface PushBriefSchedulerHandle {
  stop(): void;
}

export async function runPushMorningBrief(log: Logger): Promise<void> {
  const evalLog: PushEvaluationLogger = { info: (fields, msg) => log.info(fields, msg) };
  const evaluation = await runPushEvaluation({ now: new Date(), log: evalLog });
  const drain = await drainPendingPushEvents({ now: new Date() });
  if (evaluation.created > 0 || drain.delivered > 0 || drain.failed > 0) {
    log.info(
      {
        rulesEvaluated: evaluation.rulesEvaluated,
        created: evaluation.created,
        pending: evaluation.pending,
        suppressed: evaluation.suppressed,
        delivered: drain.delivered,
        failed: drain.failed,
        groups: drain.groups,
      },
      "push morning brief tick complete",
    );
  }
}

export function startPushMorningBrief(
  log: Logger,
  options: { intervalMs?: number } = {},
): PushBriefSchedulerHandle {
  const intervalMs = options.intervalMs ?? getPushMorningBriefIntervalMs();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await runPushMorningBrief(log);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "push morning brief tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
