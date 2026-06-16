import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  derivedSignalsTable,
  layersTable,
  provenanceLedgerTable,
  tenantLayerSnapshotsTable,
  tenantsTable,
} from "@workspace/db";
import { efficacyConfig } from "../efficacy/config";
import { buildTenantAsOf } from "./asOf";
import { hashLayerContent, type HashableLayerContent } from "./contentHash";

// The as-of read-model reconstructs a past state from the append-only snapshot
// ledger and timestamped state, so this runs against a real Postgres. A throwaway
// tenant and three throwaway layers own everything; deleting the tenant cascades
// its snapshots and ledger rows, and the layers are removed explicitly, so the
// suite is self-cleaning and safe to run repeatedly. The instants are fixed so the
// reconstruction is deterministic regardless of when the test runs.
const RUN = `asof-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const LAYER_REVISED = `${RUN}-revised`;
const LAYER_STABLE = `${RUN}-stable`;
const LAYER_FUTURE = `${RUN}-future`;
const LAYER_MODE = `${RUN}-mode`;
const LAYER_SIGNALS = `${RUN}-signals`;
const CFG = efficacyConfig({} as NodeJS.ProcessEnv);

const T0 = new Date("2026-01-01T00:00:00.000Z"); // first build of revised + stable
const AS_OF = new Date("2026-02-01T00:00:00.000Z"); // the instant we replay
const T2 = new Date("2026-03-01T00:00:00.000Z"); // rebuild of revised + only build of future
const NOW = new Date("2026-04-01T00:00:00.000Z"); // the "current" side of every diff

let tenantId = "";

function claims(n: number): { items: Record<string, unknown>[] } {
  return { items: Array.from({ length: n }, (_, i) => ({ source_urls: [`https://e.com/${i}`] })) };
}

async function insertLayer(key: string, sortOrder: number): Promise<void> {
  await db.insert(layersTable).values({
    key,
    name: `Layer ${key}`,
    description: "as-of fixture",
    archetype: "Performance scorecard",
    heroDescription: "",
    ownerPersona: "",
    diagnosticQuestion: "fixture question",
    metricDefinitions: { tiles: ["a", "b", "c", "d"] },
    rootCauses: [],
    actions: [],
    gaps: { items: [], closedBy: "" },
    feeds: ["fixture"],
    moduleGroup: "Test",
    isCanonical: true,
    sortOrder,
    benchmarkCanonicalKey: null,
  });
}

async function insertSnapshot(opts: {
  layerKey: string;
  at: Date;
  verified: number;
  modelled: number;
  confounders: unknown[];
  rawConfidence: number;
  summary: string;
  dataMode?: "outside_in" | "connected";
  feeds?: string[];
  signalMeta?: { sourceConnectorKey: string | null; computedAt: number | null }[];
}): Promise<void> {
  const payload: HashableLayerContent = {
    content: { summary: opts.summary },
    heroPanel: null,
    peerBenchmark: null,
    supplementBlocks: null,
    confounders: opts.confounders,
    verifiedClaims: claims(opts.verified),
    modelledClaims: claims(opts.modelled),
    voiceQuality: null,
    reducedMode: false,
  };
  await db.insert(tenantLayerSnapshotsTable).values({
    tenantId,
    layerKey: opts.layerKey,
    runId: null,
    snapshotAt: opts.at,
    content: { summary: opts.summary },
    heroPanel: null,
    peerBenchmark: null,
    supplementBlocks: null,
    confounders: opts.confounders,
    verifiedClaims: claims(opts.verified),
    modelledClaims: claims(opts.modelled),
    voiceQuality: null,
    reducedMode: false,
    dataMode: opts.dataMode ?? "connected",
    feeds: opts.feeds ?? ["fixture"],
    signalMeta: opts.signalMeta ?? [],
    generatorModel: "test-model",
    rawConfidence: opts.rawConfidence,
    contentHash: hashLayerContent(payload),
  });
}

beforeAll(async () => {
  const inserted = await db
    .insert(tenantsTable)
    .values({
      name: `t-${RUN}`,
      url: `https://${RUN}.example.com`,
      dataMode: "connected",
    })
    .returning({ id: tenantsTable.id });
  tenantId = inserted[0]!.id;

  await insertLayer(LAYER_REVISED, 9001);
  await insertLayer(LAYER_STABLE, 9002);
  await insertLayer(LAYER_FUTURE, 9003);
  await insertLayer(LAYER_MODE, 9004);
  await insertLayer(LAYER_SIGNALS, 9005);

  // Revised: a thin first build before the as-of date, rebuilt richer after it.
  await insertSnapshot({
    layerKey: LAYER_REVISED,
    at: T0,
    verified: 1,
    modelled: 2,
    confounders: [{ verdict: "unresolved" }],
    rawConfidence: 0.6,
    summary: "first take",
  });
  await insertSnapshot({
    layerKey: LAYER_REVISED,
    at: T2,
    verified: 3,
    modelled: 1,
    confounders: [{ verdict: "ruled_out" }],
    rawConfidence: 0.78,
    summary: "revised take",
  });

  // Stable: a single build before the as-of date, never rebuilt.
  await insertSnapshot({
    layerKey: LAYER_STABLE,
    at: T0,
    verified: 2,
    modelled: 0,
    confounders: [{ verdict: "ruled_out" }],
    rawConfidence: 0.7,
    summary: "stable take",
  });

  // Future: only ever built AFTER the as-of date, so it did not exist then.
  await insertSnapshot({
    layerKey: LAYER_FUTURE,
    at: T2,
    verified: 1,
    modelled: 1,
    confounders: [],
    rawConfidence: 0.5,
    summary: "later take",
  });

  // Mode: built BEFORE the as-of date in outside-in mode, even though the tenant
  // is connected NOW. The as-of efficacy must honour the mode captured at build
  // time, so its ceiling stays capped below a connected build's full 100.
  await insertSnapshot({
    layerKey: LAYER_MODE,
    at: T0,
    verified: 2,
    modelled: 0,
    confounders: [{ verdict: "ruled_out" }],
    rawConfidence: 0.7,
    summary: "outside-in take",
    dataMode: "outside_in",
  });

  // Signals: a connected build at T0 grounded on a warehouse connector, whose
  // signal metadata is captured ON the snapshot. After the as-of date a refresh
  // delete-replaces the live derived_signals with a fresh T2 set. The as-of
  // replay must read the build-time metadata from the snapshot, not the live
  // table, so its connector-grounded drivers (coverage, freshness) stay measured
  // for the past date even though no live signal predates it any more.
  await insertSnapshot({
    layerKey: LAYER_SIGNALS,
    at: T0,
    verified: 1,
    modelled: 1,
    confounders: [],
    rawConfidence: 0.66,
    summary: "grounded take",
    dataMode: "connected",
    feeds: ["Data warehouse or BI"],
    signalMeta: [{ sourceConnectorKey: "snowflake", computedAt: T0.getTime() }],
  });
  // The post-as-of refresh: the only live signal now is dated T2, after the
  // replay instant, so an as-of read of the LIVE table would see nothing.
  await db.insert(derivedSignalsTable).values({
    tenantId,
    layerKey: LAYER_SIGNALS,
    signalKey: "warehouse_health",
    value: 1,
    sourceConnectorKey: "snowflake",
    computedAt: T2,
  });

  // Evidence growth: one ledger entry before the as-of date, one after.
  await db.insert(provenanceLedgerTable).values([
    { tenantId, claimPath: `${RUN}:a`, sourceRef: "sha256:a", contentHash: "h0", prevHash: null, createdAt: T0 },
    { tenantId, claimPath: `${RUN}:b`, sourceRef: "sha256:b", contentHash: "h1", prevHash: "h0", createdAt: T2 },
  ]);
});

afterAll(async () => {
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await db
    .delete(layersTable)
    .where(
      inArray(layersTable.key, [
        LAYER_REVISED,
        LAYER_STABLE,
        LAYER_FUTURE,
        LAYER_MODE,
        LAYER_SIGNALS,
      ]),
    );
});

describe("buildTenantAsOf", () => {
  it("reconstructs the diagnosis that stood at the as-of date, layer by layer", async () => {
    const view = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    expect(view).not.toBeNull();
    expect(view.tenantId).toBe(tenantId);
    expect(view.hasHistory).toBe(true);
    expect(view.asOf).toBe(AS_OF.toISOString());
    expect(view.now).toBe(NOW.toISOString());
    expect(view.earliestSnapshotAt).toBe(T0.toISOString());
    expect(view.latestSnapshotAt).toBe(T2.toISOString());

    const revised = view.layers.find((l) => l.layerKey === LAYER_REVISED)!;
    expect(revised.available).toBe(true);
    // The as-of view shows the FIRST build, not the later rebuild.
    expect(revised.snapshotAt).toBe(T0.toISOString());
    expect((revised.content as { summary?: string }).summary).toBe("first take");
    expect(revised.efficacy).not.toBeNull();
    expect(revised.confidence).not.toBeNull();
  });

  it("diffs each layer honestly against its current build", async () => {
    const view = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;

    // Revised: the diagnosis changed, and every delta is current-minus-as-of.
    const revised = view.layers.find((l) => l.layerKey === LAYER_REVISED)!;
    expect(revised.changedSince.hasCurrent).toBe(true);
    expect(revised.changedSince.contentChanged).toBe(true);
    expect(revised.changedSince.verifiedDelta).toBe(2); // 3 now - 1 then
    expect(revised.changedSince.modelledDelta).toBe(-1); // 1 now - 2 then
    expect(revised.changedSince.confounderDelta).toBe(0);
    expect(revised.changedSince.efficacyDelta).not.toBeNull();
    expect(revised.changedSince.confidenceDelta).not.toBeNull();

    // Stable: one build, never rebuilt, so it is unchanged with zero deltas.
    const stable = view.layers.find((l) => l.layerKey === LAYER_STABLE)!;
    expect(stable.available).toBe(true);
    expect(stable.changedSince.hasCurrent).toBe(true);
    expect(stable.changedSince.contentChanged).toBe(false);
    expect(stable.changedSince.verifiedDelta).toBe(0);
    expect(stable.changedSince.efficacyDelta).toBe(0);

    // Future: it did not exist at the as-of date, so it is honestly unavailable,
    // and the diff records that a build has appeared since.
    const future = view.layers.find((l) => l.layerKey === LAYER_FUTURE)!;
    expect(future.available).toBe(false);
    expect(future.reason).toBe("no_snapshot_available");
    expect(future.content).toBeNull();
    expect(future.efficacy).toBeNull();
    expect(future.changedSince.hasCurrent).toBe(true);
  });

  it("counts honest evidence growth and post-date activity", async () => {
    const view = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    expect(view.ledger.entriesAsOf).toBe(1); // only the T0 entry by the as-of date
    expect(view.ledger.entriesCurrent).toBe(2); // both by now
    // No decisions or graded outcomes were seeded for this tenant; the honest
    // count is zero, never a fabricated figure.
    expect(view.decisionsSince).toBe(0);
    expect(view.outcomesSince).toBe(0);
  });

  it("is a pure read: replaying never writes or edits a snapshot", async () => {
    const before = await db
      .select({ id: tenantLayerSnapshotsTable.id })
      .from(tenantLayerSnapshotsTable)
      .where(eq(tenantLayerSnapshotsTable.tenantId, tenantId));
    const first = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    const second = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    const after = await db
      .select({ id: tenantLayerSnapshotsTable.id })
      .from(tenantLayerSnapshotsTable)
      .where(eq(tenantLayerSnapshotsTable.tenantId, tenantId));
    expect(after.length).toBe(before.length);
    // Deterministic reconstruction: the same date replays identically.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("recomputes as-of efficacy with the data mode captured at build time", async () => {
    const view = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    const mode = view.layers.find((l) => l.layerKey === LAYER_MODE)!;
    const stable = view.layers.find((l) => l.layerKey === LAYER_STABLE)!;
    expect(mode.available).toBe(true);
    expect(mode.efficacy).not.toBeNull();
    expect(stable.efficacy).not.toBeNull();
    // The tenant is connected NOW, but this layer was built outside-in. The
    // connector-grounded drivers are structurally capped, so its ceiling is below
    // a connected build's full 100. Reading the tenant's CURRENT mode would have
    // fabricated the higher ceiling and a higher score for a date when the system
    // did not hold it.
    expect(stable.efficacy!.modeCeiling).toBe(100);
    expect(mode.efficacy!.modeCeiling).toBeLessThan(100);
  });

  it("recomputes as-of connected efficacy from the snapshot's captured signal metadata, not the delete-replaced live signals", async () => {
    const view = (await buildTenantAsOf(tenantId, AS_OF, CFG, NOW))!;
    const sig = view.layers.find((l) => l.layerKey === LAYER_SIGNALS)!;
    expect(sig.available).toBe(true);
    // The as-of build is the T0 one; the live derived_signals were superseded by
    // a T2 set dated after the replay instant.
    expect(sig.snapshotAt).toBe(T0.toISOString());
    expect(sig.efficacy).not.toBeNull();
    const coverage = sig.efficacy!.drivers.find((d) => d.key === "coverage")!;
    const freshness = sig.efficacy!.drivers.find((d) => d.key === "freshness")!;
    // Reading the live table at the as-of date would find no signal (the only row
    // is dated after it), nulling these drivers. Reading the snapshot's captured
    // T0 grounding keeps them measured: the warehouse feed is covered, and the
    // newest captured signal ages honestly against the as-of date.
    expect(coverage.status).toBe("measured");
    expect(coverage.value).toBe(1);
    expect(freshness.status).toBe("measured");
    expect(freshness.value).not.toBeNull();
  });

  it("returns null for an unknown tenant", async () => {
    expect(await buildTenantAsOf("00000000-0000-0000-0000-000000000000", AS_OF, CFG, NOW)).toBeNull();
  });
});
