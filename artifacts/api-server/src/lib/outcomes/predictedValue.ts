// The honest bridge from a free-text predicted impact to a numeric dollar
// prediction. The intelligence writes an impact string like "Recovers an
// estimated $2.4M within two quarters"; the track record needs a number it can
// sum and grade against. This parser reads a real dollar figure out of that
// string and returns null when there is no parseable dollar amount.
//
// It is deliberately conservative. It only trusts an amount anchored by a "$"
// or a "USD" token, so a bare percentage ("12% reduction"), a margin-point
// figure ("2.1 points of gross margin"), or prose is treated as having no
// numeric prediction rather than being coerced into an invented dollar value.
// The platform never fabricates a number; an unparseable impact simply has no
// predictedValueUsd.

const UNIT_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

// $ or USD, then a number (optional thousands separators and decimals), then an
// optional scale unit. Case-insensitive. The first match in the string wins.
const CURRENCY = /(?:\$|usd)\s*([0-9](?:[0-9,]*)(?:\.[0-9]+)?)\s*(mm|bn|million|billion|thousand|k|m|b)?\b/i;

export function parsePredictedValueUsd(impact: string | null | undefined): number | null {
  if (!impact) return null;
  const match = CURRENCY.exec(impact);
  if (!match) return null;
  const rawNumber = match[1].replace(/,/g, "");
  const base = Number.parseFloat(rawNumber);
  if (!Number.isFinite(base)) return null;
  const unit = match[2] ? match[2].toLowerCase() : null;
  const multiplier = unit ? (UNIT_MULTIPLIER[unit] ?? 1) : 1;
  const value = base * multiplier;
  if (!Number.isFinite(value) || value < 0) return null;
  // Two-decimal dollars, matching the numeric(14,2) column.
  return Math.round(value * 100) / 100;
}
