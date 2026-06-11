import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The long em-dash (U+2014) is forbidden everywhere in authored source. This
// guard scans the directories we author and reports every occurrence so CI
// fails loudly. The character is written as an escape here so this file never
// contains the literal byte it hunts for.
const EM_DASH = "\u2014";

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

export interface EmDashViolation {
  file: string;
  line: number;
  column: number;
}

export function findEmDashViolations(rootDir: string): EmDashViolation[] {
  const violations: EmDashViolation[] = [];
  for (const dir of SCAN_DIRS) {
    walk(join(rootDir, dir), rootDir, violations);
  }
  return violations;
}

function walk(dir: string, rootDir: string, out: EmDashViolation[]): void {
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

function scanFile(file: string, rootDir: string, out: EmDashViolation[]): void {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    let col = line.indexOf(EM_DASH);
    while (col !== -1) {
      out.push({ file: relative(rootDir, file).split(sep).join("/"), line: i + 1, column: col + 1 });
      col = line.indexOf(EM_DASH, col + 1);
    }
  }
}

export function formatViolations(violations: EmDashViolation[]): string {
  return violations.map((v) => v.file + ":" + v.line + ":" + v.column).join("\n");
}
