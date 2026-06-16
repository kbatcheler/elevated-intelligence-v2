import type { CalibrationSummary } from "../types";

// The Brier-scored calibration data layer (Phase AJ). Same framework-free shape
// as spendApi: a pure helper that owns the real logic (401 detection so the
// caller can log out, and a typed outcome) so it can be unit tested with a
// mocked fetch and no DOM. A 401 surfaces as { unauthorized: true } rather than
// logging out directly, keeping this function pure and the component thin.

export type CalibrationOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: CalibrationSummary }
  | { state: "error" };

// Fetch the calibration summary. Without a tenantId the summary is the
// system-wide track record (owner-only on the server); with one it is scoped to
// that tenant. The shape returned IS the summary, so a missing headline is the
// honest signal of a malformed payload.
export async function fetchCalibrationSummary(tenantId?: string): Promise<CalibrationOutcome> {
  try {
    const qs = tenantId ? "?tenantId=" + encodeURIComponent(tenantId) : "";
    const res = await fetch("/api/calibration" + qs);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const body = (await res.json()) as CalibrationSummary;
    if (!body || typeof body !== "object" || !body.headline || !body.scope) {
      throw new Error("malformed");
    }
    return { state: "ready", data: body };
  } catch {
    return { state: "error" };
  }
}
