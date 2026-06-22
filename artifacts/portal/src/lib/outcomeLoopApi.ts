import type { OutcomeLoop } from "../types";

// The outcome-loop data layer (Phase AQ). Same posture as outcomeApi and
// tenantApi: a framework-free helper that owns the real logic (401 detection,
// error handling) and returns a discriminated outcome, so it unit-tests with a
// mocked fetch and no DOM. It returns the whole loop object, not a nested field.

export type OutcomeLoopOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: OutcomeLoop }
  | { state: "error" };

// The loop summary always exists for a tenant the caller can see (it is an empty
// record with a null Brier when nothing has been committed), so there is no
// "empty" state distinct from "ready" here; the page renders the honest empty
// record itself.
export async function fetchOutcomeLoop(tenantId: string): Promise<OutcomeLoopOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/outcome-loop`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as OutcomeLoop;
    return { state: "ready", data };
  } catch {
    return { state: "error" };
  }
}
