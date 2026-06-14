// GCP Secret Manager implementation of the SecretStore boundary, over the REST
// API with the Node global fetch and zero SDK dependency, mirroring the customer
// KMS adapter pattern: it is "available, not connected" until it is configured,
// and it never crashes the boot. Construction reads no config and validates
// nothing; the first get/set/delete resolves the project and a token lazily and
// throws a precise error if either is missing, so a misconfiguration surfaces on
// first use rather than at startup.
//
// A ref is an opaque secret name (for example "SESSION_SECRET"). It maps onto a
// Secret Manager secret id of the same name, validated against the provider's id
// grammar so a ref can never smuggle a path traversal or a full resource name.
// Secret values and access tokens are never logged, and an error never carries a
// response body, because the access response body is the secret itself.
import type { SecretStore } from "./secretStore";

// Secret Manager secret ids are 1 to 255 characters of letters, digits,
// underscores, and hyphens. Anything else (a slash, a dot, a full resource path)
// is rejected before any network call.
const SECRET_ID = /^[A-Za-z0-9_-]{1,255}$/;

const DEFAULT_ENDPOINT = "https://secretmanager.googleapis.com";
const DEFAULT_METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const DEFAULT_TIMEOUT_MS = 5000;

export interface GcpSecretManagerOptions {
  projectId?: string;
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

export class GcpSecretManagerSecretStore implements SecretStore {
  private readonly options: GcpSecretManagerOptions;
  private cachedToken: CachedToken | null = null;

  constructor(options: GcpSecretManagerOptions = {}) {
    this.options = options;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private get now(): () => number {
    return this.options.now ?? Date.now;
  }

  private endpoint(): string {
    return (
      this.options.endpoint ?? process.env.GCP_SECRET_MANAGER_ENDPOINT ?? DEFAULT_ENDPOINT
    ).replace(/\/+$/, "");
  }

  private timeoutMs(): number {
    const raw = process.env.GCP_SECRET_MANAGER_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return this.options.timeoutMs ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS);
  }

  // Lazy config resolution. Throws a precise "available, not connected" error on
  // first use when the project is not set, never at construction.
  private requireProjectId(): string {
    const projectId = this.options.projectId ?? process.env.GCP_PROJECT_ID;
    if (!projectId) {
      throw new Error(
        "GCP Secret Manager is available, not connected: set GCP_PROJECT_ID to connect it.",
      );
    }
    return projectId;
  }

  private validateRef(ref: string): void {
    if (!SECRET_ID.test(ref)) {
      throw new Error(
        'Invalid secret reference "' + ref + '": a GCP secret id is 1 to 255 letters, digits, underscores, or hyphens.',
      );
    }
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
    const source = this.options.tokenSource ?? process.env.GCP_SECRET_MANAGER_TOKEN_SOURCE ?? "metadata";
    if (source === "env") {
      const token = this.options.accessToken ?? process.env.GCP_SECRET_MANAGER_ACCESS_TOKEN;
      if (!token) {
        throw new Error(
          "GCP Secret Manager token source is env but GCP_SECRET_MANAGER_ACCESS_TOKEN is not set.",
        );
      }
      return token;
    }

    // Metadata server token, cached until shortly before it expires so we do not
    // call the metadata endpoint on every secret resolution.
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
      throw new Error("GCP metadata token request failed with http " + res.status);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error("GCP metadata token response did not include an access token.");
    }
    const ttlMs = (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
    this.cachedToken = { token: body.access_token, expiresAtMs: this.now() + ttlMs };
    return body.access_token;
  }

  private secretBase(project: string): string {
    return this.endpoint() + "/v1/projects/" + project + "/secrets";
  }

  async get(ref: string): Promise<string | null> {
    this.validateRef(ref);
    const project = this.requireProjectId();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const url = this.secretBase(project) + "/" + ref + "/versions/latest:access";
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        signal,
      });
      if (res.status === 404) return null;
      if (res.status !== 200) {
        throw new Error("GCP Secret Manager access failed with http " + res.status);
      }
      const body = (await res.json()) as { payload?: { data?: string } };
      const data = body.payload?.data;
      if (data === undefined) return null;
      return Buffer.from(data, "base64").toString("utf8");
    });
  }

  async set(ref: string, value: string): Promise<void> {
    this.validateRef(ref);
    const project = this.requireProjectId();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const authJson = {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      };

      // Create the secret container if it does not exist; an existing one (409)
      // is fine, we just add a new version to it.
      const createRes = await this.fetchImpl(this.secretBase(project) + "?secretId=" + ref, {
        method: "POST",
        headers: authJson,
        body: JSON.stringify({ replication: { automatic: {} } }),
        signal,
      });
      if (createRes.status !== 200 && createRes.status !== 409) {
        throw new Error("GCP Secret Manager create failed with http " + createRes.status);
      }

      const addRes = await this.fetchImpl(this.secretBase(project) + "/" + ref + ":addVersion", {
        method: "POST",
        headers: authJson,
        body: JSON.stringify({ payload: { data: Buffer.from(value, "utf8").toString("base64") } }),
        signal,
      });
      if (addRes.status !== 200) {
        throw new Error("GCP Secret Manager addVersion failed with http " + addRes.status);
      }
    });
  }

  async delete(ref: string): Promise<void> {
    this.validateRef(ref);
    const project = this.requireProjectId();
    return this.withTimeout(async (signal) => {
      const token = await this.accessToken(signal);
      const res = await this.fetchImpl(this.secretBase(project) + "/" + ref, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
        signal,
      });
      // A 404 means it is already gone, which satisfies delete idempotently.
      if (res.status !== 200 && res.status !== 404) {
        throw new Error("GCP Secret Manager delete failed with http " + res.status);
      }
    });
  }
}
