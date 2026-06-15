import type { PublicDiagnosis } from "../types";

// The ONLY unauthenticated portal data call (Phase AB). A cold prospect opens a
// shared link; this resolves the read-only diagnosis with no session and no
// cookie. The server returns a uniform 404 for an unknown, expired, or revoked
// link, which surfaces here as a single honest "unavailable" outcome that never
// distinguishes why (mirroring the server, which keeps the 404 uniform so a
// scraper cannot probe which tokens once existed).

export type PublicDiagnosisOutcome =
  | { state: "ready"; diagnosis: PublicDiagnosis }
  | { state: "unavailable" }
  | { state: "error" };

export async function fetchPublicDiagnosis(token: string): Promise<PublicDiagnosisOutcome> {
  try {
    const res = await fetch(`/api/public/diagnosis/${encodeURIComponent(token)}`);
    if (res.status === 404) return { state: "unavailable" };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { diagnosis: PublicDiagnosis };
    return { state: "ready", diagnosis: data.diagnosis };
  } catch {
    return { state: "error" };
  }
}
