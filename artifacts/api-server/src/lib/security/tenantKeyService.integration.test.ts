import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, tenantsTable } from "@workspace/db";
import { CryptoShreddedError } from "./errors";
import { getKmsRuntime, type KmsRuntime } from "./kms";
import { decryptSignalValue, encryptSignalValue } from "./signalCrypto";
import { ensureActiveTenantKey, getTenantKey, revokeTenantKey } from "./tenantKeyService";

// Crypto-shred ordering against a real database. Revocation destroys the KEK
// material BEFORE it commits the revoked status, so the system can never report a
// revoked key while the material survives. These tests inject a KMS whose destroy
// throws to prove the failure path leaves no misleading revoked state, then run a
// real revoke to prove the shred is real.
const RUN = `tenant-key-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let tenantId = "";

beforeAll(async () => {
  const t = await db
    .insert(tenantsTable)
    .values({ name: RUN, url: `https://${RUN}.example.com`, status: "ready" })
    .returning({ id: tenantsTable.id });
  tenantId = t[0]!.id;
});

afterAll(async () => {
  // Deleting the tenant cascades to tenant_keys; a successful revoke already
  // removed the kms_local_keys row, so nothing else is left behind.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
});

describe("revokeTenantKey crypto-shred ordering", () => {
  it("does not commit a revoked status when KEK destruction fails", async () => {
    const { kmsKeyRef } = await ensureActiveTenantKey(tenantId);
    const env = await encryptSignalValue(0.5, kmsKeyRef);
    expect(await decryptSignalValue(env, kmsKeyRef)).toBe(0.5);

    // Inject a KMS whose destroyKey throws. Revoke must surface the failure and
    // must NOT flip the status to revoked: no misleading success.
    const real = getKmsRuntime();
    const throwingKms: KmsRuntime = {
      provisionTenantKey: real.provisionTenantKey.bind(real),
      wrapDek: real.wrapDek.bind(real),
      unwrapDek: real.unwrapDek.bind(real),
      destroyKey: async () => {
        throw new Error("injected KMS destroy failure");
      },
      status: real.status.bind(real),
    };
    await expect(revokeTenantKey(tenantId, { kms: throwingKms })).rejects.toThrow(
      "injected KMS destroy failure",
    );

    const after = await getTenantKey(tenantId);
    expect(after?.status).toBe("active");
    expect(after?.revokedAt ?? null).toBeNull();
    // The KEK survived, so the signal is still readable: the shred did not happen.
    expect(await decryptSignalValue(env, kmsKeyRef)).toBe(0.5);
  });

  it("destroys the KEK before committing revoked, making signals unreadable", async () => {
    const existing = await getTenantKey(tenantId);
    expect(existing?.status).toBe("active");
    const kmsKeyRef = existing!.kmsKeyRef;
    const env = await encryptSignalValue(0.7, kmsKeyRef);
    expect(await decryptSignalValue(env, kmsKeyRef)).toBe(0.7);

    const result = await revokeTenantKey(tenantId);
    expect(result.status).toBe("revoked");

    const after = await getTenantKey(tenantId);
    expect(after?.status).toBe("revoked");
    expect(after?.revokedAt).not.toBeNull();

    // The KEK is gone: the previously readable envelope is now permanently
    // unreadable. The crypto-shred is real.
    await expect(decryptSignalValue(env, kmsKeyRef)).rejects.toBeInstanceOf(
      CryptoShreddedError,
    );
  });

  it("is idempotent: revoking an already revoked tenant still reports shredded", async () => {
    const result = await revokeTenantKey(tenantId);
    expect(result.status).toBe("revoked");
    const after = await getTenantKey(tenantId);
    expect(after?.status).toBe("revoked");
  });
});
