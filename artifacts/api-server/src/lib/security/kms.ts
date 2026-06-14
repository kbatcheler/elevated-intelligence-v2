import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, kmsLocalKeysTable } from "@workspace/db";
import { aesGcmDecrypt, aesGcmEncrypt, packParts, unpackParts } from "./aesgcm";
import { CryptoShreddedError } from "./errors";

// The key management seam. A KmsRuntime provisions, wraps with, unwraps with,
// and destroys a per-tenant key encryption key (the KEK). derived_signals hold
// only a wrapped data key plus a key reference; the KEK material itself lives
// behind this seam, and where it lives depends on the implementation.
//
// Two implementations sit behind one interface, exactly as the Phase J model
// seat seam does. LocalKmsRuntime is the working default for this deployment: it
// is a SOFTWARE-ONLY key store that holds each tenant KEK in a same-database
// Postgres table (kms_local_keys), separate from the application SecretStore but
// co-located with the ciphertext it protects. It is a documented stand-in for an
// external KMS, NOT a hardware boundary: it does not defend against a database
// admin compromise, nor against a database backup or snapshot taken before
// revocation that captures both KEK and ciphertext. Crypto-shred is real for the
// live store (destroying the row makes the ciphertext unrecoverable there), but
// the shred guarantee is only as strong as that same-DB boundary.
// CustomerKmsRuntime is the seam for a client-managed cloud KMS (AWS KMS, GCP
// KMS, or the client's own key service), where the KEK never enters our database
// at all; it is declared but reports "available, not connected" until a client
// wires their key service in, so we never fake a customer-managed key we do not
// have.

export interface KmsStatus {
  provider: string;
  connected: boolean;
  detail: string;
}

export interface KmsRuntime {
  // Provision a fresh KEK and return the reference to store in tenant_keys.
  provisionTenantKey(tenantId: string): Promise<{ kmsKeyRef: string }>;
  // Wrap (encrypt) a data encryption key with the tenant KEK.
  wrapDek(kmsKeyRef: string, dek: Buffer): Promise<string>;
  // Unwrap (decrypt) a wrapped data key. Throws CryptoShreddedError when the KEK
  // no longer exists (revoked and destroyed) or fails authentication.
  unwrapDek(kmsKeyRef: string, wrappedDek: string): Promise<Buffer>;
  // Destroy the KEK material. After this, no data key wrapped under it can be
  // opened, so every signal encrypted under it is permanently unreadable.
  destroyKey(kmsKeyRef: string): Promise<void>;
  status(): KmsStatus;
}

const KEK_BYTES = 32;

// The working default. Each tenant KEK is a 32-byte random key held in a
// dedicated, durable keyring table (kms_local_keys) that emulates an external
// KMS we do not have wired in this deployment. The keyring is deliberately kept
// off the application SecretStore: app secrets (third-party API keys) and key
// material are different concerns, and the SecretStore is swapped or mocked for
// app-secret control in places that must never disturb tenant crypto. The
// keyring is NOT the customer key store and NOT the reference table (tenant_keys
// holds only the reference); destroying a row here is the crypto-shred. A real
// customer KMS is the swappable upgrade for client-held keys (CustomerKmsRuntime),
// after which this table is unused. Key material is never logged.
export class LocalKmsRuntime implements KmsRuntime {
  async provisionTenantKey(tenantId: string): Promise<{ kmsKeyRef: string }> {
    const kmsKeyRef = "kek:" + tenantId + ":" + randomBytes(8).toString("hex");
    const kek = randomBytes(KEK_BYTES);
    await db
      .insert(kmsLocalKeysTable)
      .values({ keyRef: kmsKeyRef, material: kek.toString("base64") });
    return { kmsKeyRef };
  }

  private async loadKek(kmsKeyRef: string): Promise<Buffer> {
    const rows = await db
      .select({ material: kmsLocalKeysTable.material })
      .from(kmsLocalKeysTable)
      .where(eq(kmsLocalKeysTable.keyRef, kmsKeyRef))
      .limit(1);
    const raw = rows[0]?.material;
    if (raw === undefined || raw === "") {
      throw new CryptoShreddedError(kmsKeyRef, "key reference resolves to no key material");
    }
    const kek = Buffer.from(raw, "base64");
    if (kek.length !== KEK_BYTES) {
      throw new CryptoShreddedError(kmsKeyRef, "key material is malformed");
    }
    return kek;
  }

  async wrapDek(kmsKeyRef: string, dek: Buffer): Promise<string> {
    const kek = await this.loadKek(kmsKeyRef);
    return packParts(aesGcmEncrypt(kek, dek));
  }

  async unwrapDek(kmsKeyRef: string, wrappedDek: string): Promise<Buffer> {
    const kek = await this.loadKek(kmsKeyRef);
    try {
      return aesGcmDecrypt(kek, unpackParts(wrappedDek));
    } catch {
      throw new CryptoShreddedError(kmsKeyRef, "wrapped key failed authentication");
    }
  }

  async destroyKey(kmsKeyRef: string): Promise<void> {
    await db.delete(kmsLocalKeysTable).where(eq(kmsLocalKeysTable.keyRef, kmsKeyRef));
  }

  status(): KmsStatus {
    return {
      provider: "local",
      connected: true,
      detail:
        "local KMS emulation: per-tenant KEK held in a durable keyring table, separate from app secrets. Client-held keys arrive with the customer KMS adapter.",
    };
  }
}

// The declared customer-managed KMS adapter. It exists so the seam, and its
// connection state, are real and visible for the audit story. Until a client
// wires their key service in, every operation reports honestly that it is
// available but not connected; we never fabricate a customer key.
export class CustomerKmsRuntime implements KmsRuntime {
  private notConnected(): never {
    throw new Error(
      "customer-managed KMS is available, not connected: configure the client key service to enable customer-managed keys",
    );
  }
  async provisionTenantKey(): Promise<{ kmsKeyRef: string }> {
    return this.notConnected();
  }
  async wrapDek(): Promise<string> {
    return this.notConnected();
  }
  async unwrapDek(): Promise<Buffer> {
    return this.notConnected();
  }
  async destroyKey(): Promise<void> {
    return this.notConnected();
  }
  status(): KmsStatus {
    return {
      provider: "customer-kms",
      connected: false,
      detail:
        "available, not connected: bring your own KMS (AWS KMS, GCP KMS, or your key service) to hold the key we only reference",
    };
  }
}

let activeKms: KmsRuntime | null = null;

// The process-wide KMS, constructed on first use. The local runtime is the
// working default; a deployment with a customer KMS swaps it through setKmsRuntime.
export function getKmsRuntime(): KmsRuntime {
  if (!activeKms) {
    activeKms = new LocalKmsRuntime();
  }
  return activeKms;
}

export function setKmsRuntime(runtime: KmsRuntime | null): void {
  activeKms = runtime;
}

// The status of the declared customer-managed KMS adapter, surfaced for the
// security posture evidence so the seam and its state are visible without
// pretending a client key service is connected.
export function customerKmsStatus(): KmsStatus {
  return new CustomerKmsRuntime().status();
}
