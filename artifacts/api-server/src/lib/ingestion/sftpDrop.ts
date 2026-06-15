import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { ingestDerivedSignalSet } from "./ingestCore";
import { assertIngestibleLayer, IngestionLayerError } from "./layers";
import { deriveUpload, MAX_UPLOAD_BYTES, UploadError } from "./uploadDerive";

// The SFTP-drop ingestion path (Phase AE, path 4). The SFTP server itself is an
// available-not-connected boundary: this process does NOT run an SFTP daemon
// (that would be a dependency and a credential store we have no honest way to
// operate here). Instead it watches a drop directory that an external SFTP
// server writes into, one inbound tree per tenant and target layer:
//
//   <SFTP_DROP_DIR>/<tenantId>/<layerKey>/<file.csv|xlsx|pdf|docx>
//
// Each file is parsed and derived in memory through the SAME deriveUpload
// dispatcher the manual-upload route uses, the numeric math flows through the one
// shared derive-and-discard terminus, and the file is DELETED whether it succeeds
// or fails, so no raw artifact ever survives on disk. A file that cannot be
// parsed or derived is deleted too, but only after its rejection reason is logged
// loudly with the tenant, layer, and filename: it is discarded honestly (with a
// durable warning the operator can act on), not silently dropped and not left as
// a lingering ".rejected" raw artifact. The inbound tree is the SFTP server's
// staging area, not our derived store; the store still holds only encrypted
// numeric math.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_QUIET_MS = 2000;
const DEFAULT_INTERVAL_MS = 30_000;

export interface SftpDropLogger {
  info: (fields: Record<string, unknown>, msg: string) => void;
  warn: (fields: Record<string, unknown>, msg: string) => void;
  error: (fields: Record<string, unknown>, msg: string) => void;
}

export interface SftpDropOptions {
  // Override the drop root (tests pass an isolated temp dir).
  root?: string;
  // A file must be unmodified for at least this long before it is processed, so a
  // partially written upload is never parsed mid-transfer. Tests pass 0.
  quietMs?: number;
}

export interface SftpDropSummary {
  scanned: number;
  processed: number;
  rejected: number;
  skipped: number;
}

export function getSftpDropRoot(): string {
  const fromEnv = process.env.SFTP_DROP_DIR;
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(tmpdir(), "ei-sftp-drop");
}

function getQuietMs(): number {
  const raw = process.env.SFTP_DROP_QUIET_MS;
  if (raw === undefined) return DEFAULT_QUIET_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_QUIET_MS;
}

async function listDirs(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !n.startsWith("."));
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return rows.length > 0;
}

// Process exactly one dropped file: derive in memory, persist the math, then
// delete the raw file. A parse/derive/validation failure logs the reason loudly
// and then DELETES the file too, so a rejected raw artifact is discarded honestly
// rather than parked on disk; the operator acts on the logged warning, not on a
// lingering ".rejected" copy.
async function processOne(
  filePath: string,
  filename: string,
  tenantId: string,
  layer: string,
  log: SftpDropLogger,
): Promise<"processed" | "rejected"> {
  let bytes: Buffer;
  try {
    const info = await stat(filePath);
    if (info.size > MAX_UPLOAD_BYTES) {
      log.warn(
        { tenantId, layer, filename, bytes: info.size },
        "sftp drop file too large; rejected and discarded",
      );
      await rm(filePath, { force: true });
      return "rejected";
    }
    bytes = await readFile(filePath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error({ tenantId, layer, filename, reason }, "sftp drop read failed");
    return "rejected";
  }

  try {
    await assertIngestibleLayer(tenantId, layer);
    const derivation = await deriveUpload({ filename, mime: "", bytes, targetLayer: layer });
    const result = await ingestDerivedSignalSet({
      tenantId,
      method: "sftp",
      feedKey: layer,
      layers: [layer],
      signals: derivation.signals,
    });
    // Discard the raw artifact now that the math is persisted.
    await rm(filePath, { force: true });
    log.info(
      { tenantId, layer, filename, signalsCount: result.signalsCount, rootHash: result.rootHash },
      "sftp drop file ingested and discarded",
    );
    return "processed";
  } catch (err) {
    const reason =
      err instanceof UploadError || err instanceof IngestionLayerError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ tenantId, layer, filename, reason }, "sftp drop file rejected and discarded");
    // Discard the rejected raw file too: the loud warning above is the durable
    // record, so no raw artifact is left parked on disk.
    await rm(filePath, { force: true });
    return "rejected";
  }
}

export async function processSftpDropOnce(
  log: SftpDropLogger,
  opts: SftpDropOptions = {},
): Promise<SftpDropSummary> {
  const root = opts.root ?? getSftpDropRoot();
  const quietMs = opts.quietMs ?? getQuietMs();
  const summary: SftpDropSummary = { scanned: 0, processed: 0, rejected: 0, skipped: 0 };

  let tenantDirs: string[];
  try {
    tenantDirs = await listDirs(root);
  } catch {
    // No drop root yet: nothing to do, not an error.
    return summary;
  }

  const now = Date.now();
  for (const tenantId of tenantDirs) {
    if (!UUID_RE.test(tenantId)) {
      summary.skipped += 1;
      continue;
    }
    if (!(await tenantExists(tenantId))) {
      log.warn({ tenantId }, "sftp drop tenant dir for unknown tenant; skipped");
      summary.skipped += 1;
      continue;
    }
    const tenantPath = join(root, tenantId);
    const layerDirs = await listDirs(tenantPath);
    for (const layer of layerDirs) {
      const layerPath = join(tenantPath, layer);
      const files = await listFiles(layerPath);
      for (const filename of files) {
        const filePath = join(layerPath, filename);
        summary.scanned += 1;
        try {
          const info = await stat(filePath);
          // mtimeMs carries sub-millisecond precision while Date.now() is integer
          // milliseconds, so a file written in the same tick can read as a hair in
          // the "future" and yield a negative age. Clamp to zero so a freshly
          // dropped file is always eligible when quietMs is 0, while a file still
          // being written (age below the quiet window) is correctly deferred.
          const ageMs = Math.max(0, now - info.mtimeMs);
          if (ageMs < quietMs) {
            summary.skipped += 1;
            continue; // still being written; wait for the next tick
          }
        } catch {
          summary.skipped += 1;
          continue;
        }
        const outcome = await processOne(filePath, filename, tenantId, layer, log);
        if (outcome === "processed") summary.processed += 1;
        else summary.rejected += 1;
      }
    }
  }

  return summary;
}

export interface SftpDropHandle {
  stop: () => void;
}

// Start the in-process SFTP-drop watcher. Mirrors the retention, backup, and
// notifier loops exactly: started ONLY from the server entrypoint, never
// overlapping, swallowing a tick failure, with an unref'd timer so it never
// keeps the process alive on its own.
export function startSftpDropWatcher(
  log: SftpDropLogger,
  options: { intervalMs?: number } = {},
): SftpDropHandle {
  const raw = process.env.SFTP_DROP_INTERVAL_MS;
  const fromEnv = raw === undefined ? NaN : Number(raw);
  const intervalMs =
    options.intervalMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_INTERVAL_MS);
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await processSftpDropOnce(log);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error({ reason }, "sftp drop tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
