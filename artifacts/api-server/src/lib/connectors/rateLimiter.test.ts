import { beforeEach, describe, expect, it } from "vitest";
import type { QuotaProfile } from "@workspace/connectors";
import {
  ConnectorThrottleError,
  resetRateLimiter,
  runWithThrottleRetry,
  takeToken,
} from "./rateLimiter";

const profile: QuotaProfile = {
  capacity: 2,
  refillPerSecond: 1,
  maxAttempts: 4,
  maxRetryAfterSeconds: 45,
};

beforeEach(() => resetRateLimiter());

describe("token bucket", () => {
  it("allows a burst up to capacity, then reports a wait", () => {
    expect(takeToken("c1", profile, 0)).toBe(0);
    expect(takeToken("c1", profile, 0)).toBe(0);
    expect(takeToken("c1", profile, 0)).toBeGreaterThan(0);
  });

  it("refills over elapsed wall time", () => {
    takeToken("c1", profile, 0);
    takeToken("c1", profile, 0);
    takeToken("c1", profile, 0); // bucket is now negative
    // Two seconds later about two tokens have accrued, so a take is free again.
    expect(takeToken("c1", profile, 2000)).toBe(0);
  });

  it("keeps each connection's bucket independent", () => {
    takeToken("c1", profile, 0);
    takeToken("c1", profile, 0);
    expect(takeToken("c1", profile, 0)).toBeGreaterThan(0);
    expect(takeToken("c2", profile, 0)).toBe(0);
  });
});

function recordingSleep(): { calls: number[]; sleep: (ms: number) => Promise<void> } {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}

describe("throttle retry", () => {
  it("retries a throttle signal and recovers without failing the run", async () => {
    const { calls, sleep } = recordingSleep();
    let attempts = 0;
    const out = await runWithThrottleRetry(
      profile,
      () => {
        attempts += 1;
        if (attempts < 3) throw new ConnectorThrottleError("429");
        return Promise.resolve("ok");
      },
      { sleep },
    );
    expect(out).toBe("ok");
    expect(attempts).toBe(3);
    expect(calls).toHaveLength(2); // slept before each of the two retries
  });

  it("honors a Retry-After hint, capped at the profile ceiling", async () => {
    const { calls, sleep } = recordingSleep();
    let attempts = 0;
    await runWithThrottleRetry(
      profile,
      () => {
        attempts += 1;
        if (attempts === 1) throw new ConnectorThrottleError("slow down", 5); // 5s hint
        if (attempts === 2) throw new ConnectorThrottleError("slow down", 9999); // huge hint
        return Promise.resolve("ok");
      },
      { sleep },
    );
    expect(calls[0]).toBe(5000);
    expect(calls[1]).toBe(profile.maxRetryAfterSeconds * 1000); // capped, never the raw hint
  });

  it("throws after exhausting maxAttempts on a persistent throttle", async () => {
    const { calls, sleep } = recordingSleep();
    const p: QuotaProfile = { ...profile, maxAttempts: 3 };
    let attempts = 0;
    await expect(
      runWithThrottleRetry(
        p,
        () => {
          attempts += 1;
          throw new ConnectorThrottleError("429");
        },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(ConnectorThrottleError);
    expect(attempts).toBe(3);
    expect(calls).toHaveLength(2); // slept between attempts, not after the last
  });

  it("does not retry a genuine error", async () => {
    const { calls, sleep } = recordingSleep();
    let attempts = 0;
    await expect(
      runWithThrottleRetry(
        profile,
        () => {
          attempts += 1;
          throw new Error("genuine failure");
        },
        { sleep },
      ),
    ).rejects.toThrow("genuine failure");
    expect(attempts).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
