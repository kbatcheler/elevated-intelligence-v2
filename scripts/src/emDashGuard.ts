import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The long dashes are forbidden everywhere in authored source: the em-dash
// (U+2014) and the en-dash (U+2013). ASCII hyphen only. This guard scans the
// directories we author and reports every occurrence so CI fails loudly. The
// characters are written as escapes here so this file never contains the literal
// bytes it hunts for.
const LONG_DASHES: ReadonlyArray<{ ch: string; kind: "em" | "en" }> = [
  { ch: "\u2014", kind: "em" },
  { ch: "\u2013", kind: "en" },
];

// Directories we author and therefore enforce.
const SCAN_DIRS = ["lib", "artifacts", "docs", "scripts"];

// Directories that are vendored, generated, external specifications, or tooling
// state. We never enforce the rule inside them.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "reference",
  "build-prompts",
  "dist",
  "build",
  ".local",
  ".cache",
  ".git",
  "attached_assets",
]);

// Only scan text source files we write.
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".sql",
]);

export interface LongDashViolation {
  file: string;
  line: number;
  column: number;
  dash: "em" | "en";
}

export function findLongDashViolations(rootDir: string): LongDashViolation[] {
  const violations: LongDashViolation[] = [];
  for (const dir of SCAN_DIRS) {
    walk(join(rootDir, dir), rootDir, violations);
  }
  return violations;
}

function walk(dir: string, rootDir: string, out: LongDashViolation[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), rootDir, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1) continue;
      if (!TEXT_EXT.has(entry.name.slice(dot))) continue;
      scanFile(join(dir, entry.name), rootDir, out);
    }
  }
}

function scanFile(file: string, rootDir: string, out: LongDashViolation[]): void {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const { ch, kind } of LONG_DASHES) {
      let col = line.indexOf(ch);
      while (col !== -1) {
        out.push({
          file: relative(rootDir, file).split(sep).join("/"),
          line: i + 1,
          column: col + 1,
          dash: kind,
        });
        col = line.indexOf(ch, col + 1);
      }
    }
  }
}

export function formatViolations(violations: LongDashViolation[]): string {
  return violations.map((v) => v.file + ":" + v.line + ":" + v.column + " (" + v.dash + "-dash)").join("\n");
}
