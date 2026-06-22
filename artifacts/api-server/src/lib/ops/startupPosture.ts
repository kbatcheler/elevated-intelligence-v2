import { rateLimitStoreProvider, type RateLimitStoreProvider } from "../rateLimit/config";

// Boot-time operational posture (Phase AR). This module emits, once at startup,
// the two facts an operator needs to run the server safely: which rate-limit
// store is active, and the single loop-runner requirement of the scheduled
// loops. It is observability only. Nothing here runs at request time and nothing
// here changes request behaviour; the rate-limit and loop defaults are unchanged.

// The in-process scheduled loops started once in the server entrypoint. Each
// runs on an unref'd, non-overlapping timer with NO cross-instance coordination,
// so a deployment that runs more than one app instance runs every one of these
// loops once PER instance, and a loop runs only while its instance is alive. The
// provided GCP target therefore pins a single always-on instance (see
// infra/gcp/main.tf and docs/go-live-checklist.md); scaling the request tier
// past one instance is a documented future posture that needs a separate single
// loop runner or per-loop leader election.
export const SCHEDULED_LOOPS = [
  "connector-maintenance",
  "alert-notifier",
  "retention-purge",
  "backup-archive",
  "benchmark-recompute",
  "push-morning-brief",
  "sftp-drop-watcher",
] as const;

export interface PostureLogLine {
  level: "info" | "warn";
  msg: string;
  fields: Record<string, unknown>;
}

// Pure. Given the active rate-limit store, describe how it should be logged at
// boot. memory is correct for one instance but keeps a per-instance counter, so
// it warns and names the postgres opt-in; postgres shares the counter across
// instances, so it is an informational line.
export function rateLimitPostureLine(provider: RateLimitStoreProvider): PostureLogLine {
  if (provider === "postgres") {
    return {
      level: "info",
      msg: "rate-limit store: postgres; limits and quotas are shared across instances",
      fields: { rateLimitStore: provider, sharedAcrossInstances: true },
    };
  }
  return {
    level: "warn",
    msg:
      "rate-limit store: memory; counters are per-instance and single-instance only. " +
      "Set RATE_LIMIT_STORE=postgres before running more than one instance",
    fields: { rateLimitStore: provider, sharedAcrossInstances: false },
  };
}

// Pure. The scheduled-loop posture line. The loops run once per instance with no
// cross-instance coordination, so this always states the single loop-runner
// requirement rather than reporting a fault.
export function scheduledLoopPostureLine(): PostureLogLine {
  return {
    level: "info",
    msg:
      "scheduled loops run once per instance with no cross-instance coordination; " +
      "run a single loop-runner instance or expect duplicate ticks",
    fields: { scheduledLoops: [...SCHEDULED_LOOPS], loopRunner: "single-instance" },
  };
}

export interface PostureLogger {
  info: (fields: Record<string, unknown>, msg: string) => void;
  warn: (fields: Record<string, unknown>, msg: string) => void;
}

// Emit the boot-time posture: the active rate-limit store, then the
// scheduled-loop single-instance requirement.
export function logStartupPosture(log: PostureLogger): void {
  const lines: PostureLogLine[] = [
    rateLimitPostureLine(rateLimitStoreProvider()),
    scheduledLoopPostureLine(),
  ];
  for (const line of lines) {
    if (line.level === "warn") log.warn(line.fields, line.msg);
    else log.info(line.fields, line.msg);
  }
}
