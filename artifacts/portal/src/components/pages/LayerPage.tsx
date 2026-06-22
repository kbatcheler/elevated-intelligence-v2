import React, { useCallback, useEffect, useState } from "react";
import type {
  EfficacyIndex,
  FindingChallenge,
  LayerConfidenceAdvisory,
  LayerRegistryEntry,
  PipelineRun,
  TenantEfficacy,
  TenantLayerDetail,
} from "../../types";
import { fetchLayers, fetchRuns, fetchTenantLayer } from "../../lib/tenantApi";
import { fetchTenantEfficacy } from "../../lib/efficacyApi";
import { fetchChallenges, groupChallengesByRef } from "../../lib/challengeApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  formatRatioPct,
  PageWidth,
  ReasoningStrip,
  Skeleton,
  SkeletonLines,
} from "../primitives";
import { heroFor } from "../heroes/registry";
import { LayerSections, type ChallengeContext, type DecisionContext } from "../layer/sections";
import { BenchmarkConsent } from "../layer/BenchmarkConsent";

type State =
  | { kind: "loading" }
  | {
      kind: "ready";
      detail: TenantLayerDetail;
      run: PipelineRun | null;
      entry: LayerRegistryEntry | null;
      challenges: FindingChallenge[];
    }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// A single layer for the current tenant. The hero is dispatched by archetype
// (registry, with a generic fallback); everything below it is the shared frame
// in LayerSections. Every figure shown is a persisted field, never computed
// client-side. Each finding card carries the Interactive Challenge (Phase AA):
// a non-viewer seat can object to a finding and the engine re-reasons it.
export function LayerPage({ layerKey }: { layerKey: string }) {
  const { user, logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!currentId) {
      // No tenant to scope to: reflect why rather than spinning forever.
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    Promise.all([
      fetchTenantLayer(currentId, layerKey),
      fetchRuns(currentId),
      fetchLayers(),
      fetchChallenges(currentId),
    ]).then(([detailOut, runsOut, layersOut, challengesOut]) => {
      if (!alive) return;
      if ("unauthorized" in detailOut) return void logout();
      if (detailOut.state === "empty") return setState({ kind: "empty" });
      if (detailOut.state === "error") return setState({ kind: "error" });
      const run =
        "unauthorized" in runsOut || runsOut.state === "error"
          ? null
          : runsOut.items.find((r) => r.layerKey === layerKey) ?? null;
      const entry =
        "unauthorized" in layersOut || layersOut.state === "error"
          ? null
          : layersOut.items.find((l) => l.key === layerKey) ?? null;
      // The challenge overlay is non-critical: a transient failure shows no
      // history rather than blocking the layer. The list is filtered to this
      // layer's challenges only.
      const challenges =
        "unauthorized" in challengesOut || challengesOut.state === "error"
          ? []
          : challengesOut.challenges.filter((c) => c.layerKey === layerKey);
      setState({ kind: "ready", detail: detailOut.data, run, entry, challenges });
    });
    return () => {
      alive = false;
    };
  }, [currentId, layerKey, tenantStatus, logout]);

  // A new challenge is prepended so it appears immediately on its finding card,
  // newest first, matching the server ordering.
  const handleChallenged = useCallback((challenge: FindingChallenge) => {
    setState((s) => (s.kind === "ready" ? { ...s, challenges: [challenge, ...s.challenges] } : s));
  }, []);

  const crumbs = [
    { label: "Layers", to: "/layers" },
    { label: state.kind === "ready" && state.entry ? state.entry.name : layerKey },
  ];

  return (
    <PageWidth space="page">
      <Breadcrumbs items={crumbs} />

      <div className="mt-[18px]">
        {state.kind === "loading" && (
          <div className="grid gap-5">
            <Skeleton height={120} />
            <SkeletonLines lines={4} />
          </div>
        )}
        {state.kind === "error" && (
          <ErrorState message={`The "${layerKey}" layer could not be loaded.`} onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its layers will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState
            title="This layer has not been generated yet"
            message={
              current
                ? `${current.name} has no stored content for "${layerKey}".`
                : `No stored content for "${layerKey}".`
            }
          />
        )}
        {state.kind === "ready" && (
          <LayerBody
            {...state}
            canChallenge={user?.role !== "client-viewer"}
            onChallenged={handleChallenged}
            onUnauthorized={logout}
          />
        )}
      </div>
    </PageWidth>
  );
}

function LayerBody({
  detail,
  run,
  entry,
  challenges,
  canChallenge,
  onChallenged,
  onUnauthorized,
}: {
  detail: TenantLayerDetail;
  run: PipelineRun | null;
  entry: LayerRegistryEntry | null;
  challenges: FindingChallenge[];
  canChallenge: boolean;
  onChallenged: (challenge: FindingChallenge) => void;
  onUnauthorized: () => void;
}) {
  const Hero = heroFor(entry?.archetype);
  // The benchmark-variant layer is the only surface where participation in the
  // verified cohort is meaningful, so the default-off consent control lives here,
  // directly beneath its hero. The tenant id comes from the persisted detail.
  const isBenchmarkLayer = entry?.archetype === "Performance scorecard, benchmark variant";

  const challenge: ChallengeContext = {
    tenantId: detail.tenantId,
    layerKey: detail.layerKey,
    byRef: groupChallengesByRef(challenges),
    canChallenge,
    onChallenged,
    onUnauthorized,
  };

  // The same non-viewer seat that may challenge a finding may record a board
  // decision (defer or reject) against a recommended action. The commit path
  // lives elsewhere; this slot carries only the two contrarian calls.
  const decision: DecisionContext = {
    tenantId: detail.tenantId,
    layerKey: detail.layerKey,
    canDecide: canChallenge,
    onUnauthorized,
  };

  return (
    <div className="grid gap-6">
      {detail.reducedMode && (
        <span
          title="Built with the express chain: the confound and challenge adversarial sub-stages were skipped for this layer. A full refresh rebuilds it with the complete chain."
          className="justify-self-start inline-flex items-center py-1 px-2.5 rounded-full text-xs font-semibold text-navy bg-amber-faint border border-amber-base"
        >
          Express build (reduced)
        </span>
      )}
      {detail.confidenceCalibration && (
        <ConfidenceCalibrationNote advisory={detail.confidenceCalibration} />
      )}
      {detail.layerKey === "business-performance" && (
        <TenantEfficacyRollup tenantId={detail.tenantId} />
      )}
      {detail.efficacyIndex && <EfficacyNote index={detail.efficacyIndex} />}
      <Hero entry={entry} detail={detail} />
      {isBenchmarkLayer && <BenchmarkConsent tenantId={detail.tenantId} />}
      <LayerSections detail={detail} feeds={entry?.feeds ?? []} challenge={challenge} decision={decision} />
      <ReasoningStrip
        run={run}
        confounders={detail.confounders}
        generatorModel={detail.generatorModel}
        generatedAt={detail.generatedAt}
      />
    </div>
  );
}

// Phase AJ display-only confidence advisory. The raw Evaluator confidence pill is
// never overwritten; this strip sits beside it and is honest about the layer's
// Brier track record. Below the resolved-sample threshold it leads with the thin
// label and applies no adjustment. Once established it states the layer Brier and
// shows the disciplined value, but only when the track record actually pulls the
// pill down (an overconfident layer with a poor score); a well-calibrated layer
// is left untouched and never inflated.
function ConfidenceCalibrationNote({ advisory }: { advisory: LayerConfidenceAdvisory }) {
  const established = advisory.label.established;
  const applied = advisory.applied;
  const variantClass = !established
    ? "bg-cream-dark border-slate-light"
    : applied
      ? "bg-amber-faint border-amber-base"
      : "bg-cream-dark border-teal";

  const body = !established
    ? "Confidence calibration is provisional for this layer (" +
      advisory.label.label +
      "). The stated confidence is shown as-is until at least " +
      advisory.threshold +
      " of its forecasts resolve."
    : applied
      ? "This layer's forecasts have a Brier score of " +
        (advisory.brier === null ? "-" : advisory.brier.toFixed(3)) +
        " (worse than the " +
        "0.25 coin-flip baseline), so its displayed confidence is disciplined down by " +
        advisory.penalty +
        " point(s), from " +
        Math.round(advisory.raw) +
        "% to " +
        Math.round(advisory.adjusted) +
        "%. The raw stated confidence is unchanged underneath."
      : "This layer's forecasts have a Brier score of " +
        (advisory.brier === null ? "-" : advisory.brier.toFixed(3)) +
        " (at or better than the 0.25 coin-flip baseline), so its stated confidence stands on its own track record. No adjustment applied.";

  return (
    <div
      className={`justify-self-stretch py-2.5 px-3.5 rounded-lg text-caption leading-normal text-navy border ${variantClass}`}
    >
      <span className="font-semibold">Confidence calibration</span>
      <span className="ml-2 text-slate-base">{body}</span>
    </div>
  );
}

// Phase AK: the tenant-wide Data Efficacy rollup, shown on the business-
// performance summary layer. The headline is the mean of every generated layer's
// index, so the company's top page states how good the fuel behind its whole
// diagnosis was, beside the per-layer index below. A tenant with no generated
// layer rolls up to a dash, never a fabricated zero; outside-in mode names its
// structurally lower ceiling honestly. Self-fetching so the page frame stays
// thin, with distinct loading, ready, empty, and error states rather than a
// silently hidden or invented figure.
function TenantEfficacyRollup({ tenantId }: { tenantId: string }) {
  const { logout } = useAuth();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; data: TenantEfficacy } | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchTenantEfficacy(tenantId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      setState(out.state === "ready" ? { status: "ready", data: out.data } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [tenantId, logout]);

  const rollupClass =
    "justify-self-stretch py-3 px-3.5 rounded-lg text-caption leading-normal text-navy bg-cream-dark border border-slate-light flex items-baseline gap-3 flex-wrap";
  if (state.status === "loading") {
    return (
      <div className={rollupClass}>
        <span className="font-semibold">Company data efficacy</span>
        <span className="text-slate-base">Loading...</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={rollupClass}>
        <span className="font-semibold">Company data efficacy</span>
        <span className="text-slate-base">Efficacy unavailable right now</span>
      </div>
    );
  }

  const { rollup } = state.data;
  const capped = state.data.modeCeiling < 100;

  return (
    <div className={rollupClass}>
      <span className="font-semibold">Company data efficacy</span>
      {rollup.score === null ? (
        <span className="text-slate-base">- (no generated layer to score yet)</span>
      ) : (
        <>
          <span className="text-title font-bold">{rollup.score}</span>
          <span className="text-slate-base">/ 100</span>
          <span className="text-slate-base">
            mean across {rollup.n} generated layer{rollup.n === 1 ? "" : "s"}
          </span>
        </>
      )}
      {capped && (
        <span
          title="Outside-in mode: the connector-grounded drivers (coverage, freshness) are structurally zero, so the index cannot reach 100. Connect data to raise the ceiling."
          className="text-slate-base"
        >
          ceiling {state.data.modeCeiling} (outside-in)
        </span>
      )}
    </div>
  );
}

// Phase AK Data Efficacy Index. Confidence says how sure the reasoning is; this
// says how good the fuel was. The 0-to-100 score is a weighted average over five
// named drivers, each showing its own measurement and point contribution. A
// driver that has nothing to measure yet reads a dash, never a fabricated zero.
// In outside-in mode the connector-grounded drivers are structurally zero, so
// the strip states the lower ceiling honestly rather than implying the data is
// poor. The cheapest-improvement hint names the single best next lever.
function EfficacyNote({ index }: { index: EfficacyIndex }) {
  const capped = index.modeCeiling < 100;

  return (
    <div className="justify-self-stretch py-3 px-3.5 rounded-lg text-caption leading-normal text-navy bg-cream-dark border border-slate-light">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="font-semibold">Data efficacy</span>
        <span className="text-title font-bold">{index.score}</span>
        <span className="text-slate-base">/ 100</span>
        {capped && (
          <span
            title="Outside-in mode: the connector-grounded drivers (coverage, freshness) are structurally zero, so the index cannot reach 100. Connect data to raise the ceiling."
            className="text-slate-base"
          >
            ceiling {index.modeCeiling} ({index.dataMode === "outside_in" ? "outside-in" : "connected"})
          </span>
        )}
        {index.unknownWeight > 0 && (
          <span className="text-slate-base">
            {Math.round(index.unknownWeight * 100)}% not yet measured
          </span>
        )}
      </div>
      <div className="grid gap-1 mt-2">
        {index.drivers.map((d) => (
          <div
            key={d.key}
            className="flex gap-2 items-baseline flex-wrap"
            title={d.reason}
          >
            <span className="min-w-[150px] font-semibold">{d.label}</span>
            <span className="min-w-12">{formatRatioPct(d.value)}</span>
            <span className="text-slate-base">
              {d.status === "not_measured"
                ? "not measured"
                : "+" + d.contributionPoints + " pts (weight " + Math.round(d.weight * 100) + "%)"}
            </span>
            <span className="text-slate-base">{d.reason}</span>
          </div>
        ))}
      </div>
      {index.cheapestImprovement && (
        <div className="mt-2 text-navy">
          <span className="font-semibold">Cheapest improvement: </span>
          <span className="text-slate-base">
            {index.cheapestImprovement.hint} (about +{index.cheapestImprovement.liftPoints} pts)
          </span>
        </div>
      )}
    </div>
  );
}
