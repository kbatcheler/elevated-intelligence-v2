import type { CaseStudy, MintedShareToken, ShareToken } from "../types";

// The Sellability Pack data layer (Phase AB), provider side. Same posture as the
// other portal API helpers: framework-free fetch that maps each HTTP status to a
// stable discriminated outcome, so the surface renders honest distinct states and
// every helper unit-tests with a mocked fetch and no DOM. A 401 is its own
// outcome so the caller can log out. The share routes live under /api alongside
// the tenant routes; minting returns the plaintext token exactly once.

export type ShareTokensOutcome =
  | { unauthorized: true }
  | { state: "ready"; shares: ShareToken[] }
  | { state: "error" };

export type MintShareOutcome =
  | { unauthorized: true }
  | { ok: true; share: MintedShareToken }
  | { error: string };

export type RevokeShareOutcome =
  | { unauthorized: true }
  | { ok: true }
  | { error: string };

export type CaseStudiesOutcome =
  | { unauthorized: true }
  | { state: "ready"; caseStudies: CaseStudy[] }
  | { state: "error" };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

// A tenant's shares always exist as a list (empty when none have been minted), so
// there is no "empty" outcome distinct from "ready"; the caller renders the zero
// state from an empty array.
export async function fetchShareTokens(tenantId: string): Promise<ShareTokensOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/share-tokens`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { shares: ShareToken[] };
    return { state: "ready", shares: data.shares };
  } catch {
    return { state: "error" };
  }
}

export interface MintShareInput {
  label?: string;
  expiresInDays?: number;
}

// Mint a read-only diagnosis link. The returned share carries the plaintext token
// and its portal path, which are never readable again; the caller must surface
// the full URL once and let the operator copy it.
export async function mintShareToken(
  tenantId: string,
  input: MintShareInput = {},
): Promise<MintShareOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/share-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as { share: MintedShareToken };
    return { ok: true, share: data.share };
  } catch {
    return { error: "failed" };
  }
}

// Revoke a share early. Idempotent server side; the portal only needs to know it
// succeeded so it can refresh the list.
export async function revokeShareToken(
  tenantId: string,
  tokenId: string,
): Promise<RevokeShareOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/share-tokens/${tokenId}/revoke`, {
      method: "POST",
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    return { ok: true };
  } catch {
    return { error: "failed" };
  }
}

// The anonymized, segment-level case studies. Provider/owner only server side; a
// non-provider seat receives a 403, which surfaces here as an error state.
export async function fetchCaseStudies(): Promise<CaseStudiesOutcome> {
  try {
    const res = await fetch("/api/case-studies");
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { caseStudies: CaseStudy[] };
    return { state: "ready", caseStudies: data.caseStudies };
  } catch {
    return { state: "error" };
  }
}
