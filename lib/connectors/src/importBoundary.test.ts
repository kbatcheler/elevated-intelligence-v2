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

// The capabilities a connector must never reach for in its extraction graph: a
// filesystem handle (it could write raw records to disk) or a subprocess (it
// could exfiltrate them). The guard module is allowed to name node:fs because it
// is the tripwire that patches the write surface, not an extraction path.
const FORBIDDEN_CAPABILITIES = [
  '"node:fs"',
  "'node:fs'",
  '"node:fs/promises"',
  "'node:fs/promises'",
  '"fs"',
  "'fs'",
  '"fs/promises"',
  "'fs/promises'",
  '"node:child_process"',
  "'node:child_process'",
  '"child_process"',
  "'child_process'",
] as const;

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

  // The extraction graph is the connector implementations under src/connectors.
  // They must derive and discard: no filesystem, no subprocess. The static check
  // is the primary guarantee (a connector cannot write what it cannot import);
  // guardedExtractSignals is the runtime tripwire behind it.
  it("no connector implementation imports a filesystem or subprocess capability", () => {
    const implementationsDir = path.join(here, "connectors");
    const offenders: string[] = [];
    for (const file of sourceFiles(implementationsDir)) {
      const src = readFileSync(file, "utf8");
      for (const capability of FORBIDDEN_CAPABILITIES) {
        if (src.includes(capability)) {
          offenders.push(path.relative(here, file) + " reaches for " + capability);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
