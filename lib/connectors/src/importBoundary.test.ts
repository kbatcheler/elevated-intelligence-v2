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

// Importing the @workspace/db root opens the application database pool as a side
// effect. The connector framework must stay clear of it and import only the
// side-effect-free contracts subpath, so a connector can run inside the
// in-client edge agent with no access to our store.
describe("derive-and-discard import boundary", () => {
  it("no connector source imports the @workspace/db root, only its contracts subpath", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(here)) {
      const src = readFileSync(file, "utf8");
      if (src.includes('@workspace/db"') || src.includes("@workspace/db'")) {
        offenders.push(path.relative(here, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
