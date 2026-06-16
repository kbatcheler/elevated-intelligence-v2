import type { TenantAsOf } from "../types";

// The as-of replay data layer (Phase AM). Same framework-free posture as the
// other portal API helpers: a pure fetch that maps each HTTP status to a stable
// discriminated outcome, so the surface renders honest, distinct states and the
// helper unit-tests with a mocked fetch and no DOM. A 401 surfaces as
// { unauthorized: true } so the caller can log out; a 400 is the honest
// "that date could not be read" state, distinct from a transport error.

export type TenantAsOfOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: TenantAsOf }
  | { state: "bad-date" }
  | { state: "error" };

// Reconstruct one tenant's state as of a past instant. `at` is an ISO timestamp;
// the server rejects a missing or unparseable value with a 400, which we surface
// as a distinct bad-date outcome rather than a generic failure.
export async function fetchTenantAsOf(tenantId: string, at: string): Promise<TenantAsOfOutcome> {
  try {
    const res = await fetch(
      "/api/tenants/" + encodeURIComponent(tenantId) + "/as-of?at=" + encodeURIComponent(at),
    );
    if (res.status === 401) return { unauthorized: true };
    if (res.status === 400) return { state: "bad-date" };
    if (!res.ok) throw new Error("status " + res.status);
    const body = (await res.json()) as { asOf?: TenantAsOf };
    const data = body?.asOf;
    if (!data || typeof data !== "object" || !Array.isArray(data.layers)) {
      throw new Error("malformed");
    }
    return { state: "ready", data };
  } catch {
    return { state: "error" };
  }
}

// The diligence pack is a self-contained, brand-styled HTML document the server
// renders from the same persisted state the live surfaces read. It is opened or
// downloaded directly (the browser carries the session cookie), so the data
// layer only needs to build the URL, never parse a body.
export function diligencePackUrl(tenantId: string): string {
  return "/api/tenants/" + encodeURIComponent(tenantId) + "/diligence-pack.html";
}
