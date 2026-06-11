// Invariant: model identifier strings live ONLY in config.ts. Every stage
// resolves its model through this module, so a literal model string anywhere
// else under src/ is a drift bug. This test scans the source tree and fails if
// any of the configured model identifiers appears outside config.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEATS, modelForStage, seatForStage, LAYER_STAGES } from "./config";

const SRC_DIR = import.meta.dirname;
const MODEL_STRINGS = Object.values(SEATS).map((s) => s.model);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      // config.ts is the sanctioned home; test files may reference strings.
      if (entry.name === "config.ts" || entry.name.endsWith(".test.ts")) continue;
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe("CORTEX configuration", () => {
  it("defines a distinct model for all three seats", () => {
    expect(MODEL_STRINGS).toHaveLength(3);
    expect(new Set(MODEL_STRINGS).size).toBe(3);
  });

  it("resolves a model and seat for every layer stage", () => {
    for (const stage of LAYER_STAGES) {
      expect(modelForStage(stage)).toBeTruthy();
      expect(seatForStage(stage).model).toBe(modelForStage(stage));
    }
  });

  it("places the confound stage before the challenge stage", () => {
    expect(LAYER_STAGES.indexOf("confound")).toBeGreaterThanOrEqual(0);
    expect(LAYER_STAGES.indexOf("confound")).toBeLessThan(LAYER_STAGES.indexOf("challenge"));
  });

  it("never repeats a model identifier string outside config.ts", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const model of MODEL_STRINGS) {
        if (content.includes(model)) offenders.push(`${file} contains '${model}'`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
