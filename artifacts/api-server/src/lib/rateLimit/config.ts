// One config seam selects the backend for both rate-limit stores (the auth
// fixed-window limiter and the connector token bucket). Unset or "memory" (the
// default) keeps the in-process map the single-VM target uses; "postgres"
// routes both through the shared rate_limit_* tables so the limit and quota hold
// across more than one instance. Read at store construction, so a deployment
// picks its backend at boot and never mixes the two at runtime.
export type RateLimitStoreProvider = "memory" | "postgres";

export function rateLimitStoreProvider(): RateLimitStoreProvider {
  return process.env["RATE_LIMIT_STORE"] === "postgres" ? "postgres" : "memory";
}
