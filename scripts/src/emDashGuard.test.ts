import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findLongDashViolations, formatViolations } from "./emDashGuard";

const repoRoot = join(import.meta.dirname, "..", "..");

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("long-dash guard", () => {
  it("finds no long dash (em or en) anywhere in authored source", () => {
    const violations = findLongDashViolations(repoRoot);
    expect(violations, "Long dash found:\n" + formatViolations(violations)).toEqual([]);
  });

  it("detects a long em-dash when one is present", () => {
    const root = mkdtempSync(join(tmpdir(), "longdash-"));
    tempRoots.push(root);
    mkdirSync(join(root, "lib"));
    const withEmDash = "const note = 'before" + String.fromCharCode(0x2014) + "after';\n";
    writeFileSync(join(root, "lib", "offender.ts"), withEmDash, "utf8");

    const violations = findLongDashViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("lib/offender.ts");
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.dash).toBe("em");
  });

  it("detects a long en-dash when one is present", () => {
    const root = mkdtempSync(join(tmpdir(), "longdash-"));
    tempRoots.push(root);
    mkdirSync(join(root, "docs"));
    const withEnDash = "ranges 10" + String.fromCharCode(0x2013) + "20\n";
    writeFileSync(join(root, "docs", "ranges.md"), withEnDash, "utf8");

    const violations = findLongDashViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("docs/ranges.md");
    expect(violations[0]?.dash).toBe("en");
  });

  it("ignores excluded directories", () => {
    const root = mkdtempSync(join(tmpdir(), "longdash-"));
    tempRoots.push(root);
    mkdirSync(join(root, "lib", "node_modules"), { recursive: true });
    const withEmDash = "x" + String.fromCharCode(0x2014) + "y\n";
    writeFileSync(join(root, "lib", "node_modules", "vendor.ts"), withEmDash, "utf8");

    expect(findLongDashViolations(root)).toEqual([]);
  });
});
