// The SecretStore boundary. Every secret in the system is referenced by name
// and resolved through this interface, never read from process.env directly at
// the call site. That gives us one seam to swap the local env-backed store for
// a managed secret manager later without touching consumers.
//
// A ref is an opaque secret name (for example "SESSION_SECRET" or
// "ANTHROPIC_API_KEY"). The env-backed implementation treats the ref as an
// environment variable name. A future managed implementation maps the same ref
// onto a secret-manager path; consumers do not change.
import { AwsSecretsManagerSecretStore } from "./awsSecretsManagerSecretStore";
import { GcpSecretManagerSecretStore } from "./gcpSecretStore";

export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

/**
 * Local, env-backed implementation. Reads from process.env. Writes mutate the
 * in-process environment only: they are not persisted across restarts, because
 * the platform owns durable secret storage. This is honest by design rather
 * than a silent fallback: set and delete report what they do via the caller's
 * expectations, and production deployments inject secrets through the platform.
 */
export class EnvSecretStore implements SecretStore {
  async get(ref: string): Promise<string | null> {
    const value = process.env[ref];
    return value === undefined ? null : value;
  }

  async set(ref: string, value: string): Promise<void> {
    process.env[ref] = value;
  }

  async delete(ref: string): Promise<void> {
    delete process.env[ref];
  }
}

let activeStore: SecretStore | null = null;

/**
 * Construct the SecretStore the environment selects. The default is the local
 * env-backed store; `SECRET_STORE_PROVIDER=gcp` selects the GCP Secret Manager
 * REST adapter and `SECRET_STORE_PROVIDER=aws` selects the AWS Secrets Manager
 * REST adapter. Each managed adapter is "available, not connected" until
 * configured: it is constructed here without validating anything, so an unset
 * project or region never crashes the boot and only surfaces on first use.
 */
function createSelectedStore(): SecretStore {
  const provider = (process.env.SECRET_STORE_PROVIDER ?? "env").trim().toLowerCase();
  if (provider === "gcp") {
    return new GcpSecretManagerSecretStore();
  }
  if (provider === "aws") {
    return new AwsSecretsManagerSecretStore();
  }
  return new EnvSecretStore();
}

/** Returns the process-wide SecretStore, constructing it on first use. */
export function getSecretStore(): SecretStore {
  if (!activeStore) {
    activeStore = createSelectedStore();
  }
  return activeStore;
}

/** Test seam: override the active store. */
export function setSecretStore(store: SecretStore | null): void {
  activeStore = store;
}

/**
 * Resolve a required secret or throw a clear error. Uses the lazy
 * throw-if-missing pattern so a misconfiguration surfaces as a precise error on
 * first use rather than a silent empty value or a boot crash.
 */
export async function requireSecret(ref: string, store: SecretStore = getSecretStore()): Promise<string> {
  const value = await store.get(ref);
  if (value === null || value === "") {
    throw new Error(
      'Required secret "' + ref + '" is not configured. Set it as an environment secret.',
    );
  }
  return value;
}
