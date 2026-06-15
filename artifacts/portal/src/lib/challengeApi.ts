import type { FindingChallenge } from "../types";

// The Interactive Challenge data layer (Phase AA). Same posture as the other
// portal API helpers: framework-free fetch that maps each HTTP status to a
// stable discriminated outcome, so the surface renders honest distinct states
// and every helper unit-tests with a mocked fetch and no DOM. A 401 is its own
// outcome so the caller can log out; a challenge submit returns either the
// recorded challenge (completed OR failed, the row carries which) or a typed
// server error code.

export type ChallengesOutcome =
  | { unauthorized: true }
  | { state: "ready"; challenges: FindingChallenge[] }
  | { state: "error" };

export type SubmitChallengeOutcome =
  | { unauthorized: true }
  | { ok: true; challenge: FindingChallenge }
  | { error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || "failed";
}

// The challenge history always exists for a tenant in scope (an empty list when
// nothing has been challenged), so there is no "empty" outcome distinct from
// "ready"; the caller renders the honest zero state.
export async function fetchChallenges(tenantId: string): Promise<ChallengesOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/challenges`);
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { challenges: FindingChallenge[] };
    return { state: "ready", challenges: data.challenges };
  } catch {
    return { state: "error" };
  }
}

// Submit a challenge for one finding. The call runs the re-reasoning
// synchronously server-side and returns the recorded row; a 201 with a "failed"
// status is a successful HTTP response carrying an honest model failure, not a
// transport error.
export async function submitChallenge(
  tenantId: string,
  layerKey: string,
  findingRef: string,
  challengeText: string,
): Promise<SubmitChallengeOutcome> {
  try {
    const res = await fetch(`/api/tenants/${tenantId}/layers/${layerKey}/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findingRef, challengeText }),
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) return { error: await readError(res) };
    const data = (await res.json()) as { challenge: FindingChallenge };
    return { ok: true, challenge: data.challenge };
  } catch {
    return { error: "failed" };
  }
}

// Group a flat challenge list by finding reference, newest first within each
// ref, so a finding card can show only its own history without re-filtering in
// render. Input order (newest first from the server) is preserved.
export function groupChallengesByRef(
  challenges: FindingChallenge[],
): Map<string, FindingChallenge[]> {
  const byRef = new Map<string, FindingChallenge[]>();
  for (const c of challenges) {
    const list = byRef.get(c.findingRef);
    if (list) list.push(c);
    else byRef.set(c.findingRef, [c]);
  }
  return byRef;
}
