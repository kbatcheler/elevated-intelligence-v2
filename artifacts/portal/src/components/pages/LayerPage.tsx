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
    <PageWidth style={{ paddingTop: 24, paddingBottom: 48 }}>
      <Breadcrumbs items={crumbs} />

      <div style={{ marginTop: 18 }}>
        {state.kind === "loading" && (
          <div style={{ display: "grid", gap: 20 }}>
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
    <div style={{ display: "grid", gap: 24 }}>
      {detail.reducedMode && (
        <span
          title="Built with the express chain: the confound and challenge adversarial sub-stages were skipped for this layer. A full refresh rebuilds it with the complete chain."
          style={{
            justifySelf: "start",
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--navy)",
            background: "var(--amber-faint)",
            border: "1px solid var(--amber)",
          }}
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
  const tone = !established ? "var(--slate-light)" : applied ? "var(--amber)" : "var(--teal)";
  const background = !established
    ? "var(--cream-dark)"
    : applied
      ? "var(--amber-faint)"
      : "var(--cream-dark)";

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
      style={{
        justifySelf: "stretch",
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--navy)",
        background,
        border: "1px solid " + tone,
      }}
    >
      <span style={{ fontWeight: 600 }}>Confidence calibration</span>
      <span style={{ marginLeft: 8, color: "var(--slate)" }}>{body}</span>
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

  const rollupStyle = {
    justifySelf: "stretch" as const,
    padding: "12px 14px",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--navy)",
    background: "var(--cream-dark)",
    border: "1px solid var(--slate-light)",
    display: "flex",
    alignItems: "baseline" as const,
    gap: 12,
    flexWrap: "wrap" as const,
  };
  if (state.status === "loading") {
    return (
      <div style={rollupStyle}>
        <span style={{ fontWeight: 600 }}>Company data efficacy</span>
        <span style={{ color: "var(--slate)" }}>Loading...</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={rollupStyle}>
        <span style={{ fontWeight: 600 }}>Company data efficacy</span>
        <span style={{ color: "var(--slate)" }}>Efficacy unavailable right now</span>
      </div>
    );
  }

  const { rollup } = state.data;
  const capped = state.data.modeCeiling < 100;

  return (
    <div style={rollupStyle}>
      <span style={{ fontWeight: 600 }}>Company data efficacy</span>
      {rollup.score === null ? (
        <span style={{ color: "var(--slate)" }}>- (no generated layer to score yet)</span>
      ) : (
        <>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{rollup.score}</span>
          <span style={{ color: "var(--slate)" }}>/ 100</span>
          <span style={{ color: "var(--slate)" }}>
            mean across {rollup.n} generated layer{rollup.n === 1 ? "" : "s"}
          </span>
        </>
      )}
      {capped && (
        <span
          title="Outside-in mode: the connector-grounded drivers (coverage, freshness) are structurally zero, so the index cannot reach 100. Connect data to raise the ceiling."
          style={{ color: "var(--slate)" }}
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
  const pct = (v: number | null) => (v === null ? "-" : Math.round(v * 100) + "%");
  const capped = index.modeCeiling < 100;

  return (
    <div
      style={{
        justifySelf: "stretch",
        padding: "12px 14px",
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--navy)",
        background: "var(--cream-dark)",
        border: "1px solid var(--slate-light)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>Data efficacy</span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{index.score}</span>
        <span style={{ color: "var(--slate)" }}>/ 100</span>
        {capped && (
          <span
            title="Outside-in mode: the connector-grounded drivers (coverage, freshness) are structurally zero, so the index cannot reach 100. Connect data to raise the ceiling."
            style={{ color: "var(--slate)" }}
          >
            ceiling {index.modeCeiling} ({index.dataMode === "outside_in" ? "outside-in" : "connected"})
          </span>
        )}
        {index.unknownWeight > 0 && (
          <span style={{ color: "var(--slate)" }}>
            {Math.round(index.unknownWeight * 100)}% not yet measured
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
        {index.drivers.map((d) => (
          <div
            key={d.key}
            style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}
            title={d.reason}
          >
            <span style={{ minWidth: 150, fontWeight: 600 }}>{d.label}</span>
            <span style={{ minWidth: 48 }}>{pct(d.value)}</span>
            <span style={{ color: "var(--slate)" }}>
              {d.status === "not_measured"
                ? "not measured"
                : "+" + d.contributionPoints + " pts (weight " + Math.round(d.weight * 100) + "%)"}
            </span>
            <span style={{ color: "var(--slate)" }}>{d.reason}</span>
          </div>
        ))}
      </div>
      {index.cheapestImprovement && (
        <div style={{ marginTop: 8, color: "var(--navy)" }}>
          <span style={{ fontWeight: 600 }}>Cheapest improvement: </span>
          <span style={{ color: "var(--slate)" }}>
            {index.cheapestImprovement.hint} (about +{index.cheapestImprovement.liftPoints} pts)
          </span>
        </div>
      )}
    </div>
  );
}
