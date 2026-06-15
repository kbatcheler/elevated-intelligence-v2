import type { PortfolioSummary } from "../types";

// The portfolio data layer. Same posture as the other portal API helpers: a
// framework-free fetch that maps each HTTP status to a stable discriminated
// outcome, so the page renders honest distinct states and the helper unit-tests
// with a mocked fetch. The 403 portfolio_only case is its own outcome, because a
// non-portfolio seat reaching this surface is an honest access state, not an
// error to retry.
export type PortfolioOutcome =
  | { unauthorized: true }
  | { forbidden: true }
  | { state: "ready"; data: PortfolioSummary }
  | { state: "error" };

export async function fetchPortfolioSummary(): Promise<PortfolioOutcome> {
  try {
    const res = await fetch("/api/portfolio/summary");
    if (res.status === 401) return { unauthorized: true };
    if (res.status === 403) return { forbidden: true };
    if (!res.ok) throw new Error("status " + res.status);
    const data = (await res.json()) as { portfolio: PortfolioSummary };
    return { state: "ready", data: data.portfolio };
  } catch {
    return { state: "error" };
  }
}
