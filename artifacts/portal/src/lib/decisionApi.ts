import type {
  DecisionTimeline,
  PreMortem,
  PreMortemIndicator,
  PreMortemIndicatorStatus,
} from "../types";

// The decision ledger data layer (Phase AL). Same posture as the other portal
// API helpers: framework-free fetch that maps each HTTP status to a stable
// discriminated outcome, so the surface renders honest distinct states and every
// helper unit-tests with a mocked fetch and no DOM. A 401 is its own outcome so
// the caller can log out; a write returns either an ok marker (or the recorded
// row, where the caller needs it) or a typed server error code.

export type DecisionTimelineOutcome =
  | { unauthorized: true }
  | { state: "ready"; timeline: DecisionTimeline }
  | { state: "error" };

export type RecordDecisionOutcome =
  | { unauthorized: true }
  | { ok: true }
  | { error: string };

export type PreMortemOutcome =
  | { unauthorized: true }
  | { ok: true; preMortem: PreMortem }
  | { error: string };

export type IndicatorStatusOutcome =
  | { unauthorized: true }
  | { ok: true; indicator: PreMortemIndicator }
  | { error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

// The decision timeline always exists for a tenant in scope (an empty timeline
// when nothing has been decided), so there is no "empty" outcome distinct from
// "ready"; the caller renders the honest zero state from the summary.
export async function fetchDecisionTimeline(tenantId: string): Promise<DecisionTimelineOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/decisions/timeline`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const timeline = (await res.json()) as DecisionTimeline;
    return { state: "ready", timeline };
  } catch {
    return { state: "error" };
  }
}

// Record a defer or a reject against a recommended action. The recommendation
// stays in the diagnosis; this captures that it was deliberately not taken, by
// whom, and why. A commit is recorded by committing the action, not here.
export async function recordDecision(
  tenantId: string,
  input: { layerKey: string; actionRef: string; decision: "defer" | "reject"; rationale: string },
): Promise<RecordDecisionOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

// Trigger an on-demand pre-mortem against a recorded decision. The call runs the
// Confounder cortex synchronously server-side and returns the recorded row; a
// 201 with a "failed" status is a successful HTTP response carrying an honest
// model failure, not a transport error.
export async function runPreMortem(tenantId: string, decisionId: string): Promise<PreMortemOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/decisions/${decisionId}/pre-mortem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as { preMortem: PreMortem };
    return { ok: true, preMortem: data.preMortem };
  } catch {
    return { error: "failed" };
  }
}

// Report the OBSERVED state of a pre-mortem indicator: "triggered" when the
// early-warning sign was seen, "cleared" when the concern has passed, "active"
// to return it to a plain watch. The human marks what they actually observed,
// never a fabricated breach.
export async function setIndicatorStatus(
  tenantId: string,
  indicatorId: string,
  status: PreMortemIndicatorStatus,
): Promise<IndicatorStatusOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/pre-mortem-indicators/${indicatorId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as { indicator: PreMortemIndicator };
    return { ok: true, indicator: data.indicator };
  } catch {
    return { error: "failed" };
  }
}
