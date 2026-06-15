// The durable object-storage boundary for backups (Phase U). Every archive is
// written through this interface, never to a hard-coded path or SDK at the call
// site, so the local-dev store can be swapped for a managed object store without
// touching the exporter. It mirrors the SecretStore seam: one interface, a local
// default that runs on a laptop, and an "available, not connected" managed
// adapter selected by an env var.
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GcsArchiveStore } from "./gcsArchiveStore";
import { S3ArchiveStore } from "./s3ArchiveStore";

export interface ArchivePutOptions {
  // When true, fail loudly rather than overwrite an existing object, so an
  // append-only archive can never be silently clobbered. The local store uses an
  // exclusive-create open; the GCS store uses an ifGenerationMatch=0 precondition.
  writeOnce?: boolean;
}

export interface ArchiveStoreDescription {
  // A provider keyword for honest status reporting. Never a path, bucket, or
  // credential, so /api/backups/status never leaks configuration.
  provider: string;
  // Whether the durable store is actually configured to connect. The local store
  // is always connected; the GCS store is connected only once its bucket is set.
  connected: boolean;
}

export interface ArchiveStore {
  put(key: string, bytes: Buffer, options?: ArchivePutOptions): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  describe(): ArchiveStoreDescription;
}

// An object key is a forward-slash path of safe segments. No segment may be
// empty, ".", or ".." so a key can never escape the local root or smuggle a
// traversal into a storage path. The same grammar is valid for a GCS object name.
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertValidKey(key: string): void {
  const segments = key.split("/");
  if (segments.length === 0 || segments.some((s) => s === "" || s === "." || s === ".." || !KEY_SEGMENT.test(s))) {
    throw new Error(
      'Invalid archive key "' + key + '": each segment must be letters, digits, dot, underscore, or hyphen.',
    );
  }
}

// Local filesystem archive store. This is the development default and is honest
// about what it is: a real, writable store on the local disk, not durable object
// storage. Production sets ARCHIVE_STORE_PROVIDER=gcs for the durable path. The
// default directory is under the OS temp dir so a dev run never writes into the
// repository tree; set ARCHIVE_LOCAL_DIR to pin it elsewhere.
export class LocalFsArchiveStore implements ArchiveStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? process.env.ARCHIVE_LOCAL_DIR ?? path.join(tmpdir(), "ei-ledger-archive");
  }

  private resolve(key: string): string {
    assertValidKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, bytes: Buffer, options: ArchivePutOptions = {}): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // wx fails if the file already exists, giving write-once semantics; w
    // overwrites. Either way the bytes are flushed before the promise resolves.
    const flag = options.writeOnce ? "wx" : "w";
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(full, { flags: flag });
      out.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EEXIST") {
          reject(new Error('Archive object already exists (write-once): "' + key + '"'));
          return;
        }
        reject(err);
      });
      out.on("finish", () => resolve());
      out.end(bytes);
    });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        throw err;
      });
      if (entries === null) return;
      for (const entry of entries) {
        const childRel = rel ? rel + "/" + entry.name : entry.name;
        const childAbs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(childAbs, childRel);
        } else if (childRel.startsWith(prefix)) {
          out.push(childRel);
        }
      }
    };
    await walk(this.root, "");
    out.sort();
    return out;
  }

  describe(): ArchiveStoreDescription {
    return { provider: "local", connected: true };
  }

  // Test and runbook helper: the configured root, used by the restore runbook to
  // locate archives. Not part of the interface, so consumers stay storage-agnostic.
  rootDir(): string {
    return this.root;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }
}

let activeStore: ArchiveStore | null = null;

// Construct the archive store the environment selects. The default is the local
// filesystem store; ARCHIVE_STORE_PROVIDER=gcs selects the GCS REST adapter. Like
// the secret store, the adapter is "available, not connected" until configured:
// it is constructed here validating nothing, so an unset bucket never crashes the
// boot and only surfaces on first use.
function createSelectedStore(): ArchiveStore {
  const provider = (process.env.ARCHIVE_STORE_PROVIDER ?? "local").trim().toLowerCase();
  if (provider === "gcs") {
    return new GcsArchiveStore();
  }
  if (provider === "s3") {
    return new S3ArchiveStore();
  }
  return new LocalFsArchiveStore();
}

export function getArchiveStore(): ArchiveStore {
  if (!activeStore) {
    activeStore = createSelectedStore();
  }
  return activeStore;
}

// Test seam: override the active store, or reset to null to re-select from env.
export function setArchiveStore(store: ArchiveStore | null): void {
  activeStore = store;
}
