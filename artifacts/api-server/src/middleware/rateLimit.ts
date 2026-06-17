import type { NextFunction, Request, Response } from "express";
import { getFixedWindowStore } from "../lib/rateLimit/fixedWindowStore";
import { logger } from "../lib/logger";

// A fixed-window rate limiter behind a store seam. The default backend is an
// in-process map, which is sufficient for the single Reserved VM target and
// keeps the dependency-free posture. Setting RATE_LIMIT_STORE=postgres routes
// every limiter through a shared Postgres table instead, so the limit holds
// across more than one instance (the Phase D and O horizontal-scaling concern).
// req.ip is only trustworthy because the app sets "trust proxy" and the dev
// proxy forwards the client address.
//
// The store is selected once at first use; the returned middleware namespaces
// its key by the limiter name, so two limiters that derive the same caller key
// (for example mcp and ingest both keyed by an ingestion key id) never share a
// counter.
export function createRateLimiter(options: {
  name: string;
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
}) {
  const store = getFixedWindowStore();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = options.name + "|" + options.keyFn(req);
    void store
      .hit(key, options.windowMs, options.max, now)
      .then((result) => {
        if (!result.allowed) {
          res.setHeader("Retry-After", String(Math.ceil((result.resetAt - now) / 1000)));
          res.status(429).json({ error: "too_many_requests" });
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        // A limiter-store fault must not turn into an availability outage for the
        // routes it guards. Log it loudly and fail open: the request proceeds and
        // the route's own auth, key, or HMAC gate still applies. This is a logged
        // degradation, not a silent fallback.
        logger.error({ err, limiter: options.name }, "rate limiter store error; failing open");
        next();
      });
  };
}
