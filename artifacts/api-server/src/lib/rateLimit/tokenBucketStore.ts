import { sql } from "drizzle-orm";
import type { QuotaProfile } from "@workspace/connectors";
import { db } from "@workspace/db";
import { resetRateLimiter, takeToken } from "../connectors/rateLimiter";
import { requireSecret } from "../secrets/secretStore";
import { rateLimitStoreProvider } from "./config";
import { hashRateLimitKey } from "./keyHash";

// The connector token bucket, behind a store seam so it can run on the
// in-process map (the single-VM default) or on a shared Postgres table
// (RATE_LIMIT_STORE=postgres). take() returns the milliseconds the caller should
// wait before proceeding, 0 when a token was immediately available, exactly like
// the in-memory takeToken it wraps.

export interface TokenBucketStore {
  take(connectionId: string, profile: QuotaProfile, nowMs: number): Promise<number>;
  // Test seam: drop all bucket state.
  reset(): Promise<void>;
}

// The in-process default. Delegates to the existing pure token-bucket function so
// its behaviour and its unit tests are unchanged.
export class MemoryTokenBucketStore implements TokenBucketStore {
  take(connectionId: string, profile: QuotaProfile, nowMs: number): Promise<number> {
    return Promise.resolve(takeToken(connectionId, profile, nowMs));
  }

  reset(): Promise<void> {
    resetRateLimiter();
    return Promise.resolve();
  }
}

// One hour: a bucket not drawn from in this long belongs to a connection that is
// idle or gone. The lazy sweep drops it so the table stays bounded even though
// no FK ties a bucket row to its connection.
const BUCKET_STALE_MS = 60 * 60 * 1000;

// The shared Postgres backend. Each take is one atomic upsert that refills from
// the elapsed wall time, clamps to capacity, then reserves a token (the row may
// go negative under contention, exactly as the in-memory bucket does), so
// concurrent instances draw from a single bucket.
export class PostgresTokenBucketStore implements TokenBucketStore {
  private lastSweepMs = 0;
  private sessionSecret: string | null = null;

  // The shared table never holds a raw connection id: every key is hashed with a
  // SESSION_SECRET-derived pepper first (see keyHash.ts), resolved once per
  // process and cached on the instance.
  private async storeKey(key: string): Promise<string> {
    if (this.sessionSecret === null) {
      this.sessionSecret = await requireSecret("SESSION_SECRET");
    }
    return hashRateLimitKey(key, this.sessionSecret);
  }

  async take(connectionId: string, profile: QuotaProfile, nowMs: number): Promise<number> {
    const storedKey = await this.storeKey(connectionId);
    const capacity = Math.max(1, profile.capacity);
    const rate = Math.max(0, profile.refillPerSecond);

    const result = await db.execute<{ tokens: number | string }>(sql`
      INSERT INTO rate_limit_buckets (key, tokens, last_refill_ms)
      VALUES (${storedKey}, ${capacity - 1}, ${nowMs})
      ON CONFLICT (key) DO UPDATE SET
        tokens = LEAST(
          ${capacity},
          rate_limit_buckets.tokens
            + (GREATEST(0, ${nowMs} - rate_limit_buckets.last_refill_ms) / 1000.0) * ${rate}
        ) - 1,
        last_refill_ms = ${nowMs},
        updated_at = now()
      RETURNING tokens
    `);
    const row = result.rows[0];
    // tokens RETURNING is post-decrement; the pre-decrement (refilled) value is
    // one greater. A new row returns capacity - 1, so refilled is capacity >= 1.
    const stored = row ? Number(row.tokens) : capacity - 1;
    const refilled = stored + 1;

    await this.maybeSweep(nowMs);

    if (refilled >= 1) return 0;
    // Not enough yet: report how long until one token accrues. A zero refill
    // rate is a misconfiguration; report no wait rather than block forever, since
    // the caller also caps any wait it honours.
    if (rate <= 0) return 0;
    const deficit = 1 - refilled;
    return Math.ceil((deficit / rate) * 1000);
  }

  private async maybeSweep(nowMs: number): Promise<void> {
    if (nowMs - this.lastSweepMs <= BUCKET_STALE_MS) return;
    this.lastSweepMs = nowMs;
    try {
      await db.execute(
        sql`DELETE FROM rate_limit_buckets WHERE last_refill_ms < ${nowMs - BUCKET_STALE_MS}`,
      );
    } catch {
      // Maintenance only; the next sweep retries.
    }
  }

  async reset(): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  }
}

let singleton: TokenBucketStore | null = null;

// The process-wide store, selected once from RATE_LIMIT_STORE at first use.
export function getTokenBucketStore(): TokenBucketStore {
  if (!singleton) {
    singleton =
      rateLimitStoreProvider() === "postgres"
        ? new PostgresTokenBucketStore()
        : new MemoryTokenBucketStore();
  }
  return singleton;
}

// Test seam: drop the cached singleton so a test can re-select the backend.
export function resetTokenBucketStoreSingleton(): void {
  singleton = null;
}
