import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROMPT_HYGIENE_ALLOW_MARKER,
  scanLineForLiteralFigures,
  type FigureMatch,
} from "./promptHygiene";

// The authored prompt sources live in this directory. We scan every prompt
// builder file but skip the tests (which carry deliberate offending strings) and
// the guard module itself (whose regexes mention the units but never a literal
// figure). New prompt files are covered automatically.
const promptsDir = import.meta.dirname;

interface FileViolation extends FigureMatch {
  file: string;
  line: number;
}

function scanPromptSources(dir: string): FileViolation[] {
  const out: FileViolation[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (entry.name === "promptHygiene.ts") continue;
    const text = readFileSync(join(dir, entry.name), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of scanLineForLiteralFigures(lines[i] ?? "")) {
        out.push({ ...m, file: entry.name, line: i + 1 });
      }
    }
  }
  return out;
}

describe("prompt-hygiene guard (no literal example figures in prompt source)", () => {
  it("finds no literal example figure in the authored prompt sources", () => {
    const violations = scanPromptSources(promptsDir);
    const detail = violations.map((v) => `${v.file}:${v.line} ${v.kind} "${v.text}"`).join("\n");
    expect(violations, "Literal example figure found in prompt source:\n" + detail).toEqual([]);
  });

  it("detects each kind of literal figure in offending text (breaking the invariant turns red)", () => {
    expect(scanLineForLiteralFigures("margins compressed by 120bps last year")[0]?.kind).toBe("bps");
    expect(scanLineForLiteralFigures("up 250 basis points")[0]?.kind).toBe("bps");
    expect(scanLineForLiteralFigures("gross margin sits around 12.5% today")[0]?.kind).toBe("percent");
    expect(scanLineForLiteralFigures("churn near 8 percent")[0]?.kind).toBe("percent");
    expect(scanLineForLiteralFigures("a one-off cost of $1.2M hit the quarter")[0]?.kind).toBe("dollar");
    expect(scanLineForLiteralFigures("burned $50k in ads")[0]?.kind).toBe("dollar");
  });

  it("ignores legitimate prompt content (placeholders, scale bounds, schema keys, interpolation)", () => {
    expect(scanLineForLiteralFigures('  "confidence": 0,')).toEqual([]);
    expect(scanLineForLiteralFigures('      "rank": 1,')).toEqual([]);
    expect(scanLineForLiteralFigures("assign a numeric confidence (0 to 100)")).toEqual([]);
    expect(scanLineForLiteralFigures("an integer from 0 to 95: the engine never claims")).toEqual([]);
    expect(scanLineForLiteralFigures("report movements in basis points or percentages")).toEqual([]);
    expect(scanLineForLiteralFigures("lines.push(`REVENUE BAND: ${profile.revenueBand}`);")).toEqual([]);
    expect(scanLineForLiteralFigures("for (const [k, v] of vocab.slice(0, 16)) lines.push(k);")).toEqual([]);
  });

  it("honours the inline allow marker as the single reviewed escape hatch", () => {
    const line = `illustrative only: a fine of $1.2M // ${PROMPT_HYGIENE_ALLOW_MARKER}`;
    expect(scanLineForLiteralFigures(line)).toEqual([]);
  });
});
