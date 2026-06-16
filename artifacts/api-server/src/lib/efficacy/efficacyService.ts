// Phase AK Data Efficacy Index service. The read-time layer that turns persisted
// state (derived signals, the verified/modelled claim split, the Confounder
// verdicts, the registry feeds, and the tenant's data mode) into the five named
// drivers, then hands them to the pure efficacyMath core. Nothing is stored: the
// index is derived on read, mirroring the connector connectionHealth pattern, so
// it can never drift from the data it describes. Confidence says how sure the
// reasoning is; this says how good the fuel was.

import { and, eq, inArray } from "drizzle-orm";
import { getDescriptor } from "@workspace/connectors";
import {
  db,
  derivedSignalsTable,
  layersTable,
  tenantLayersTable,
  tenantsTable,
} from "@workspace/db";
import { efficacyConfig, type EfficacyConfig, type EfficacyDriverKey } from "./config";
import {
  computeEfficacyIndex,
  coverageFromFeeds,
  freshnessDecay,
  normalizeWeights,
  rollupEfficacy,
  sourceDiversity,
  survivalRate,
  verificationRate,
  type DataMode,
  type DriverMeasurement,
  type EfficacyIndex,
} from "./efficacyMath";

export interface LayerSignalInput {
  sourceConnectorKey: string | null;
  computedAt: number;
}

export interface LayerEfficacyInput {
  layerKey: string;
  feeds: string[];
  generated: boolean;
  reducedMode: boolean;
  verifiedItems: Record<string, unknown>[];
  modelledItems: Record<string, unknown>[];
  confounders: Record<string, unknown>[];
  signals: LayerSignalInput[];
}

export interface LayerEfficacySummary {
  layerKey: string;
  layerName: string;
  generated: boolean;
  index: EfficacyIndex | null;
}

export interface TenantEfficacy {
  dataMode: DataMode;
  modeCeiling: number;
  rollup: { score: number | null; n: number };
  layers: LayerEfficacySummary[];
}

function asDataMode(v: unknown): DataMode {
  return v === "outside_in" ? "outside_in" : "connected";
}

function urlsFrom(items: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const u = (it as { source_urls?: unknown }).source_urls;
    if (Array.isArray(u)) {
      for (const x of u) if (typeof x === "string" && x.length > 0) out.push(x);
    }
  }
  return out;
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

function describeFeeds(feeds: string[]): string {
  const unique = [...new Set(feeds)];
  if (unique.length === 0) return "the missing data";
  if (unique.length <= 3) return unique.join(", ");
  return unique.slice(0, 3).join(", ") + " and more";
}

// The pure builder: given a layer's already-loaded state, compute its efficacy
// index, or null when the layer has not been generated for this tenant (no
// fabricated index for an absent layer).
export function buildLayerEfficacy(
  input: LayerEfficacyInput,
  dataMode: DataMode,
  cfg: EfficacyConfig,
  nowMs: number,
): EfficacyIndex | null {
  if (!input.generated) return null;

  // Connector-grounded evidence (which connector families are present, and how
  // recent the newest signal is) is only real in connected mode. In outside-in
  // there are no connectors, so coverage and freshness are structurally
  // unreachable: any stray signal rows (for example left over from a prior
  // connected run) are ignored here rather than allowed to lift the score past
  // the mode ceiling.
  const isOutsideIn = dataMode === "outside_in";
  const families = new Set<string>();
  if (!isOutsideIn) {
    for (const s of input.signals) {
      if (!s.sourceConnectorKey) continue;
      const descriptor = getDescriptor(s.sourceConnectorKey);
      if (descriptor) families.add(descriptor.family);
    }
  }

  const times = isOutsideIn
    ? []
    : input.signals.map((s) => s.computedAt).filter((t) => Number.isFinite(t));
  const newest = times.length > 0 ? Math.max(...times) : null;
  const ageSeconds = newest === null ? null : Math.max(0, (nowMs - newest) / 1000);

  // Coverage.
  const cov = coverageFromFeeds(input.feeds, families, cfg.feedAliasMap);
  let coverageAction: string | null;
  let coverageReason: string;
  if (dataMode === "outside_in") {
    coverageAction = "Connect your data";
    coverageReason =
      "Outside-in mode: " +
      cov.covered +
      " of " +
      cov.mappable +
      " connectable feeds present; connect data to raise the ceiling.";
  } else if (cov.value === null) {
    coverageAction = null;
    coverageReason = "No connectable feeds are defined for this layer.";
  } else if (cov.value < 1) {
    coverageAction = "Connect " + describeFeeds(cov.missingFeeds) + " data";
    coverageReason = cov.covered + " of " + cov.mappable + " connectable feeds present.";
  } else {
    coverageAction = null;
    coverageReason = "All " + cov.mappable + " connectable feeds present.";
  }

  // Freshness.
  let freshnessValue: number | null;
  let freshnessReason: string;
  let freshnessAction: string | null;
  if (ageSeconds === null) {
    freshnessValue = null;
    freshnessAction = null;
    freshnessReason =
      dataMode === "outside_in"
        ? "Outside-in mode: no connected feeds to age."
        : "No connected signals yet.";
  } else {
    freshnessValue = freshnessDecay(
      ageSeconds,
      cfg.freshnessThresholdSeconds,
      cfg.freshnessMaxMultiple,
    );
    const ageHours = Math.round(ageSeconds / 3600);
    freshnessReason = "Newest connected signal is about " + ageHours + " hours old.";
    freshnessAction = freshnessValue < 1 ? "Refresh the connected feeds" : null;
  }

  // Verification rate.
  const verified = input.verifiedItems.length;
  const modelled = input.modelledItems.length;
  const vr = verificationRate(verified, modelled);
  const verificationReason =
    vr === null
      ? "No verified or modelled claims yet."
      : verified + " of " + (verified + modelled) + " claims verified against a primary source.";

  // Adversarial survival.
  let ruledOut = 0;
  for (const c of input.confounders) {
    if ((c as { verdict?: unknown }).verdict === "ruled_out") ruledOut += 1;
  }
  const sr = survivalRate(ruledOut, input.confounders.length);
  const advReason =
    sr === null
      ? input.reducedMode
        ? "Reduced express build skipped the Confounder stage."
        : "No confounders have been tested for this layer."
      : ruledOut + " of " + input.confounders.length + " confounders ruled out.";
  const advAction =
    sr === null
      ? "Run a full-depth refresh to stress-test the finding"
      : sr < 1
        ? "Resolve the open confounders"
        : null;

  // Source diversity.
  const urls = [
    ...urlsFrom(input.verifiedItems),
    ...urlsFrom(input.modelledItems),
    ...urlsFrom(input.confounders),
  ];
  const extras = dataMode === "connected" ? [...families].map((f) => "family:" + f) : [];
  const sd = sourceDiversity(urls, extras, cfg.sourceDiversityTarget);
  const diversityReason =
    sd.value === null
      ? "No cited sources yet."
      : sd.distinct +
        " distinct sources behind this layer (target " +
        cfg.sourceDiversityTarget +
        ").";

  const measurements: Record<EfficacyDriverKey, DriverMeasurement> = {
    coverage: { value: cov.value, reason: coverageReason, actionPhrase: coverageAction },
    freshness: { value: freshnessValue, reason: freshnessReason, actionPhrase: freshnessAction },
    verificationRate: {
      value: vr,
      reason: verificationReason,
      actionPhrase: vr !== null && vr < 1 ? "Verify more claims against primary sources" : null,
    },
    adversarialSurvival: { value: sr, reason: advReason, actionPhrase: advAction },
    sourceDiversity: {
      value: sd.value,
      reason: diversityReason,
      actionPhrase: sd.value !== null && sd.value < 1 ? "Add an independent source" : null,
    },
  };

  return computeEfficacyIndex({
    measurements,
    weights: cfg.weights,
    dataMode,
    modeCappedDrivers: dataMode === "outside_in" ? ["coverage", "freshness"] : [],
  });
}

function tenantModeCeiling(dataMode: DataMode, cfg: EfficacyConfig): number {
  if (dataMode !== "outside_in") return 100;
  const w = normalizeWeights(cfg.weights);
  return Math.round((1 - w.coverage - w.freshness) * 100);
}

// The efficacy index for one tenant layer, or null when the layer has not been
// generated for the tenant.
export async function loadLayerEfficacy(
  tenantId: string,
  layerKey: string,
  cfg: EfficacyConfig = efficacyConfig(),
  nowMs: number = Date.now(),
): Promise<EfficacyIndex | null> {
  const [tenant] = await db
    .select({ dataMode: tenantsTable.dataMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) return null;

  const [layer] = await db
    .select({ feeds: layersTable.feeds })
    .from(layersTable)
    .where(eq(layersTable.key, layerKey))
    .limit(1);
  if (!layer) return null;

  const [tl] = await db
    .select({
      verifiedClaims: tenantLayersTable.verifiedClaims,
      modelledClaims: tenantLayersTable.modelledClaims,
      confounders: tenantLayersTable.confounders,
      reducedMode: tenantLayersTable.reducedMode,
    })
    .from(tenantLayersTable)
    .where(and(eq(tenantLayersTable.tenantId, tenantId), eq(tenantLayersTable.layerKey, layerKey)))
    .limit(1);
  if (!tl) return null;

  const signals = await db
    .select({
      sourceConnectorKey: derivedSignalsTable.sourceConnectorKey,
      computedAt: derivedSignalsTable.computedAt,
    })
    .from(derivedSignalsTable)
    .where(
      and(
        eq(derivedSignalsTable.tenantId, tenantId),
        eq(derivedSignalsTable.layerKey, layerKey),
      ),
    );

  return buildLayerEfficacy(
    {
      layerKey,
      feeds: Array.isArray(layer.feeds) ? layer.feeds : [],
      generated: true,
      reducedMode: tl.reducedMode,
      verifiedItems: itemsOf(tl.verifiedClaims),
      modelledItems: itemsOf(tl.modelledClaims),
      confounders: asObjectArray(tl.confounders),
      signals: signals.map((s) => ({
        sourceConnectorKey: s.sourceConnectorKey,
        computedAt: s.computedAt.getTime(),
      })),
    },
    asDataMode(tenant.dataMode),
    cfg,
    nowMs,
  );
}

// Every layer's efficacy for one tenant plus the tenant rollup (the mean of the
// generated layers' scores). Used by the business-performance layer summary and
// the Board Pack.
export async function loadTenantEfficacy(
  tenantId: string,
  cfg: EfficacyConfig = efficacyConfig(),
  nowMs: number = Date.now(),
): Promise<TenantEfficacy | null> {
  const [tenant] = await db
    .select({ dataMode: tenantsTable.dataMode })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) return null;
  const dataMode = asDataMode(tenant.dataMode);

  const [layerRows, tlRows, signalRows] = await Promise.all([
    db
      .select({ key: layersTable.key, name: layersTable.name, feeds: layersTable.feeds, sortOrder: layersTable.sortOrder })
      .from(layersTable)
      .orderBy(layersTable.sortOrder),
    db
      .select({
        layerKey: tenantLayersTable.layerKey,
        verifiedClaims: tenantLayersTable.verifiedClaims,
        modelledClaims: tenantLayersTable.modelledClaims,
        confounders: tenantLayersTable.confounders,
        reducedMode: tenantLayersTable.reducedMode,
      })
      .from(tenantLayersTable)
      .where(eq(tenantLayersTable.tenantId, tenantId)),
    db
      .select({
        layerKey: derivedSignalsTable.layerKey,
        sourceConnectorKey: derivedSignalsTable.sourceConnectorKey,
        computedAt: derivedSignalsTable.computedAt,
      })
      .from(derivedSignalsTable)
      .where(eq(derivedSignalsTable.tenantId, tenantId)),
  ]);

  const tlByLayer = new Map(tlRows.map((r) => [r.layerKey, r]));
  const signalsByLayer = new Map<string, LayerSignalInput[]>();
  for (const s of signalRows) {
    const list = signalsByLayer.get(s.layerKey) ?? [];
    list.push({ sourceConnectorKey: s.sourceConnectorKey, computedAt: s.computedAt.getTime() });
    signalsByLayer.set(s.layerKey, list);
  }

  const layers: LayerEfficacySummary[] = [];
  const scores: number[] = [];
  for (const l of layerRows) {
    const tl = tlByLayer.get(l.key);
    const index = tl
      ? buildLayerEfficacy(
          {
            layerKey: l.key,
            feeds: Array.isArray(l.feeds) ? l.feeds : [],
            generated: true,
            reducedMode: tl.reducedMode,
            verifiedItems: itemsOf(tl.verifiedClaims),
            modelledItems: itemsOf(tl.modelledClaims),
            confounders: asObjectArray(tl.confounders),
            signals: signalsByLayer.get(l.key) ?? [],
          },
          dataMode,
          cfg,
          nowMs,
        )
      : null;
    if (index) scores.push(index.score);
    layers.push({ layerKey: l.key, layerName: l.name, generated: tl != null, index });
  }

  return {
    dataMode,
    modeCeiling: tenantModeCeiling(dataMode, cfg),
    rollup: rollupEfficacy(scores),
    layers,
  };
}

// A batch tenant rollup for the portfolio board: one read across every tenant in
// scope, returning each tenant's efficacy rollup. Tenants with no generated
// layer get a null score (an honest dash on the board), never a fabricated zero.
export async function loadEfficacyForTenants(
  tenantIds: string[],
  cfg: EfficacyConfig = efficacyConfig(),
  nowMs: number = Date.now(),
): Promise<Map<string, { score: number | null; n: number }>> {
  const result = new Map<string, { score: number | null; n: number }>();
  if (tenantIds.length === 0) return result;

  const [tenantRows, layerRows, tlRows, signalRows] = await Promise.all([
    db
      .select({ id: tenantsTable.id, dataMode: tenantsTable.dataMode })
      .from(tenantsTable)
      .where(inArray(tenantsTable.id, tenantIds)),
    db
      .select({ key: layersTable.key, feeds: layersTable.feeds })
      .from(layersTable),
    db
      .select({
        tenantId: tenantLayersTable.tenantId,
        layerKey: tenantLayersTable.layerKey,
        verifiedClaims: tenantLayersTable.verifiedClaims,
        modelledClaims: tenantLayersTable.modelledClaims,
        confounders: tenantLayersTable.confounders,
        reducedMode: tenantLayersTable.reducedMode,
      })
      .from(tenantLayersTable)
      .where(inArray(tenantLayersTable.tenantId, tenantIds)),
    db
      .select({
        tenantId: derivedSignalsTable.tenantId,
        layerKey: derivedSignalsTable.layerKey,
        sourceConnectorKey: derivedSignalsTable.sourceConnectorKey,
        computedAt: derivedSignalsTable.computedAt,
      })
      .from(derivedSignalsTable)
      .where(inArray(derivedSignalsTable.tenantId, tenantIds)),
  ]);

  const feedsByLayer = new Map(layerRows.map((l) => [l.key, Array.isArray(l.feeds) ? l.feeds : []]));
  const modeByTenant = new Map(tenantRows.map((t) => [t.id, asDataMode(t.dataMode)]));

  const signalsByTenantLayer = new Map<string, LayerSignalInput[]>();
  for (const s of signalRows) {
    const k = s.tenantId + "::" + s.layerKey;
    const list = signalsByTenantLayer.get(k) ?? [];
    list.push({ sourceConnectorKey: s.sourceConnectorKey, computedAt: s.computedAt.getTime() });
    signalsByTenantLayer.set(k, list);
  }

  const scoresByTenant = new Map<string, number[]>();
  for (const tl of tlRows) {
    const dataMode = modeByTenant.get(tl.tenantId) ?? "connected";
    const index = buildLayerEfficacy(
      {
        layerKey: tl.layerKey,
        feeds: feedsByLayer.get(tl.layerKey) ?? [],
        generated: true,
        reducedMode: tl.reducedMode,
        verifiedItems: itemsOf(tl.verifiedClaims),
        modelledItems: itemsOf(tl.modelledClaims),
        confounders: asObjectArray(tl.confounders),
        signals: signalsByTenantLayer.get(tl.tenantId + "::" + tl.layerKey) ?? [],
      },
      dataMode,
      cfg,
      nowMs,
    );
    if (index) {
      const list = scoresByTenant.get(tl.tenantId) ?? [];
      list.push(index.score);
      scoresByTenant.set(tl.tenantId, list);
    }
  }

  for (const id of tenantIds) {
    result.set(id, rollupEfficacy(scoresByTenant.get(id) ?? []));
  }
  return result;
}
