// Amazon S3 implementation of the ArchiveStore boundary, over the REST API with
// the Node global fetch and a zero-dependency SigV4 signer, mirroring the GCS
// adapter exactly: it is "available, not connected" until configured, and it
// never crashes the boot. Construction reads no config and validates nothing;
// the first put/get/list resolves the bucket, region, and credentials lazily and
// throws a precise error if any is missing, so a misconfiguration surfaces on
// first use rather than at startup.
//
// Write-once is enforced with the If-None-Match: * precondition, which S3 honours
// by failing a create when the object already exists (http 412). Requests use
// path-style addressing so the host stays stable and an S3-compatible endpoint
// can be pointed at for tests. Object names are validated against the archive key
// grammar before any network call. Credentials and object bytes are never logged,
// and an error never carries a response body.
import { resolveAwsCredentials, signRequestV4 } from "../aws/sigv4";
import {
  type ArchivePutOptions,
  type ArchiveStore,
  type ArchiveStoreDescription,
  assertValidKey,
} from "./archiveStore";

const DEFAULT_TIMEOUT_MS = 10_000;
const SERVICE = "s3";

export interface S3ArchiveOptions {
  bucket?: string;
  region?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class S3ArchiveStore implements ArchiveStore {
  private readonly options: S3ArchiveOptions;

  constructor(options: S3ArchiveOptions = {}) {
    this.options = options;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private get now(): () => Date {
    return this.options.now ?? (() => new Date());
  }

  private timeoutMs(): number {
    const raw = process.env.S3_ARCHIVE_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return this.options.timeoutMs ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS);
  }

  private bucketOrNull(): string | null {
    return this.options.bucket ?? process.env.S3_ARCHIVE_BUCKET ?? null;
  }

  private regionOrNull(): string | null {
    return this.options.region ?? process.env.S3_ARCHIVE_REGION ?? process.env.AWS_REGION ?? null;
  }

  // Lazy config resolution. The bucket is the primary connect signal, so its
  // absence is the "available, not connected" error; the region is required for
  // signing and reported separately if it alone is missing.
  private requireBucket(): string {
    const bucket = this.bucketOrNull();
    if (!bucket) {
      throw new Error("S3 archive store is available, not connected: set S3_ARCHIVE_BUCKET to connect it.");
    }
    return bucket;
  }

  private requireRegion(): string {
    const region = this.regionOrNull();
    if (!region) {
      throw new Error(
        "S3 archive store is available, not connected: set S3_ARCHIVE_REGION (or AWS_REGION) to connect it.",
      );
    }
    return region;
  }

  private endpoint(region: string): string {
    return (this.options.endpoint ?? process.env.S3_ARCHIVE_ENDPOINT ?? "https://s3." + region + ".amazonaws.com").replace(
      /\/+$/,
      "",
    );
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

  async put(key: string, bytes: Buffer, options: ArchivePutOptions = {}): Promise<void> {
    assertValidKey(key);
    const bucket = this.requireBucket();
    const region = this.requireRegion();
    const credentials = resolveAwsCredentials(this.options.credentials);
    const url = this.endpoint(region) + "/" + bucket + "/" + key;
    const headers: Record<string, string> = {};
    // The conditional create: S3 fails with 412 if the object already exists.
    if (options.writeOnce) headers["If-None-Match"] = "*";
    return this.withTimeout(async (signal) => {
      const signed = signRequestV4({
        method: "PUT",
        url,
        region,
        service: SERVICE,
        credentials,
        headers,
        payload: bytes,
        addContentSha256Header: true,
        now: this.now(),
      });
      const res = await this.fetchImpl(url, { method: "PUT", headers: signed.headers, body: bytes, signal });
      if (res.status === 412) {
        throw new Error('Archive object already exists (write-once): "' + key + '"');
      }
      if (res.status !== 200) {
        throw new Error("S3 archive put failed with http " + res.status);
      }
    });
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidKey(key);
    const bucket = this.requireBucket();
    const region = this.requireRegion();
    const credentials = resolveAwsCredentials(this.options.credentials);
    const url = this.endpoint(region) + "/" + bucket + "/" + key;
    return this.withTimeout(async (signal) => {
      const signed = signRequestV4({
        method: "GET",
        url,
        region,
        service: SERVICE,
        credentials,
        addContentSha256Header: true,
        now: this.now(),
      });
      const res = await this.fetchImpl(url, { method: "GET", headers: signed.headers, signal });
      if (res.status === 404) return null;
      if (res.status !== 200) {
        throw new Error("S3 archive get failed with http " + res.status);
      }
      return Buffer.from(await res.arrayBuffer());
    });
  }

  async list(prefix: string): Promise<string[]> {
    const bucket = this.requireBucket();
    const region = this.requireRegion();
    const credentials = resolveAwsCredentials(this.options.credentials);
    const url = this.endpoint(region) + "/" + bucket + "?list-type=2&prefix=" + encodeURIComponent(prefix);
    return this.withTimeout(async (signal) => {
      const signed = signRequestV4({
        method: "GET",
        url,
        region,
        service: SERVICE,
        credentials,
        addContentSha256Header: true,
        now: this.now(),
      });
      const res = await this.fetchImpl(url, { method: "GET", headers: signed.headers, signal });
      if (res.status !== 200) {
        throw new Error("S3 archive list failed with http " + res.status);
      }
      // ListObjectsV2 returns XML. The archive key grammar admits no XML-special
      // characters, so the object names are extracted from <Key> elements with a
      // simple scan and never need entity decoding.
      const xml = await res.text();
      const keys: string[] = [];
      const re = /<Key>([^<]*)<\/Key>/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(xml)) !== null) {
        const name = match[1] ?? "";
        if (name && name.startsWith(prefix)) keys.push(name);
      }
      keys.sort();
      return keys;
    });
  }

  describe(): ArchiveStoreDescription {
    return { provider: "s3", connected: Boolean(this.bucketOrNull() && this.regionOrNull()) };
  }
}
