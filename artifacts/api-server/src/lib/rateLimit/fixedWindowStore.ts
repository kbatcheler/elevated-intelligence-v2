import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireSecret } from "../secrets/secretStore";
import { rateLimitStoreProvider } from "./config";
import { hashRateLimitKey } from "./keyHash";

// The auth and ingestion fixed-window limiter, behind a store seam so the same
// limiter can run on an in-process map (the single-VM default) or on a shared
// Postgres table (RATE_LIMIT_STORE=postgres) where the limit holds across more
// than one instance. The key handed in is already namespaced by the limiter name
// (see createRateLimiter), so two limiters never share a counter.

export interface FixedWindowResult {
  // Whether this hit is within the limit (the count after this hit is <= max).
  allowed: boolean;
  // Epoch ms when the current window resets, for the Retry-After header.
  resetAt: number;
}

export interface FixedWindowStore {
  hit(key: string, windowMs: number, max: number, nowMs: number): Promise<FixedWindowResult>;
  // Test seam: drop all counter state.
  reset(): Promise<void>;
}

interface Window {
  count: number;
  resetAt: number;
}

// The in-process default. One map for every limiter, namespaced by key; an
// opportunistic sweep once per window keeps it from growing without bound.
export class MemoryFixedWindowStore implements FixedWindowStore {
  private readonly windows = new Map<string, Window>();
  private lastSweepMs = 0;

  hit(key: string, windowMs: number, max: number, nowMs: number): Promise<FixedWindowResult> {
    if (nowMs - this.lastSweepMs > windowMs) {
      for (const [k, w] of this.windows) {
        if (w.resetAt <= nowMs) this.windows.delete(k);
      }
      this.lastSweepMs = nowMs;
    }
    let window = this.windows.get(key);
    if (!window || window.resetAt <= nowMs) {
      window = { count: 0, resetAt: nowMs + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve({ allowed: window.count <= max, resetAt: window.resetAt });
  }

  reset(): Promise<void> {
    this.windows.clear();
    return Promise.resolve();
  }
}

// The shared Postgres backend. Each hit is one atomic upsert: a new key starts a
// fresh window, an existing key either resets in place (its window has passed) or
// increments, all decided inside the statement so concurrent instances cannot
// race a read against a write. Times are epoch ms, computed by the caller, so the
// window math needs no clock round trip.
export class PostgresFixedWindowStore implements FixedWindowStore {
  private lastSweepMs = 0;
  private sessionSecret: string | null = null;

  // The shared table never holds a raw caller identifier: every key is hashed
  // with a SESSION_SECRET-derived pepper first (see keyHash.ts). The secret is
  // resolved once per process and cached on the instance.
  private async storeKey(key: string): Promise<string> {
    if (this.sessionSecret === null) {
      this.sessionSecret = await requireSecret("SESSION_SECRET");
    }
    return hashRateLimitKey(key, this.sessionSecret);
  }

  async hit(
    key: string,
    windowMs: number,
    max: number,
    nowMs: number,
  ): Promise<FixedWindowResult> {
    const storedKey = await this.storeKey(key);
    const resetMs = nowMs + windowMs;
    const result = await db.execute<{ count: number | string; reset_at_ms: number | string }>(sql`
      INSERT INTO rate_limit_counters (key, count, reset_at_ms)
      VALUES (${storedKey}, 1, ${resetMs})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_counters.reset_at_ms <= ${nowMs} THEN 1
          ELSE rate_limit_counters.count + 1 END,
        reset_at_ms = CASE
          WHEN rate_limit_counters.reset_at_ms <= ${nowMs} THEN ${resetMs}
          ELSE rate_limit_counters.reset_at_ms END,
        updated_at = now()
      RETURNING count, reset_at_ms
    `);
    const row = result.rows[0];
    const count = row ? Number(row.count) : 1;
    const resetAt = row ? Number(row.reset_at_ms) : resetMs;

    // Bound the table the same way the memory map is bounded: at most one sweep
    // of expired rows per window per process. A sweep failure must not affect
    // the limit decision, so it is best effort.
    if (nowMs - this.lastSweepMs > windowMs) {
      this.lastSweepMs = nowMs;
      try {
        await db.execute(sql`DELETE FROM rate_limit_counters WHERE reset_at_ms <= ${nowMs}`);
      } catch {
        // Maintenance only; the next sweep retries.
      }
    }

    return { allowed: count <= max, resetAt };
  }

  async reset(): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limit_counters`);
  }
}

let singleton: FixedWindowStore | null = null;

// The process-wide store, selected once from RATE_LIMIT_STORE at first use.
export function getFixedWindowStore(): FixedWindowStore {
  if (!singleton) {
    singleton =
      rateLimitStoreProvider() === "postgres"
        ? new PostgresFixedWindowStore()
        : new MemoryFixedWindowStore();
  }
  return singleton;
}

// Test seam: drop the cached singleton so a test can re-select the backend.
export function resetFixedWindowStoreSingleton(): void {
  singleton = null;
}
