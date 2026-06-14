import { createRequire } from "node:module";
import { assertDerivedSignalSet } from "@workspace/db/contracts";
import type {
  Connector,
  ConnectorContext,
  DerivedSignalSet,
  ExtractionScope,
  WatermarkValue,
} from "./contract";

// A connector's extractSignals is the one place raw client data is touched. The
// contract already withholds any database or filesystem handle from the
// ConnectorContext, so a well-behaved connector has no capability to persist.
// This guard adds a runtime tripwire for the ambient case: for the duration of
// an extraction it patches the filesystem write surface, so a connector that
// reaches for node:fs through require throws instead of writing raw records to
// disk. The static import-boundary test forbids connector source from importing
// node:fs at all; this is the defense-in-depth layer behind it. Reads are left
// alone; only writes are blocked, and only while an extraction is on the stack.
//
// ESM named imports of node:fs are read-only bindings and cannot be patched, so
// the static import-boundary test (not this guard) is what closes that vector.
// This guard catches require-based and obfuscated access; together they cover
// both. The patch is process-wide for its short window, so it deliberately does
// not block ESM-imported fs used elsewhere; it targets the require surface a
// connector would have to reach through.

const nodeRequire = createRequire(import.meta.url);

const FS_WRITE_METHODS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "open",
  "openSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
  "truncate",
  "truncateSync",
  "ftruncate",
  "ftruncateSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "utimes",
  "utimesSync",
] as const;

const FSP_WRITE_METHODS = [
  "writeFile",
  "appendFile",
  "open",
  "truncate",
  "mkdir",
  "mkdtemp",
  "rm",
  "rmdir",
  "unlink",
  "rename",
  "copyFile",
  "cp",
  "symlink",
  "link",
  "chmod",
  "chown",
  "utimes",
] as const;

// Reference counted so overlapping extractions keep the guard installed: only the
// outermost install patches and only the outermost remove restores.
let depth = 0;
const saved = new Map<string, unknown>();

function blocked(name: string): () => never {
  return () => {
    throw new Error(
      "Connector extraction attempted a filesystem write (" +
        name +
        "), which is forbidden: connectors derive and discard, they never persist raw data.",
    );
  };
}

function patch(obj: Record<string, unknown>, prefix: string, name: string, label: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(obj, name);
  if (!descriptor || descriptor.writable !== true || typeof obj[name] !== "function") return;
  saved.set(prefix + ":" + name, obj[name]);
  obj[name] = blocked(label + "." + name);
}

function installFsWriteGuard(): void {
  if (depth === 0) {
    const fs = nodeRequire("node:fs") as Record<string, unknown>;
    const fsp = nodeRequire("node:fs/promises") as Record<string, unknown>;
    for (const name of FS_WRITE_METHODS) patch(fs, "fs", name, "fs");
    for (const name of FSP_WRITE_METHODS) patch(fsp, "fsp", name, "fs/promises");
  }
  depth += 1;
}

function removeFsWriteGuard(): void {
  depth -= 1;
  if (depth === 0) {
    const fs = nodeRequire("node:fs") as Record<string, unknown>;
    const fsp = nodeRequire("node:fs/promises") as Record<string, unknown>;
    for (const [key, fn] of saved) {
      const sep = key.indexOf(":");
      const prefix = key.slice(0, sep);
      const name = key.slice(sep + 1);
      if (prefix === "fs") fs[name] = fn;
      else fsp[name] = fn;
    }
    saved.clear();
  }
}

// The normalized result of a guarded extraction: the asserted derive-and-discard
// math, plus an optional next cursor for an incremental source.
export interface GuardedExtraction {
  set: DerivedSignalSet;
  nextWatermark?: WatermarkValue;
}

// Run a connector's extraction with the filesystem write guard installed, then
// assert the result is a derive-and-discard DerivedSignalSet. Both the disk
// tripwire and the raw-content assertion fail the extraction loudly; the caller
// (never the connector) is what persists what this returns. A connector may
// return just the math, or the math plus a next cursor; either way the set is
// asserted here, and the watermark, if any, is a scalar cursor and never raw
// source data.
export async function guardedExtractSignals(
  connector: Connector,
  scope: ExtractionScope,
  ctx: ConnectorContext,
): Promise<GuardedExtraction> {
  installFsWriteGuard();
  let raw: unknown;
  try {
    raw = await connector.extractSignals(scope, ctx);
  } finally {
    removeFsWriteGuard();
  }
  if (raw !== null && typeof raw === "object" && "set" in (raw as Record<string, unknown>)) {
    const wrapped = raw as { set: unknown; nextWatermark?: WatermarkValue };
    return { set: assertDerivedSignalSet(wrapped.set), nextWatermark: wrapped.nextWatermark };
  }
  return { set: assertDerivedSignalSet(raw) };
}
