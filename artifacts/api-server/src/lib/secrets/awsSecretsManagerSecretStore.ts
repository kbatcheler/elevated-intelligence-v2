// AWS Secrets Manager implementation of the SecretStore boundary, over the REST
// API with the Node global fetch and a zero-dependency SigV4 signer, mirroring
// the GCP Secret Manager adapter exactly: it is "available, not connected" until
// configured, and it never crashes the boot. Construction reads no config and
// validates nothing; the first get/set/delete resolves the region and
// credentials lazily and throws a precise error if either is missing, so a
// misconfiguration surfaces on first use rather than at startup.
//
// A ref is an opaque secret name (for example "SESSION_SECRET"). It is validated
// against the same id grammar the GCP adapter enforces, so the SAME ref resolves
// on either backend and can never smuggle a path traversal or a full ARN. Secret
// values, credentials, and response bodies are never logged, and an error never
// carries a response body, because a GetSecretValue success body is the secret.
import { resolveAwsCredentials, signRequestV4 } from "../aws/sigv4";
import type { SecretStore } from "./secretStore";

// The portable secret-id grammar: 1 to 255 letters, digits, underscores, and
// hyphens. AWS itself permits more, but the intersection with the GCP grammar
// keeps a ref byte-identical across providers.
const SECRET_ID = /^[A-Za-z0-9_-]{1,255}$/;

const DEFAULT_TIMEOUT_MS = 5000;
const SERVICE = "secretsmanager";

export interface AwsSecretsManagerOptions {
  region?: string;
  endpoint?: string;
  timeoutMs?: number;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class AwsSecretsManagerSecretStore implements SecretStore {
  private readonly options: AwsSecretsManagerOptions;

  constructor(options: AwsSecretsManagerOptions = {}) {
    this.options = options;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private get now(): () => Date {
    return this.options.now ?? (() => new Date());
  }

  private timeoutMs(): number {
    const raw = process.env.AWS_SECRETS_MANAGER_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return this.options.timeoutMs ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS);
  }

  // Lazy config resolution. Throws a precise "available, not connected" error on
  // first use when no region is set, never at construction.
  private requireRegion(): string {
    const region = this.options.region ?? process.env.AWS_SECRETS_MANAGER_REGION ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error(
        "AWS Secrets Manager is available, not connected: set AWS_SECRETS_MANAGER_REGION (or AWS_REGION) to connect it.",
      );
    }
    return region;
  }

  private endpoint(region: string): string {
    return (
      this.options.endpoint ??
      process.env.AWS_SECRETS_MANAGER_ENDPOINT ??
      "https://secretsmanager." + region + ".amazonaws.com"
    ).replace(/\/+$/, "");
  }

  private validateRef(ref: string): void {
    if (!SECRET_ID.test(ref)) {
      throw new Error(
        'Invalid secret reference "' + ref + '": a secret id is 1 to 255 letters, digits, underscores, or hyphens.',
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

  // Issue one signed JSON1.1 request to a Secrets Manager target. The request
  // URL signed and the URL fetched are byte-identical so the signature verifies.
  private async request(target: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const region = this.requireRegion();
    const credentials = resolveAwsCredentials(this.options.credentials);
    const url = this.endpoint(region) + "/";
    // Sign over the exact UTF-8 bytes of the JSON, then send that same string as
    // the body. fetch encodes the string as UTF-8, so the bytes are byte-identical
    // to the signed payload and the signature verifies.
    const json = JSON.stringify(body);
    const payload = Buffer.from(json, "utf8");
    const signed = signRequestV4({
      method: "POST",
      url,
      region,
      service: SERVICE,
      credentials,
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "secretsmanager." + target,
      },
      payload,
      addContentSha256Header: true,
      now: this.now(),
    });
    return this.fetchImpl(url, { method: "POST", headers: signed.headers, body: json, signal });
  }

  // Read the AWS error code (__type) from a non-2xx response, without ever
  // surfacing the body. Returns "" when the body is unparseable.
  private async errorType(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { __type?: string };
      return body.__type ?? "";
    } catch {
      return "";
    }
  }

  async get(ref: string): Promise<string | null> {
    this.validateRef(ref);
    return this.withTimeout(async (signal) => {
      const res = await this.request("GetSecretValue", { SecretId: ref }, signal);
      if (res.status === 200) {
        const body = (await res.json()) as { SecretString?: string };
        return body.SecretString === undefined ? null : body.SecretString;
      }
      const type = await this.errorType(res);
      if (type.includes("ResourceNotFoundException")) return null;
      throw new Error("AWS Secrets Manager access failed with http " + res.status);
    });
  }

  async set(ref: string, value: string): Promise<void> {
    this.validateRef(ref);
    return this.withTimeout(async (signal) => {
      // Create the secret with its first value. An existing one is handled by
      // adding a new version, mirroring the GCP create-then-add-version flow.
      const createRes = await this.request("CreateSecret", { Name: ref, SecretString: value }, signal);
      if (createRes.status === 200) return;
      const type = await this.errorType(createRes);
      if (type.includes("ResourceExistsException")) {
        const putRes = await this.request("PutSecretValue", { SecretId: ref, SecretString: value }, signal);
        if (putRes.status !== 200) {
          throw new Error("AWS Secrets Manager putSecretValue failed with http " + putRes.status);
        }
        return;
      }
      throw new Error("AWS Secrets Manager createSecret failed with http " + createRes.status);
    });
  }

  async delete(ref: string): Promise<void> {
    this.validateRef(ref);
    return this.withTimeout(async (signal) => {
      const res = await this.request(
        "DeleteSecret",
        { SecretId: ref, ForceDeleteWithoutRecovery: true },
        signal,
      );
      if (res.status === 200) return;
      const type = await this.errorType(res);
      // A missing secret means it is already gone, which satisfies delete idempotently.
      if (type.includes("ResourceNotFoundException")) return;
      throw new Error("AWS Secrets Manager delete failed with http " + res.status);
    });
  }
}
