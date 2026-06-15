import React, { useCallback, useEffect, useState } from "react";
import type {
  FindingChallenge,
  LayerRegistryEntry,
  PipelineRun,
  TenantLayerDetail,
} from "../../types";
import { fetchLayers, fetchRuns, fetchTenantLayer } from "../../lib/tenantApi";
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
import { LayerSections, type ChallengeContext } from "../layer/sections";
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
      <Hero entry={entry} detail={detail} />
      {isBenchmarkLayer && <BenchmarkConsent tenantId={detail.tenantId} />}
      <LayerSections detail={detail} feeds={entry?.feeds ?? []} challenge={challenge} />
      <ReasoningStrip
        run={run}
        confounders={detail.confounders}
        generatorModel={detail.generatorModel}
        generatedAt={detail.generatedAt}
      />
    </div>
  );
}
