import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, layersTable, tenantLayerSnapshotsTable, tenantsTable } from "@workspace/db";
import {
  silentLogger,
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionZoneRuntime,
  type LayerDescriptor,
  type ProfileOutput,
  type StageContext,
} from "@workspace/cortex";
import { efficacyConfig } from "../efficacy/config";
import { loadLayerEfficacy } from "../efficacy/efficacyService";
import { buildTenantAsOf } from "../replay/asOf";
import { runLayer } from "./orchestrator";

// The honesty invariant under test (the AP correctness audit's one real defect):
// the as-of snapshot records the tenant's DATA-SOURCE regime at build time (the
// same column the live efficacy reads), never the model-execution dataMode. A
// sovereign build is an EXECUTION regime, not a data source; a sovereign build of
// an outside_in tenant has no connector grounding and must record "outside_in",
// so its as-of ceiling matches its live ceiling. The prior code collapsed the
// execution dataMode (which can be "sovereign") to "connected", recording a 100
// as-of ceiling for an outside_in build whose live ceiling was 60: the same
// build, two ceilings.
//
// This runs against a real Postgres through the real runLayer write path, with an
// injected in-boundary runtime so no external model is ever called. A throwaway
// tenant and one throwaway layer own everything; deleting the tenant cascades its
// snapshots, layer rows, runs and usage, and the layer is removed explicitly, so
// the suite is self-cleaning and safe to run repeatedly.
const RUN = `snapmode-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const LAYER = `${RUN}-layer`;
const CFG = efficacyConfig({} as NodeJS.ProcessEnv);

let tenantId = "";

const profile: ProfileOutput = {
  name: "Sovereign Seat Co",
  url: `https://${RUN}.example.com`,
  sector: "Industrial Manufacturing",
  logoMonogram: "SS",
};

const layer: LayerDescriptor & { feeds: string[] } = {
  key: LAYER,
  name: "Demand",
  description: "How demand is forming across the pipeline.",
  diagnosticQuestion: "Is demand strengthening or softening, and why?",
  feeds: ["fixture"],
};

// A single valid narrate content (the only stage output the orchestrator strictly
// validates, via assembleLayerContent). ASCII hyphens only.
const narrateContent = {
  narrative: "Demand has softened across the mid-market segment over the last two quarters.",
  headline_finding: "Demand is softening in the mid-market.",
  headline_impact: "Pipeline value is at risk.",
  headline_lever: "Re-sequence the outbound motion to defend the core accounts.",
  causes: [
    {
      title: "Pipeline thinning",
      impact: "Fewer qualified opportunities are entering the funnel.",
      detail: "New-logo creation slowed through the period.",
    },
  ],
  actions: [
    {
      title: "Refocus outbound",
      detail: "Concentrate effort on the core segment.",
      impact: "Stabilises the pipeline within a quarter.",
    },
  ],
  hypotheses: [],
  proof: { items: [] },
  metrics: [{ label: "Win rate", value: "28%", tone: "warn" }],
};

// One value served for every in-boundary stage: the prior-stage objects are only
// JSON-serialised into later prompts, so a superset object satisfies them all,
// while narrate.content carries the valid LayerContent and score carries the
// fields runLayer reads (confidence/confidence_gap/gaps/claims/forecasts). Empty
// claim and forecast arrays keep the build hermetic (no provenance or forecast
// rows written).
const universalValue = {
  signals: [],
  named_entities: [],
  sector_context: "",
  content: narrateContent,
  confounders: [],
  findings: [],
  alternative_hypotheses: [],
  verified_claims: [],
  modelled_claims: [],
  confidence: 55,
  confidence_gap: 12,
  gaps: [],
  claims: [],
  forecasts: [],
  hero: { headline: "", points: [] },
  peers: { items: [] },
  supplements: { blocks: [] },
};

// An in-boundary runtime standing in for the local seat: it returns the fixed
// value for every stage and never reaches an external model. Routing every stage
// onto it is exactly the sovereign regime.
function inBoundaryRuntime(value: unknown): ExtractionZoneRuntime {
  return {
    model: "local-boundary-model",
    endpoint: "http://boundary.local/v1/chat/completions",
    callJson<R>(_req: ExtractionRequest<R>): Promise<ExtractionResult<R>> {
      return Promise.resolve({
        ok: true,
        value: value as unknown as R,
        durationMs: 2,
        model: "local-boundary-model",
        inputTokens: 5,
        outputTokens: 9,
      });
    },
  };
}

function sovereignStageContext(): StageContext {
  return { dataMode: "sovereign", extractionRuntime: inBoundaryRuntime(universalValue) };
}

// The snapshot ledger is append-only and runIds are reused across rebuilds of a
// (tenant, layer) pair, so the build under test is the NEWEST snapshot by its
// captured instant, never one keyed on the reused runId.
async function latestSnapshotDataMode(): Promise<string | undefined> {
  const [snap] = await db
    .select({ dataMode: tenantLayerSnapshotsTable.dataMode })
    .from(tenantLayerSnapshotsTable)
    .where(
      and(
        eq(tenantLayerSnapshotsTable.tenantId, tenantId),
        eq(tenantLayerSnapshotsTable.layerKey, LAYER),
      ),
    )
    .orderBy(desc(tenantLayerSnapshotsTable.snapshotAt))
    .limit(1);
  return snap?.dataMode;
}

beforeAll(async () => {
  const inserted = await db
    .insert(tenantsTable)
    .values({
      name: `t-${RUN}`,
      url: `https://${RUN}.example.com`,
      dataMode: "outside_in",
    })
    .returning({ id: tenantsTable.id });
  tenantId = inserted[0]!.id;

  await db.insert(layersTable).values({
    key: LAYER,
    name: `Layer ${LAYER}`,
    description: "snapshot-datamode fixture",
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
    sortOrder: 9100,
    benchmarkCanonicalKey: null,
  });
});

afterAll(async () => {
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await db.delete(layersTable).where(eq(layersTable.key, LAYER));
});

describe("as-of snapshot records the data-source regime, not the model-execution mode", () => {
  it("a sovereign build of an outside_in tenant records outside_in, and its as-of ceiling matches its live ceiling", async () => {
    const outcome = await runLayer(
      tenantId,
      profile,
      layer,
      { log: silentLogger, stageContext: sovereignStageContext() },
      undefined,
      "sovereign",
      "outside_in",
    );
    expect(outcome.status).toBe("built");
    expect(outcome.runId).toBeTruthy();

    // The defect: the model-execution mode was "sovereign", which the prior code
    // mapped to "connected". The fix records the data-source regime that grounded
    // the build (threaded in as dataSourceMode), so the snapshot is honestly
    // outside_in.
    expect(await latestSnapshotDataMode()).toBe("outside_in");

    // The live efficacy (reads tenants.dataMode) and the as-of efficacy (reads
    // the snapshot's captured dataMode) now agree for this one build: both capped
    // below a connected build's full 100, and equal to each other.
    const live = await loadLayerEfficacy(tenantId, LAYER, CFG);
    expect(live).not.toBeNull();
    expect(live!.modeCeiling).toBeLessThan(100);

    const at = new Date(Date.now() + 1000);
    const view = (await buildTenantAsOf(tenantId, at, CFG, at))!;
    const asOfLayer = view.layers.find((l) => l.layerKey === LAYER)!;
    expect(asOfLayer.available).toBe(true);
    expect(asOfLayer.efficacy).not.toBeNull();
    expect(asOfLayer.efficacy!.modeCeiling).toBe(live!.modeCeiling);
  });

  it("a sovereign build of a connected tenant keeps the connected ceiling", async () => {
    await db.update(tenantsTable).set({ dataMode: "connected" }).where(eq(tenantsTable.id, tenantId));

    const outcome = await runLayer(
      tenantId,
      profile,
      layer,
      { log: silentLogger, resume: false, stageContext: sovereignStageContext() },
      undefined,
      "sovereign",
      "connected",
    );
    expect(outcome.status).toBe("built");
    expect(outcome.runId).toBeTruthy();

    // Same sovereign execution mode, but the data source that grounded the build
    // is now connected, so the snapshot records connected and earns the full
    // ceiling on both the live and the as-of path.
    expect(await latestSnapshotDataMode()).toBe("connected");

    const live = await loadLayerEfficacy(tenantId, LAYER, CFG);
    expect(live).not.toBeNull();
    expect(live!.modeCeiling).toBe(100);

    const at = new Date(Date.now() + 1000);
    const view = (await buildTenantAsOf(tenantId, at, CFG, at))!;
    const asOfLayer = view.layers.find((l) => l.layerKey === LAYER)!;
    expect(asOfLayer.available).toBe(true);
    expect(asOfLayer.efficacy).not.toBeNull();
    expect(asOfLayer.efficacy!.modeCeiling).toBe(live!.modeCeiling);
  });

  it("records the data-source regime that grounded the build, never a later read of the mutable tenant column", async () => {
    // Race immunity. The tenant row still reads connected (from the previous
    // case), but THIS build was grounded outside_in and is told so through the
    // threaded data-source regime, exactly as a build that began before an admin
    // flipped the tenant's mode would be. The snapshot must record the regime the
    // build actually ran under (outside_in), never the now-divergent live column
    // (connected). A re-read of tenants.dataMode at snapshot time would record
    // connected here and reopen the two-ceiling defect, so this proves the fix is
    // structurally immune to a mid-build flip.
    const liveBefore = await loadLayerEfficacy(tenantId, LAYER, CFG);
    expect(liveBefore).not.toBeNull();
    expect(liveBefore!.modeCeiling).toBe(100); // the live column is still connected

    const outcome = await runLayer(
      tenantId,
      profile,
      layer,
      { log: silentLogger, resume: false, stageContext: sovereignStageContext() },
      undefined,
      "sovereign",
      "outside_in",
    );
    expect(outcome.status).toBe("built");

    expect(await latestSnapshotDataMode()).toBe("outside_in");

    // The as-of efficacy reflects the regime the build ran under (outside_in,
    // capped below 100), proving the snapshot, not the live connected column,
    // drove it.
    const at = new Date(Date.now() + 1000);
    const view = (await buildTenantAsOf(tenantId, at, CFG, at))!;
    const asOfLayer = view.layers.find((l) => l.layerKey === LAYER)!;
    expect(asOfLayer.available).toBe(true);
    expect(asOfLayer.efficacy).not.toBeNull();
    expect(asOfLayer.efficacy!.modeCeiling).toBeLessThan(100);
  });
});
