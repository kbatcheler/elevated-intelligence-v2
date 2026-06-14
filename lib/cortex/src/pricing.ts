// Phase N cost model. This is the ONLY place token counts become dollars. The
// rates below are PUBLISHED LIST PRICES, expressed in USD per 1,000,000 tokens
// (and USD per web-search call), and an operator MUST verify them against their
// own provider contract before trusting the spend console: negotiated or volume
// pricing will differ. They are keyed by the three CORTEX seats, never by a
// literal model string, so the config invariant (model identifiers live only in
// config.ts) is preserved; the model string a call reports is resolved back to
// its seat through SEATS.
//
// A self-hosted or unknown model resolves to the local (zero) rate because it
// incurs no external per-token charge. That is an honest accounting of an
// in-boundary seat, not a silent fallback that hides a real cost.

import { SEATS, type SeatKey } from "./config";

export interface ModelRates {
  // USD per 1,000,000 tokens for each accounting bucket.
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheCreationPerMTok: number;
}

// List-price defaults per seat (verify against your contract):
//   reasoner  (Claude Sonnet): $3 in / $15 out per MTok; cache read 0.1x input,
//             cache write 1.25x input.
//   evaluator (Claude Haiku):  $1 in / $5 out per MTok; same cache multipliers.
//   grounder  (Gemini Pro):    $1.25 in / $10 out per MTok; no prompt-cache
//             accounting (the Gemini wrapper reports no cache tokens).
export const SEAT_RATES: Record<SeatKey, ModelRates> = {
  reasoner: { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheCreationPerMTok: 3.75 },
  evaluator: { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheCreationPerMTok: 1.25 },
  grounder: { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0, cacheCreationPerMTok: 0 },
};

// USD per server-side web-search tool call (Anthropic web_search, perceive).
export const WEB_SEARCH_PER_CALL_USD = 0.01;

// The in-boundary / unknown-model rate: zero external charge.
export const LOCAL_RATES: ModelRates = {
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheCreationPerMTok: 0,
};

export interface UsageCounts {
  // The model identifier as reported by the wrapper telemetry. Resolved back to
  // a seat's rates; anything not matching a configured seat prices at zero.
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  searchCalls?: number | null;
}

// Resolve a model string to its seat rates. The lookup runs over SEATS so no
// model literal ever appears here; an unrecognised model (the local seat, whose
// identifier is supplied at runtime, or a misconfiguration) takes the zero rate.
export function ratesForModel(model: string): ModelRates {
  for (const key of Object.keys(SEATS) as SeatKey[]) {
    if (SEATS[key].model === model) return SEAT_RATES[key];
  }
  return LOCAL_RATES;
}

const PER_MTOK = 1_000_000;

// The dollar cost of a single model call: each token bucket at its own rate plus
// the web-search calls, rounded to six decimal places to match the numeric(12,6)
// ledger column. Missing counts are treated as zero, never guessed.
export function costUsdForUsage(u: UsageCounts): number {
  const rates = ratesForModel(u.model);
  const input = ((u.inputTokens ?? 0) / PER_MTOK) * rates.inputPerMTok;
  const output = ((u.outputTokens ?? 0) / PER_MTOK) * rates.outputPerMTok;
  const cacheRead = ((u.cacheReadTokens ?? 0) / PER_MTOK) * rates.cacheReadPerMTok;
  const cacheCreation = ((u.cacheCreationTokens ?? 0) / PER_MTOK) * rates.cacheCreationPerMTok;
  const search = (u.searchCalls ?? 0) * WEB_SEARCH_PER_CALL_USD;
  const total = input + output + cacheRead + cacheCreation + search;
  return Math.round(total * PER_MTOK) / PER_MTOK;
}
