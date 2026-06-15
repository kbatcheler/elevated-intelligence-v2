// Google Cloud Storage implementation of the ArchiveStore boundary, over the
// JSON and media REST APIs with the Node global fetch and zero SDK dependency,
// mirroring the GCP Secret Manager adapter exactly: it is "available, not
// connected" until configured, and it never crashes the boot. Construction reads
// no config and validates nothing; the first put/get/list resolves the bucket
// and a token lazily and throws a precise error if either is missing, so a
// misconfiguration surfaces on first use rather than at startup.
//
// Write-once is enforced with the ifGenerationMatch=0 precondition, which GCS
// honours by failing a create when the object already exists (http 412). Object
// names are validated against the archive key grammar before any network call.
// Access tokens and object bytes are never logged, and an error never carries a
// response body.
import {
  type ArchivePutOptions,
  type ArchiveStore,
  type ArchiveStoreDescription,
  assertValidKey,
} from "./archiveStore";

const DEFAULT_ENDPOINT = "https://storage.googleapis.com";
const DEFAULT_METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface GcsArchiveOptions {
  bucket?: string;
  endpoint?: string;
  timeoutMs?: number;
  tokenSource?: "metadata" | "env";
  accessToken?: string;
  metadataUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export class GcsArchiveStore implements ArchiveStore {
  private readonly options: GcsArchiveOptions;
  private cachedToken: CachedToken | null = null;

  constructor(options: GcsArchiveOptions = {}) {
    this.options = options;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private get now(): () => number {
    return this.options.now ?? Date.now;
  }

  private endpoint(): string {
    return (this.options.endpoint ?? process.env.GCS_ARCHIVE_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  }

  private timeoutMs(): number {
    const raw = process.env.GCS_ARCHIVE_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return this.options.timeoutMs ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS);
  }

  private bucketOrNull(): string | null {
    return this.options.bucket ?? process.env.GCS_ARCHIVE_BUCKET ?? null;
  }

  // Lazy config resolution. Throws a precise "available, not connected" error on
  // first use when the bucket is not set, never at construction.
  private requireBucket(): string {
    const bucket = this.bucketOrNull();
    if (!bucket) {
      throw new Error(
        "GCS archive store is available, not connected: set GCS_ARCHIVE_BUCKET to connect it.",
      );
    }
    return bucket;
  }

  private async withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    const source = this.options.tokenSource ?? process.env.GCS_ARCHIVE_TOKEN_SOURCE ?? "metadata";
    if (source === "env") {
      const token = this.options.accessToken ?? process.env.GCS_ARCHIVE_ACCESS_TOKEN;
      if (!token) {
        throw new Error("GCS archive token source is env but GCS_ARCHIVE_ACCESS_TOKEN is not set.");
      }
      return token;
    }

    if (this.cachedToken && this.cachedToken.expiresAtMs > this.now() + 60_000) {
      return this.cachedToken.token;
    }
    const metadataUrl = this.options.metadataUrl ?? DEFAULT_METADATA_URL;
    const res = await this.fetchImpl(metadataUrl, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      signal,
    });
    if (res.status !== 200) {
      throw new Error("GCS metadata token request failed with http " + res.status);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error("GCS metadata token response did not include an access token.");
    }
    const ttlMs = (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
    this.cachedToken = { token: body.access_token, expiresAtMs: this.now() + ttlMs };
    return body.access_token;
  }

  async put(key: string, bytes: Buffer, options: ArchivePutOptions = {}): Promise<void> {
    assertValidKey(key);
    const bucket = this.requireBucket();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const params = new URLSearchParams({ uploadType: "media", name: key });
      if (options.writeOnce) params.set("ifGenerationMatch", "0");
      const url = this.endpoint() + "/upload/storage/v1/b/" + encodeURIComponent(bucket) + "/o?" + params.toString();
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: bytes,
        signal,
      });
      if (res.status === 412) {
        throw new Error('Archive object already exists (write-once): "' + key + '"');
      }
      if (res.status !== 200) {
        throw new Error("GCS archive put failed with http " + res.status);
      }
    });
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidKey(key);
    const bucket = this.requireBucket();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const url =
        this.endpoint() + "/storage/v1/b/" + encodeURIComponent(bucket) + "/o/" + encodeURIComponent(key) + "?alt=media";
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        signal,
      });
      if (res.status === 404) return null;
      if (res.status !== 200) {
        throw new Error("GCS archive get failed with http " + res.status);
      }
      return Buffer.from(await res.arrayBuffer());
    });
  }

  async list(prefix: string): Promise<string[]> {
    const bucket = this.requireBucket();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const url =
        this.endpoint() +
        "/storage/v1/b/" +
        encodeURIComponent(bucket) +
        "/o?prefix=" +
        encodeURIComponent(prefix);
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        signal,
      });
      if (res.status !== 200) {
        throw new Error("GCS archive list failed with http " + res.status);
      }
      const body = (await res.json()) as { items?: { name?: string }[] };
      return (body.items ?? []).map((i) => i.name ?? "").filter(Boolean).sort();
    });
  }

  describe(): ArchiveStoreDescription {
    return { provider: "gcs", connected: Boolean(this.bucketOrNull()) };
  }
}
