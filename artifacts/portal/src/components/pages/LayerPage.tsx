import React, { useEffect, useState } from "react";
import type { LayerRegistryEntry, PipelineRun, TenantLayerDetail } from "../../types";
import { fetchLayers, fetchRuns, fetchTenantLayer } from "../../lib/tenantApi";
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
import { LayerSections } from "../layer/sections";
import { BenchmarkConsent } from "../layer/BenchmarkConsent";

type State =
  | { kind: "loading" }
  | { kind: "ready"; detail: TenantLayerDetail; run: PipelineRun | null; entry: LayerRegistryEntry | null }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// A single layer for the current tenant. The hero is dispatched by archetype
// (registry, with a generic fallback); everything below it is the shared frame
// in LayerSections. Every figure shown is a persisted field, never computed
// client-side.
export function LayerPage({ layerKey }: { layerKey: string }) {
  const { logout } = useAuth();
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
    Promise.all([fetchTenantLayer(currentId, layerKey), fetchRuns(currentId), fetchLayers()]).then(
      ([detailOut, runsOut, layersOut]) => {
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
        setState({ kind: "ready", detail: detailOut.data, run, entry });
      },
    );
    return () => {
      alive = false;
    };
  }, [currentId, layerKey, tenantStatus, logout]);

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
        {state.kind === "ready" && <LayerBody {...state} />}
      </div>
    </PageWidth>
  );
}

function LayerBody({
  detail,
  run,
  entry,
}: {
  detail: TenantLayerDetail;
  run: PipelineRun | null;
  entry: LayerRegistryEntry | null;
}) {
  const Hero = heroFor(entry?.archetype);
  // The benchmark-variant layer is the only surface where participation in the
  // verified cohort is meaningful, so the default-off consent control lives here,
  // directly beneath its hero. The tenant id comes from the persisted detail.
  const isBenchmarkLayer = entry?.archetype === "Performance scorecard, benchmark variant";

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
            background: "rgba(193, 122, 0, 0.10)",
            border: "1px solid rgba(193, 122, 0, 0.35)",
          }}
        >
          Express build (reduced)
        </span>
      )}
      <Hero entry={entry} detail={detail} />
      {isBenchmarkLayer && <BenchmarkConsent tenantId={detail.tenantId} />}
      <LayerSections detail={detail} feeds={entry?.feeds ?? []} />
      <ReasoningStrip
        run={run}
        confounders={detail.confounders}
        generatorModel={detail.generatorModel}
        generatedAt={detail.generatedAt}
      />
    </div>
  );
}
