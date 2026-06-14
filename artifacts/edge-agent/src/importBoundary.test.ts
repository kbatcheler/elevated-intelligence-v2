import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Every module specifier referenced from a source file: static `from "x"`,
// bare `import "x"`, and dynamic or type-position `import("x")`.
function moduleSpecifiers(src: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
      specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

// The edge agent runs inside the client's own network. Its graph must reach only
// the connector framework (which itself imports the contracts subpath, never the
// db root) plus Node built-ins. It must never import @workspace/db, the API
// server, or any other workspace package: it has no business touching our store.
describe("edge agent import boundary", () => {
  it("imports only @workspace/connectors and Node built-ins", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(here))) {
      for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
        const allowed =
          specifier.startsWith(".") ||
          specifier.startsWith("node:") ||
          specifier === "@workspace/connectors";
        if (!allowed) {
          offenders.push(path.relative(here, file) + " imports " + specifier);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never imports the @workspace/db root or any db subpath", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(here))) {
      const src = readFileSync(file, "utf8");
      if (src.includes("@workspace/db")) {
        offenders.push(path.relative(here, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
