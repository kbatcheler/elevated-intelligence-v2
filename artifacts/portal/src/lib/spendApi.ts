import type { SpendSummary } from "../types";

// The Spend console data layer. Same framework-free shape as adminApi and
// securityApi: a pure helper that owns the real logic (401 detection so the
// caller can log out, and a typed outcome) so it can be unit tested with a
// mocked fetch and no DOM. A 401 surfaces as { unauthorized: true } rather than
// logging out directly, keeping this function pure and the component thin.

export type SpendOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: SpendSummary }
  | { state: "error" };

export async function fetchSpendSummary(): Promise<SpendOutcome> {
  try {
    const res = await fetch("/api/spend/summary");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const body = (await res.json()) as { spend?: SpendSummary };
    if (!body.spend) throw new Error("malformed");
    return { state: "ready", data: body.spend };
  } catch {
    return { state: "error" };
  }
}
