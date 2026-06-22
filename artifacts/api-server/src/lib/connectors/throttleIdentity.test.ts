import { ConnectorThrottleError } from "@workspace/connectors";
import { describe, expect, it } from "vitest";
import type { QuotaProfile } from "@workspace/connectors";
import { ConnectorThrottleError as ReExportedThrottleError, runWithThrottleRetry } from "./rateLimiter";

// The throttle signal must be ONE class across the package boundary: the
// connectors raise it (over httpJson, on a 429), and this runtime catches it
// with an instanceof check. If the runtime defined its own copy, that check
// would silently never match and a real throttle would surface as a hard error
// instead of a retry. These tests pin that single identity.

const profile: QuotaProfile = {
  capacity: 5,
  refillPerSecond: 1,
  maxAttempts: 4,
  maxRetryAfterSeconds: 45,
};

describe("throttle signal identity across the connectors boundary", () => {
  it("re-exports the very class the connectors package raises", () => {
    expect(ReExportedThrottleError).toBe(ConnectorThrottleError);
  });

  it("retries a connector-raised throttle, honouring its Retry-After hint", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const result = await runWithThrottleRetry(
      profile,
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ConnectorThrottleError("429 from connector", 2);
        return "ok";
      },
      { sleep: async (ms: number) => void sleeps.push(ms) },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("never retries a genuine error", async () => {
    let attempts = 0;
    await expect(
      runWithThrottleRetry(
        profile,
        async () => {
          attempts += 1;
          throw new Error("genuine failure");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("genuine failure");
    expect(attempts).toBe(1);
  });
});
