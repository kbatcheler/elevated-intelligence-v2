import type { OutcomeMeasurement, TenantOutcomes } from "../types";

// The outcome-loop data layer. Same posture as tenantApi: framework-free helpers
// that own the real logic (401 detection, error-code extraction) and return
// discriminated outcomes, so they unit-test with a mocked fetch and no DOM.

export type OutcomesOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: TenantOutcomes }
  | { state: "error" };

export type MeasurementOutcome =
  | { unauthorized: true }
  | { ok: true; measurement: OutcomeMeasurement }
  | { error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

// The outcomes summary always exists for a tenant the caller can see (it is zeros
// when nothing has been graded), so there is no "empty" state distinct from
// "ready" here; the page renders the honest zero counter itself.
export async function fetchOutcomes(tenantId: string): Promise<OutcomesOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/outcomes`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = await res.json();
    return { state: "ready", data: data.outcomes as TenantOutcomes };
  } catch {
    return { state: "error" };
  }
}

export interface RecordMeasurementInput {
  realizedValueUsd?: number;
  actualMetric?: number;
  signalKey?: string;
  window?: string;
  note?: string;
  final?: boolean;
}

export async function recordMeasurement(
  tenantId: string,
  actionId: string,
  input: RecordMeasurementInput,
): Promise<MeasurementOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/actions/${actionId}/measurements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = await res.json();
    return { ok: true, measurement: data.measurement as OutcomeMeasurement };
  } catch {
    return { error: "failed" };
  }
}
