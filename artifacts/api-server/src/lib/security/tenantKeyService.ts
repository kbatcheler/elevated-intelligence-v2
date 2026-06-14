import { eq } from "drizzle-orm";
import { db, tenantKeysTable, type TenantKey } from "@workspace/db";
import { CryptoShreddedError } from "./errors";
import { getKmsRuntime, type KmsRuntime } from "./kms";

// The tenant key lifecycle: provision on first use, look up, and revoke. The
// key reference is all we store (tenant_keys.kmsKeyRef); the key material lives
// behind the KMS seam. Revocation is the crypto-shred: it flips the row to
// revoked and destroys the KEK, after which the tenant's encrypted signals can
// never be opened again.

export interface TenantKeyDeps {
  kms?: KmsRuntime;
  now?: () => Date;
}

export async function getTenantKey(tenantId: string): Promise<TenantKey | null> {
  const rows = await db
    .select()
    .from(tenantKeysTable)
    .where(eq(tenantKeysTable.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

// Return the active key reference for a tenant, provisioning one on first use.
// A revoked tenant is terminal: its key was destroyed and its data crypto-
// shredded, so we never silently mint a new key under it. Re-enabling a revoked
// tenant is a deliberate owner action, not an implicit side effect of a write.
export async function ensureActiveTenantKey(
  tenantId: string,
  deps: TenantKeyDeps = {},
): Promise<{ kmsKeyRef: string }> {
  const kms = deps.kms ?? getKmsRuntime();

  const existing = await getTenantKey(tenantId);
  if (existing) {
    if (existing.status === "revoked") {
      throw new CryptoShreddedError(
        tenantId,
        "tenant key was revoked; its signals cannot be read or written",
      );
    }
    return { kmsKeyRef: existing.kmsKeyRef };
  }

  const provisioned = await kms.provisionTenantKey(tenantId);
  await db
    .insert(tenantKeysTable)
    .values({ tenantId, kmsKeyRef: provisioned.kmsKeyRef, status: "active" })
    .onConflictDoNothing();

  // A concurrent caller may have won the insert. Re-read to find the row that
  // actually persisted, and destroy our own KEK if it lost the race so no unused
  // key material lingers in the store.
  const row = await getTenantKey(tenantId);
  if (!row) {
    throw new Error("tenant " + tenantId + " key row missing after provisioning");
  }
  if (row.status === "revoked") {
    await kms.destroyKey(provisioned.kmsKeyRef);
    throw new CryptoShreddedError(tenantId, "tenant key was revoked during provisioning");
  }
  if (row.kmsKeyRef !== provisioned.kmsKeyRef) {
    await kms.destroyKey(provisioned.kmsKeyRef);
  }
  return { kmsKeyRef: row.kmsKeyRef };
}

export interface RevokeResult {
  tenantId: string;
  status: "revoked";
  revokedAt: string;
}

// Crypto-shred. Destroy the KEK so every envelope encrypted under it becomes
// permanently unreadable, then flip the key to revoked and stamp the time. The
// signal rows are left in place on purpose: the ciphertext is inert without the
// key, and leaving it makes the shred evidenceable (the rows remain, the data
// does not).
//
// The destroy runs BEFORE the status is committed, and that order matters: if
// destroying the KEK fails, this throws and the row keeps its prior status, so
// the system never reports a revoked key while its material still exists. The
// only residual window is the safe direction (material gone, status not yet
// flipped), where every read and write already fails loud because the key cannot
// be loaded, and a retried revoke converges. Idempotent: destroying an absent
// key is a no-op, so revoking an already-revoked key still ends in a shredded
// tenant and reports success.
export async function revokeTenantKey(
  tenantId: string,
  deps: TenantKeyDeps = {},
): Promise<RevokeResult> {
  const kms = deps.kms ?? getKmsRuntime();
  const now = deps.now ?? (() => new Date());

  const existing = await getTenantKey(tenantId);
  if (!existing) {
    throw new Error("tenant " + tenantId + " has no key to revoke");
  }

  // Destroy first: the irreversible shred. A failure here throws before any
  // status change, so a misleading "revoked" is never committed.
  await kms.destroyKey(existing.kmsKeyRef);

  const revokedAt = existing.revokedAt ?? now();
  if (existing.status !== "revoked") {
    await db
      .update(tenantKeysTable)
      .set({ status: "revoked", revokedAt })
      .where(eq(tenantKeysTable.tenantId, tenantId));
  }

  return { tenantId, status: "revoked", revokedAt: revokedAt.toISOString() };
}
