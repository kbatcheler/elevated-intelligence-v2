import { asc, eq } from "drizzle-orm";
import { db, derivedSignalsTable } from "@workspace/db";
import { CryptoShreddedError } from "./errors";
import { decryptSignalValue } from "./signalCrypto";
import { getTenantKey } from "./tenantKeyService";

// The human read of a connected tenant's raw signal values. It is a SEPARATE
// entry point from the pipeline's in-boundary machine grounding read
// (orchestrator.loadLayerGrounding): the machine read grounds the model on
// de-identified math and is exempt from break-glass by construction, while this
// read returns the raw values to a person and is reachable only under an active
// break-glass grant, enforced and logged by its caller. Like the machine read it
// fails loud on a revoked or missing key, never returning an empty default.

export interface HumanSignalRow {
  layerKey: string;
  signalKey: string;
  value: number | number[];
  window: string | null;
  sourceConnectorKey: string | null;
  computedAt: string;
}

export async function readDecryptedSignalsForHuman(tenantId: string): Promise<HumanSignalRow[]> {
  // Crypto-shred gate: a revoked tenant key makes the signals unreadable by
  // anyone, a human included. Fail loud rather than return an empty list.
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
