import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assertDerivedSignalSet, getDescriptor } from "@workspace/connectors";
import type { DerivedSignalSet } from "@workspace/connectors";
import { db, derivedSignalsTable } from "@workspace/db";
import { encryptSignalValue } from "../security/signalCrypto";
import { ensureActiveTenantKey } from "../security/tenantKeyService";

// The caller side of derive and discard. A connector returns only math (a
// DerivedSignalSet); it never has a database handle. Writing that math to our
// store happens here, in the caller, and nowhere else. This module is the single
// persistence path, shared by the in-process boundary refresh and the edge agent
// ingestion route, so every signal that reaches derived_signals passes the same
// guard and the same supersede semantics.

// The layers a connector's signals feed. The catalogue descriptor is the single
// source of truth: a connector declares the layers it feeds, and every signal it
// emits is written under each of those layers. Per-measure layer assignment is a
// deliberate non-goal here: the warehouse config schema is a strict object that
// rejects unknown keys, so there is no place to attach a layer to a measure
// without changing the contract. Connector-level mapping is what the spec models
// (connectors.layers, derived_signals.layerKey), and it is what we implement.
export function resolveConnectionLayers(connectorKey: string): string[] {
  const descriptor = getDescriptor(connectorKey);
  if (!descriptor) {
    throw new Error("Unknown connector: " + connectorKey);
  }
  return descriptor.layers;
}

// A tamper-evidence root over the derived output: a hash of the de-identified
// signal math, never of any raw record. It anchors the connector_runs audit row
// and each derived_signals.provenanceRef. The timestamp is excluded so identical
// math yields a stable root that a later tampering check can compare against.
export function derivedSetRootHash(set: DerivedSignalSet): string {
  const canonical = JSON.stringify([
    set.source,
    set.tenantId,
    set.signals.map((s) => [s.key, s.kind, s.value, s.window ?? "", s.unit ?? ""]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export interface PersistDerivedSignalsArgs {
  tenantId: string;
  connectorKey: string;
  // Untrusted input. Validated here so a connector or an agent that tries to
  // post raw content fails the run loudly before any write reaches the store.
  set: unknown;
  // Resolved target layers. Defaults to the connector's declared layers.
  layers?: string[];
  computedAt?: Date;
}

export interface PersistDerivedSignalsResult {
  signalsCount: number;
  rowsWritten: number;
  rootHash: string;
}

// Validate the set, then atomically replace this tenant+connector's prior
// signals with the new ones. The delete and insert run in one transaction so a
// refresh supersedes the previous set with no window in which a layer is left
// without its grounding. Connected diagnosis is ephemeral by design: only the
// latest derived signals persist, and only until the next refresh supersedes
// them.
export async function persistDerivedSignalSet(
  args: PersistDerivedSignalsArgs,
): Promise<PersistDerivedSignalsResult> {
  const set = assertDerivedSignalSet(args.set);
  if (set.tenantId !== args.tenantId) {
    throw new Error("DerivedSignalSet tenantId does not match the target tenant");
  }
  if (set.source !== args.connectorKey) {
    throw new Error(
      "DerivedSignalSet source " + set.source + " does not match connector " + args.connectorKey,
    );
  }

  const layers = args.layers ?? resolveConnectionLayers(args.connectorKey);
  if (layers.length === 0) {
    throw new Error(
      "connector " + args.connectorKey + " feeds no layers; cannot persist its signals",
    );
  }

  const rootHash = derivedSetRootHash(set);
  const computedAt = args.computedAt ?? new Date();

  // Per-tenant cryptographic isolation (Tier 3). Resolve the tenant's active key
  // (provisioning one on first use), then seal each signal value in its own
  // envelope before it reaches the store: one data key per signal value, reused
  // across the layers that signal feeds. The plaintext math is encrypted here
  // and discarded; only envelopes are written. A revoked tenant throws here,
  // before any delete, so a crypto-shredded tenant cannot be written either.
  const { kmsKeyRef } = await ensureActiveTenantKey(args.tenantId);
  const encrypted = await Promise.all(
    set.signals.map(async (signal) => ({
      signal,
      envelope: await encryptSignalValue(signal.value, kmsKeyRef),
    })),
  );

  const rows = encrypted.flatMap(({ signal, envelope }) =>
    layers.map((layerKey) => ({
      tenantId: args.tenantId,
      layerKey,
      signalKey: signal.key,
      value: envelope,
      window: signal.window ?? null,
      computedAt,
      sourceConnectorKey: args.connectorKey,
      provenanceRef: rootHash,
    })),
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(derivedSignalsTable)
      .where(
        and(
          eq(derivedSignalsTable.tenantId, args.tenantId),
          eq(derivedSignalsTable.sourceConnectorKey, args.connectorKey),
        ),
      );
    if (rows.length > 0) {
      await tx.insert(derivedSignalsTable).values(rows);
    }
  });

  return { signalsCount: set.signals.length, rowsWritten: rows.length, rootHash };
}
