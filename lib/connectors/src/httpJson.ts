// The shared HTTP substrate for connectors that speak to a provider over its
// public REST or JSON API. It uses the Node global fetch and adds nothing to the
// dependency tree: no SDK, no client library. Every connector that touches a
// third-party API funnels through here so the timeout, throttle, and error
// discipline is uniform and provable in one place.
//
// Throttle ownership is deliberate. On an HTTP 429 this throws a
// ConnectorThrottleError carrying any Retry-After hint and does NOT retry
// internally. The runtime owns retries: the boundary refresh runtime retries a
// ConnectorThrottleError with backoff (runWithThrottleRetry), and the in-client
// edge runner fails the cycle honestly until its next tick. Retrying here as
// well would double the backoff on the boundary path and hide the throttle from
// the runtime that is meant to manage it.
//
// A response body is never logged or attached to an error. A provider error body
// can echo the request, and the request can carry the sensitive query that
// derives a client signal, so only the status leaves this module.

// A typed signal that a source asked us to slow down. A connector throws this on
// a 429 or equivalent; the boundary runtime retries it with backoff, a plain
// Error is a genuine failure and is never retried. retryAfterSeconds carries a
// server-provided hint when the source gives one. It lives in the shared
// connectors package so the connector that throws it and the runtime that
// catches it (artifacts/api-server rateLimiter re-exports this very class) share
// one class identity, which is what makes the runtime's instanceof check work.
export class ConnectorThrottleError extends Error {
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ConnectorThrottleError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export type QueryValue = string | number | boolean | undefined;

export interface HttpJsonRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  // Serialized as JSON when present; sets a JSON content-type by default.
  body?: unknown;
  timeoutMs?: number;
  // Injected only by tests that want a deterministic transport; production uses
  // the Node global fetch.
  fetchImpl?: typeof fetch;
}

export interface HttpJsonResult<T> {
  data: T;
  headers: Headers;
  status: number;
}

function buildUrl(url: string, query?: Record<string, QueryValue>): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) u.searchParams.set(key, String(value));
  }
  return u.toString();
}

// Parse a Retry-After header, which may be a delay in seconds or an HTTP date.
function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    const delta = Math.ceil((at - Date.now()) / 1000);
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

// Make one JSON request and return the parsed body alongside the response
// headers and status. The headers are returned so a connector that paginates by
// a Link header (Shopify) can follow it without a second request shape.
export async function httpRequestJson<T>(
  url: string,
  req: HttpJsonRequest = {},
): Promise<HttpJsonResult<T>> {
  const fetchImpl = req.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available in this runtime");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json", ...(req.headers ?? {}) };
    let body: string | undefined;
    if (req.body !== undefined) {
      if (!("content-type" in headers)) headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }
    const res = await fetchImpl(buildUrl(url, req.query), {
      method: req.method ?? "GET",
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
    if (res.status === 429) {
      // Drain the body so the socket frees, but never read it into an error.
      await res.text().catch(() => undefined);
      throw new ConnectorThrottleError("connector received http 429", parseRetryAfter(res.headers));
    }
    if (!res.ok) {
      await res.text().catch(() => undefined);
      throw new Error("connector http request failed with status " + res.status);
    }
    const data = (await res.json()) as T;
    return { data, headers: res.headers, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

// The common case: make one JSON request and return only the parsed body.
export async function httpJson<T>(url: string, req: HttpJsonRequest = {}): Promise<T> {
  return (await httpRequestJson<T>(url, req)).data;
}

// Parse the next URL from an RFC 5988 Link header (Shopify cursor pagination),
// or an empty string when there is no next page.
export function nextLink(linkHeader: string | null): string {
  if (!linkHeader) return "";
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return "";
}
