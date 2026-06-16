// Phase AM as-of replay read-model. Given a tenant and a past instant, it
// reconstructs what the system believed THEN, layer by layer, with the
// confidence and data-efficacy it had then, and a diff of what has changed since.
//
// It reads ONLY append-only, timestamped state, so nothing is fabricated and
// nothing is edited:
// - the diagnosis content comes from tenant_layer_snapshots, the immutable
//   per-build ledger written beside the (overwritten-in-place) tenant_layers row;
//   the as-of view picks the latest snapshot whose snapshotAt is at or before the
//   requested date, and honestly reports "no snapshot available" for a layer with
//   no build by then (a pre-Phase-AM tenant, or a layer not yet built);
// - the data-efficacy index is recomputed from that snapshot's own claim arrays
//   plus the connected-signal metadata it captured at build time (the same
//   read-time computation every other surface uses, never a frozen stored
//   figure), so a later refresh that delete-replaces the live derived_signals
//   cannot rewrite a past connected build's coverage or freshness;
// - the confidence advisory is recomputed from the forecasts RESOLVED by the
//   as-of date, so it shows the track record the layer had earned by then.
// The "current" side of every diff is read the same way from the latest snapshot,
// so the comparison is snapshot-to-snapshot and a delta only appears when both
// sides genuinely carry the figure.

import { and, asc, count, desc, eq, gt, inArray, lte } from "drizzle-orm";
import {
  committedActionsTable,
  db,
  decisionRecordsTable,
  layersTable,
  outcomeMeasurementsTable,
  provenanceLedgerTable,
  tenantLayerSnapshotsTable,
  tenantsTable,
} from "@workspace/db";
import { buildLayerEfficacy } from "../efficacy/efficacyService";
import { efficacyConfig, type EfficacyConfig } from "../efficacy/config";
import type { DataMode, EfficacyIndex } from "../efficacy/efficacyMath";
import {
  computeLayerConfidenceAdvisory,
  type LayerConfidenceAdvisory,
} from "../calibration/layerConfidence";
import {
  countClaimItems,
  countObjectArray,
  diffLayerSummaries,
  type AsOfLayerDiff,
  type AsOfLayerSummary,
} from "./asOfMath";

function asDataMode(v: unknown): DataMode {
  return v === "outside_in" ? "outside_in" : "connected";
}

function itemsOf(claims: unknown): Record<string, unknown>[] {
  const items = (claims as { items?: unknown } | null)?.items;
  return Array.isArray(items)
    ? (items.filter((x) => x != null && typeof x === "object") as Record<string, unknown>[])
    : [];
}

function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? (v.filter((x) => x != null && typeof x === "object") as Record<string, unknown>[])
    : [];
}

export interface AsOfLayerView {
  layerKey: string;
  layerName: string;
  // Whether a build existed for this layer at or before the as-of date. False is
  // the honest "history unavailable" state, never a fabricated empty diagnosis.
  available: boolean;
  reason: string | null;
  snapshotAt: string | null;
  generatorModel: string | null;
  reducedMode: boolean | null;
  content: Record<string, unknown> | null;
  heroPanel: Record<string, unknown> | null;
  peerBenchmark: Record<string, unknown> | null;
  supplementBlocks: Record<string, unknown> | null;
  confounders: unknown[] | null;
  verifiedClaims: Record<string, unknown> | null;
  modelledClaims: Record<string, unknown> | null;
  voiceQuality: Record<string, unknown> | null;
  confidence: LayerConfidenceAdvisory | null;
  efficacy: EfficacyIndex | null;
  changedSince: AsOfLayerDiff;
}

export interface TenantAsOf {
  tenantId: string;
  tenantName: string;
  dataMode: DataMode;
  // The requested instant, and the instant the "current" side of every diff was
  // read at, both echoed so the view is self-describing.
  asOf: string;
  now: string;
  // Whether ANY layer had a snapshot at or before the as-of date.
  hasHistory: boolean;
  earliestSnapshotAt: string | null;
  latestSnapshotAt: string | null;
  layers: AsOfLayerView[];
  // The provenance ledger depth as of the date versus now: honest evidence growth.
  ledger: { entriesAsOf: number; entriesCurrent: number };
  // Board-grade activity since the as-of date.
  decisionsSince: number;
  outcomesSince: number;
}

interface SnapshotMeta {
  id: string;
  layerKey: string;
  snapshotAt: Date;
  contentHash: string;
  rawConfidence: number | null;
  reducedMode: boolean;
  generatorModel: string;
}

// Reconstruct one tenant's state as of a past instant, or null when the tenant
// does not exist. asOf is the requested date; now is the instant the current side
// of the diff is read at (injectable for deterministic tests).
export async function buildTenantAsOf(
  tenantId: string,
  asOf: Date,
  cfg: EfficacyConfig = efficacyConfig(),
  now: Date = new Date(),
): Promise<TenantAsOf | null> {
  const [tenant] = await db
    .select({ name: tenantsTable.name, dataMode: tenantsTable.dataMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  const dataMode = asDataMode(tenant.dataMode);
  const asOfMs = asOf.getTime();
  const nowMs = now.getTime();

  const layerRows = await db
    .select({ key: layersTable.key, name: layersTable.name })
    .from(layersTable)
    .orderBy(asc(layersTable.sortOrder));

  // All snapshot metadata for the tenant, newest first. Bounded by layers times
  // builds; full content is fetched only for the snapshots we actually display.
  const metaRows: SnapshotMeta[] = await db
    .select({
      id: tenantLayerSnapshotsTable.id,
      layerKey: tenantLayerSnapshotsTable.layerKey,
      snapshotAt: tenantLayerSnapshotsTable.snapshotAt,
      contentHash: tenantLayerSnapshotsTable.contentHash,
      rawConfidence: tenantLayerSnapshotsTable.rawConfidence,
      reducedMode: tenantLayerSnapshotsTable.reducedMode,
      generatorModel: tenantLayerSnapshotsTable.generatorModel,
    })
    .from(tenantLayerSnapshotsTable)
    .where(eq(tenantLayerSnapshotsTable.tenantId, tenantId))
    .orderBy(desc(tenantLayerSnapshotsTable.snapshotAt));

  // Per layer: the current (newest) snapshot and the as-of (newest at or before
  // the requested date).
  const currentMeta = new Map<string, SnapshotMeta>();
  const asOfMeta = new Map<string, SnapshotMeta>();
  for (const m of metaRows) {
    if (!currentMeta.has(m.layerKey)) currentMeta.set(m.layerKey, m);
    if (m.snapshotAt.getTime() <= asOfMs && !asOfMeta.has(m.layerKey)) asOfMeta.set(m.layerKey, m);
  }

  // Fetch full content for only the snapshots we will display or diff.
  const neededIds = new Set<string>();
  for (const m of asOfMeta.values()) neededIds.add(m.id);
  for (const m of currentMeta.values()) neededIds.add(m.id);
  const fullById = new Map<string, typeof tenantLayerSnapshotsTable.$inferSelect>();
  if (neededIds.size > 0) {
    const fulls = await db
      .select()
      .from(tenantLayerSnapshotsTable)
      .where(inArray(tenantLayerSnapshotsTable.id, [...neededIds]));
    for (const f of fulls) fullById.set(f.id, f);
  }

  // Efficacy is recomputed from the snapshot's OWN inputs: the data mode, feed
  // list, and connected-signal metadata captured at build time (NOT the tenant's
  // current mode, the layer's current feeds, or the live derived_signals, which a
  // later refresh delete-replaces). This keeps the as-of score honest to what the
  // system actually held then: a tenant that later connected must not
  // retroactively gain a higher ceiling on a past date, and a refresh that
  // superseded the grounding signals must not erase a past build's coverage or
  // freshness. nowForFreshnessMs is the instant the newest signal ages against:
  // the as-of date for the as-of side, now for the current side.
  const efficacyFor = (
    full: typeof tenantLayerSnapshotsTable.$inferSelect,
    nowForFreshnessMs: number,
  ): EfficacyIndex | null => {
    const sigs = (Array.isArray(full.signalMeta) ? full.signalMeta : []).map((s) => ({
      sourceConnectorKey: s.sourceConnectorKey,
      computedAt: s.computedAt ?? NaN,
    }));
    return buildLayerEfficacy(
      {
        layerKey: full.layerKey,
        feeds: Array.isArray(full.feeds) ? full.feeds : [],
        generated: true,
        reducedMode: full.reducedMode,
        verifiedItems: itemsOf(full.verifiedClaims),
        modelledItems: itemsOf(full.modelledClaims),
        confounders: asObjectArray(full.confounders),
        signals: sigs,
      },
      asDataMode(full.dataMode),
      cfg,
      nowForFreshnessMs,
    );
  };

  const layers: AsOfLayerView[] = [];
  for (const l of layerRows) {
    const aMeta = asOfMeta.get(l.key);
    const cMeta = currentMeta.get(l.key);
    const aFull = aMeta ? fullById.get(aMeta.id) : undefined;
    const cFull = cMeta ? fullById.get(cMeta.id) : undefined;

    let asOfConfidence: LayerConfidenceAdvisory | null = null;
    let asOfEfficacy: EfficacyIndex | null = null;
    let asOfSummary: AsOfLayerSummary | null = null;
    if (aFull) {
      asOfEfficacy = efficacyFor(aFull, asOfMs);
      asOfConfidence =
        aFull.rawConfidence !== null
          ? await computeLayerConfidenceAdvisory(tenantId, l.key, aFull.rawConfidence, asOf)
          : null;
      asOfSummary = {
        contentHash: aFull.contentHash,
        verifiedCount: countClaimItems(aFull.verifiedClaims),
        modelledCount: countClaimItems(aFull.modelledClaims),
        confounderCount: countObjectArray(aFull.confounders),
        efficacyScore: asOfEfficacy ? asOfEfficacy.score : null,
        confidenceValue: asOfConfidence ? asOfConfidence.adjusted : null,
      };
    }

    let currentSummary: AsOfLayerSummary | null = null;
    if (cFull) {
      const cEfficacy = efficacyFor(cFull, nowMs);
      const cConfidence =
        cFull.rawConfidence !== null
          ? await computeLayerConfidenceAdvisory(tenantId, l.key, cFull.rawConfidence)
          : null;
      currentSummary = {
        contentHash: cFull.contentHash,
        verifiedCount: countClaimItems(cFull.verifiedClaims),
        modelledCount: countClaimItems(cFull.modelledClaims),
        confounderCount: countObjectArray(cFull.confounders),
        efficacyScore: cEfficacy ? cEfficacy.score : null,
        confidenceValue: cConfidence ? cConfidence.adjusted : null,
      };
    }

    const changedSince = diffLayerSummaries(asOfSummary, currentSummary);

    if (!aFull) {
      layers.push({
        layerKey: l.key,
        layerName: l.name,
        available: false,
        reason: "no_snapshot_available",
        snapshotAt: null,
        generatorModel: null,
        reducedMode: null,
        content: null,
        heroPanel: null,
        peerBenchmark: null,
        supplementBlocks: null,
        confounders: null,
        verifiedClaims: null,
        modelledClaims: null,
        voiceQuality: null,
        confidence: null,
        efficacy: null,
        changedSince,
      });
      continue;
    }

    layers.push({
      layerKey: l.key,
      layerName: l.name,
      available: true,
      reason: null,
      snapshotAt: aFull.snapshotAt.toISOString(),
      generatorModel: aFull.generatorModel,
      reducedMode: aFull.reducedMode,
      content: aFull.content,
      heroPanel: aFull.heroPanel,
      peerBenchmark: aFull.peerBenchmark,
      supplementBlocks: aFull.supplementBlocks,
      confounders: aFull.confounders,
      verifiedClaims: aFull.verifiedClaims,
      modelledClaims: aFull.modelledClaims,
      voiceQuality: aFull.voiceQuality,
      confidence: asOfConfidence,
      efficacy: asOfEfficacy,
      changedSince,
    });
  }

  // Tenant-level honest growth figures.
  const [ledgerAsOf] = await db
    .select({ c: count() })
    .from(provenanceLedgerTable)
    .where(
      and(
        eq(provenanceLedgerTable.tenantId, tenantId),
        lte(provenanceLedgerTable.createdAt, asOf),
      ),
    );
  const [ledgerCurrent] = await db
    .select({ c: count() })
    .from(provenanceLedgerTable)
    .where(
      and(eq(provenanceLedgerTable.tenantId, tenantId), lte(provenanceLedgerTable.createdAt, now)),
    );
  const [decisionsSince] = await db
    .select({ c: count() })
    .from(decisionRecordsTable)
    .where(
      and(
        eq(decisionRecordsTable.tenantId, tenantId),
        gt(decisionRecordsTable.decidedAt, asOf),
        lte(decisionRecordsTable.decidedAt, now),
      ),
    );
  const [outcomesSince] = await db
    .select({ c: count() })
    .from(outcomeMeasurementsTable)
    .innerJoin(
      committedActionsTable,
      eq(outcomeMeasurementsTable.actionId, committedActionsTable.id),
    )
    .where(
      and(
        eq(committedActionsTable.tenantId, tenantId),
        gt(outcomeMeasurementsTable.measuredAt, asOf),
        lte(outcomeMeasurementsTable.measuredAt, now),
      ),
    );

  const snapTimes = metaRows.map((m) => m.snapshotAt.getTime());
  const earliestSnapshotAt =
    snapTimes.length > 0 ? new Date(Math.min(...snapTimes)).toISOString() : null;
  const latestSnapshotAt =
    snapTimes.length > 0 ? new Date(Math.max(...snapTimes)).toISOString() : null;

  return {
    tenantId,
    tenantName: tenant.name,
    dataMode,
    asOf: asOf.toISOString(),
    now: now.toISOString(),
    hasHistory: asOfMeta.size > 0,
    earliestSnapshotAt,
    latestSnapshotAt,
    layers,
    ledger: {
      entriesAsOf: Number(ledgerAsOf?.c ?? 0),
      entriesCurrent: Number(ledgerCurrent?.c ?? 0),
    },
    decisionsSince: Number(decisionsSince?.c ?? 0),
    outcomesSince: Number(outcomesSince?.c ?? 0),
  };
}
