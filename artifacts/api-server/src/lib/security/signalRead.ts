import { asc, eq } from "drizzle-orm";
import { db, derivedSignalsTable } from "@workspace/db";
import { CryptoShreddedError } from "./errors";
import { decryptSignalValue } from "./signalCrypto";
import { getTenantKey } from "./tenantKeyService";

// One decrypted derived-signal row, exactly the finite math the pipeline stored:
// a scalar or a numeric vector, with its layer, key, window, source, and time.
export interface DecryptedSignalRow {
  layerKey: string;
  signalKey: string;
  value: number | number[];
  window: string | null;
  sourceConnectorKey: string | null;
  computedAt: string;
}

// Back-compat name for the break-glass human read shape (unchanged callers).
export type HumanSignalRow = DecryptedSignalRow;

// The shared decrypt core. Two distinct authorization boundaries open the same
// envelopes under the tenant's active key, and they MUST agree on the crypto-shred
// gate and the fail-loud behavior, so that logic lives here once rather than being
// copied per caller:
//   - the in-boundary MACHINE read (model grounding, and the Phase X benchmark
//     recompute), exempt from break-glass by construction, and
//   - the break-glass HUMAN read, reachable only under an active grant that its
//     caller enforces and logs.
// It never returns an empty or default value to paper over a revoked or missing
// key: an unreadable signal is a loud failure, not a silent gap.
async function decryptTenantSignals(tenantId: string): Promise<DecryptedSignalRow[]> {
  // Crypto-shred gate: a revoked tenant key makes the signals unreadable by
  // anyone, a human or a machine. Fail loud rather than return an empty list.
  const keyRow = await getTenantKey(tenantId);
  if (keyRow && keyRow.status === "revoked") {
    throw new CryptoShreddedError(
      tenantId,
      "tenant key revoked; derived signals are unreadable",
    );
  }

  const rows = await db
    .select({
      layerKey: derivedSignalsTable.layerKey,
      signalKey: derivedSignalsTable.signalKey,
      value: derivedSignalsTable.value,
      window: derivedSignalsTable.window,
      sourceConnectorKey: derivedSignalsTable.sourceConnectorKey,
      computedAt: derivedSignalsTable.computedAt,
    })
    .from(derivedSignalsTable)
    .where(eq(derivedSignalsTable.tenantId, tenantId))
    .orderBy(asc(derivedSignalsTable.layerKey), asc(derivedSignalsTable.signalKey));

  if (rows.length === 0) {
    return [];
  }

  // There is ciphertext to open, so an active tenant key must exist. A missing
  // key row (ciphertext with no key) is as unreadable as a revoked one: fail
  // loud, never decrypt on the strength of the envelope's own embedded keyRef.
  if (!keyRow || keyRow.status !== "active") {
    throw new CryptoShreddedError(
      tenantId,
      "no active tenant key for stored signals; they are unreadable",
    );
  }
  const activeKeyRef = keyRow.kmsKeyRef;

  return Promise.all(
    rows.map(async (r) => ({
      layerKey: r.layerKey,
      signalKey: r.signalKey,
      value: await decryptSignalValue(r.value, activeKeyRef),
      window: r.window,
      sourceConnectorKey: r.sourceConnectorKey,
      computedAt: r.computedAt.toISOString(),
    })),
  );
}

// The break-glass HUMAN read: it returns the raw values to a PERSON and is
// reachable only under an active break-glass grant, enforced and logged by its
// caller. It is a separate entry point from the machine read by intent, even
// though both share the decrypt core: the boundary is the authorization, not the
// bytes.
export async function readDecryptedSignalsForHuman(tenantId: string): Promise<HumanSignalRow[]> {
  return decryptTenantSignals(tenantId);
}

// The in-boundary MACHINE read: the same de-identified math, fed to a computation
// (the pipeline's model grounding, or the Phase X benchmark recompute), exempt
// from break-glass by construction. The result must stay inside the boundary; it
// is never routed to a person. Fails loud on a revoked or missing key exactly as
// the human read does, so a cross-tenant batch caller can catch per tenant and
// skip a crypto-shredded one rather than failing the whole run.
export async function readDecryptedSignalsForMachine(
  tenantId: string,
): Promise<DecryptedSignalRow[]> {
  return decryptTenantSignals(tenantId);
}
