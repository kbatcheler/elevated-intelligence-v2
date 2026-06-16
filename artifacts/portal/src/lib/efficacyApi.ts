import type { TenantEfficacy } from "../types";

// The Data Efficacy Index data layer (Phase AK). Same framework-free shape as
// calibrationApi: a pure helper that owns the real logic (401 detection so the
// caller can log out, and a typed outcome) so it can be unit tested with a
// mocked fetch and no DOM. A 401 surfaces as { unauthorized: true } rather than
// logging out directly, keeping this function pure and the component thin.

export type TenantEfficacyOutcome =
  | { unauthorized: true }
  | { state: "ready"; data: TenantEfficacy }
  | { state: "error" };

// Fetch one tenant's efficacy rollup (every generated layer's index plus the
// mean across them). The shape returned IS the efficacy object, so a missing
// rollup is the honest signal of a malformed payload.
export async function fetchTenantEfficacy(tenantId: string): Promise<TenantEfficacyOutcome> {
  try {
    const res = await fetch("/api/tenants/" + encodeURIComponent(tenantId) + "/efficacy");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const body = (await res.json()) as { efficacy?: TenantEfficacy };
    const efficacy = body?.efficacy;
    if (!efficacy || typeof efficacy !== "object" || !efficacy.rollup || !Array.isArray(efficacy.layers)) {
      throw new Error("malformed");
    }
    return { state: "ready", data: efficacy };
  } catch {
    return { state: "error" };
  }
}
