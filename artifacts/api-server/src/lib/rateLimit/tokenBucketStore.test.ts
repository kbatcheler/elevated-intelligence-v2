import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { QuotaProfile } from "@workspace/connectors";
import { db } from "@workspace/db";
import { resetRateLimiter } from "../connectors/rateLimiter";
import { requireSecret } from "../secrets/secretStore";
import {
  getTokenBucketStore,
  MemoryTokenBucketStore,
  PostgresTokenBucketStore,
  resetTokenBucketStoreSingleton,
} from "./tokenBucketStore";
import { hashRateLimitKey } from "./keyHash";

const profile: QuotaProfile = {
  capacity: 2,
  refillPerSecond: 1,
  maxAttempts: 4,
  maxRetryAfterSeconds: 45,
};

// Namespace every connection key so cleanup is targeted to this run, never a
// global DELETE on the shared dev DB.
const RUN = `tbtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

afterAll(async () => {
  // The Postgres store keys each bucket by a SESSION_SECRET-peppered hash, not
  // the raw RUN-prefixed connection id, so cleanup targets the exact digests
  // this run wrote rather than a LIKE on the plaintext prefix.
  const secret = await requireSecret("SESSION_SECRET");
  for (const k of [`${RUN}-shared`, `${RUN}-refill`]) {
    await db.execute(
      sql`DELETE FROM rate_limit_buckets WHERE key = ${hashRateLimitKey(k, secret)}`,
    );
  }
});

describe("MemoryTokenBucketStore", () => {
  it("delegates to the pure token bucket: a burst up to capacity, then a wait", async () => {
    resetRateLimiter();
    const store = new MemoryTokenBucketStore();
    expect(await store.take("c1", profile, 0)).toBe(0);
    expect(await store.take("c1", profile, 0)).toBe(0);
    expect(await store.take("c1", profile, 0)).toBeGreaterThan(0);
  });

  it("keeps each connection independent", async () => {
    resetRateLimiter();
    const store = new MemoryTokenBucketStore();
    await store.take("c1", profile, 0);
    await store.take("c1", profile, 0);
    expect(await store.take("c1", profile, 0)).toBeGreaterThan(0);
    expect(await store.take("c2", profile, 0)).toBe(0);
  });
});

describe("PostgresTokenBucketStore (shared across simulated instances)", () => {
  it("draws one bucket down across two instances, then reports a wait", async () => {
    const a = new PostgresTokenBucketStore();
    const b = new PostgresTokenBucketStore();
    const key = `${RUN}-shared`;
    // Capacity is 2; two instances share it, so the third take (whichever
    // instance makes it) finds the bucket empty and reports a wait.
    expect(await a.take(key, profile, 0)).toBe(0);
    expect(await b.take(key, profile, 0)).toBe(0);
    expect(await a.take(key, profile, 0)).toBeGreaterThan(0);
  });

  it("refills the shared bucket over elapsed wall time", async () => {
    const store = new PostgresTokenBucketStore();
    const key = `${RUN}-refill`;
    await store.take(key, profile, 0);
    await store.take(key, profile, 0);
    await store.take(key, profile, 0); // bucket now negative
    // About two seconds later roughly two tokens have accrued, so a take is free.
    expect(await store.take(key, profile, 2000)).toBe(0);
  });
});

describe("getTokenBucketStore backend selection", () => {
  const prev = process.env["RATE_LIMIT_STORE"];
  afterEach(() => {
    if (prev === undefined) delete process.env["RATE_LIMIT_STORE"];
    else process.env["RATE_LIMIT_STORE"] = prev;
    resetTokenBucketStoreSingleton();
  });

  it("defaults to the in-process bucket when unset", () => {
    delete process.env["RATE_LIMIT_STORE"];
    resetTokenBucketStoreSingleton();
    expect(getTokenBucketStore()).toBeInstanceOf(MemoryTokenBucketStore);
  });

  it("selects the shared Postgres bucket only when opted in", () => {
    process.env["RATE_LIMIT_STORE"] = "postgres";
    resetTokenBucketStoreSingleton();
    expect(getTokenBucketStore()).toBeInstanceOf(PostgresTokenBucketStore);
  });
});
