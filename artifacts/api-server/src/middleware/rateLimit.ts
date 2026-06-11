import type { NextFunction, Request, Response } from "express";

// A small in-memory fixed-window rate limiter. The platform target is a single
// Reserved VM, so a per-process map is sufficient and avoids a dependency or an
// external store. A horizontally scaled deployment would replace this with a
// shared store; that is a later concern and is logged in the Phase D drift
// report. req.ip is only trustworthy because the app sets "trust proxy" and the
// dev proxy forwards the client address.
interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    // Opportunistic cleanup so the map cannot grow without bound.
    if (now - lastSweep > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    const key = options.keyFn(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    next();
  };
}
