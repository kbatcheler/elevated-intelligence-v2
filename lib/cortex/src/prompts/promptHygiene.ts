// Prompt-hygiene guard. A hardcoded example figure in a prompt is the bug that
// makes every tenant come out with identical numbers: a model shown "120bps" or
// "$1.2M" in its instructions will happily echo it back as if it were this
// company's metric. This module is the pure detector; the companion test reads
// the authored prompt sources and asserts none carries a literal figure, so CI
// fails loudly if one is ever pasted in.
//
// Detection is unit-anchored on purpose. A bare placeholder like 0 or a rank of
// 1 in a JSON skeleton, or a scale bound like "0 to 100", is legitimate and must
// never trip the guard. Only a number carrying a bps, percentage, or dollar unit
// counts as a figure. A line carrying the allow marker below is the single
// escape hatch for a deliberate, reviewed literal.

export const PROMPT_HYGIENE_ALLOW_MARKER = "prompt-hygiene-allow-literal";

export type FigureKind = "bps" | "percent" | "dollar";

export interface FigureMatch {
  kind: FigureKind;
  text: string;
  column: number;
}

// Each pattern requires actual digits adjacent to a unit, so schema field names,
// the word "percent" on its own, and bare placeholders never match.
const PATTERNS: ReadonlyArray<{ kind: FigureKind; re: RegExp }> = [
  { kind: "bps", re: /\b\d+(?:\.\d+)?\s?(?:bps|basis points?)\b/gi },
  { kind: "percent", re: /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi },
  { kind: "dollar", re: /\$\s?\d+(?:\.\d+)?\s?(?:[kmb])?\b/gi },
];

// Scan a single line and return every literal figure it contains. A line that
// carries the allow marker is exempt in full.
export function scanLineForLiteralFigures(line: string): FigureMatch[] {
  if (line.includes(PROMPT_HYGIENE_ALLOW_MARKER)) return [];
  const out: FigureMatch[] = [];
  for (const { kind, re } of PATTERNS) {
    for (const m of line.matchAll(re)) {
      out.push({ kind, text: m[0], column: (m.index ?? 0) + 1 });
    }
  }
  return out;
}
