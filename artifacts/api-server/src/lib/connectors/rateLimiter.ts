import { ConnectorThrottleError } from "@workspace/connectors";
import type { QuotaProfile } from "@workspace/connectors";

// Per-connection runtime rate limiting (Phase O). Two mechanisms work together:
//
//  - A token bucket, sized from the connector's declared quota profile, that the
//    runtime enforces BEFORE each extraction so we never exceed a client API's
//    own throttle. State is in-process and per connection.
//  - A reactive retry that distinguishes a throttle signal (the source asked us
//    to slow down, for example an HTTP 429) from a genuine error: a throttle is
//    retried with backoff that honors a server Retry-After hint, a genuine error
//    is not retried at all. This mirrors the seed-runner 429 handling.

// The throttle signal a connector raises on a 429. It is defined once in the
// shared connectors package and re-exported here so the connector that throws it
// (over httpJson) and this runtime that catches it share one class identity,
// which is what makes the instanceof check below sound. A plain Error is a
// genuine failure and is never retried.
export { ConnectorThrottleError };

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, BucketState>();

/** Test seam: drop all in-memory bucket state. */
export function resetRateLimiter(): void {
  buckets.clear();
}

// Take one token for a connection, refilling first based on elapsed wall time.
// Returns the milliseconds the caller should wait before proceeding: 0 when a
// token was immediately available. When none is available the token is reserved
// (the bucket goes negative) so concurrent callers queue rather than burst.
export function takeToken(connectionId: string, profile: QuotaProfile, nowMs: number): number {
  const capacity = Math.max(1, profile.capacity);
  const rate = Math.max(0, profile.refillPerSecond);

  let state = buckets.get(connectionId);
  if (!state) {
    state = { tokens: capacity, lastRefillMs: nowMs };
    buckets.set(connectionId, state);
  }

  const elapsedMs = Math.max(0, nowMs - state.lastRefillMs);
  if (rate > 0) {
    state.tokens = Math.min(capacity, state.tokens + (elapsedMs / 1000) * rate);
  }
  state.lastRefillMs = nowMs;

  if (state.tokens >= 1) {
    state.tokens -= 1;
    return 0;
  }

  // Not enough yet: reserve the token (go negative) and report how long until it
  // would accrue. A zero refill rate is a misconfiguration; report no wait rather
  // than block forever, since the caller also caps any wait it honors.
  const deficit = 1 - state.tokens;
  state.tokens -= 1;
  if (rate <= 0) return 0;
  return Math.ceil((deficit / rate) * 1000);
}

export interface RetrySleepDeps {
  sleep: (ms: number) => Promise<void>;
}

// Default sleep. Injected so tests advance a fake clock instead of waiting.
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run an attempt, retrying ONLY on a ConnectorThrottleError, up to the profile's
// maxAttempts. A server Retry-After hint is honored when present, otherwise the
// wait is exponential backoff. Either way it is capped at maxRetryAfterSeconds,
// so a hostile or oversized hint cannot stall the runtime. A genuine error
// propagates on the first throw, never retried.
export async function runWithThrottleRetry<T>(
  profile: QuotaProfile,
  attemptFn: (attempt: number) => Promise<T>,
  deps: RetrySleepDeps,
): Promise<T> {
  const maxAttempts = Math.max(1, profile.maxAttempts);
  const capMs = Math.max(0, profile.maxRetryAfterSeconds) * 1000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await attemptFn(attempt);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ConnectorThrottleError) || attempt >= maxAttempts) {
        throw err;
      }
      const hintMs =
        err.retryAfterSeconds !== undefined
          ? err.retryAfterSeconds * 1000
          : 2 ** (attempt - 1) * 1000;
      await deps.sleep(Math.min(capMs, Math.max(0, hintMs)));
    }
  }
  throw lastErr;
}
