import React, { useEffect, useState } from "react";
import type { LayerRegistryEntry } from "../../types";
import { fetchLayers } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines, Tag } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; feeds: FeedRow[] }
  | { kind: "empty" }
  | { kind: "error" };

interface FeedRow {
  feed: string;
  layers: string[];
}

// The connections surface. E5 builds the live heartbeat from feed registry and
// run activity. E2 shows the real feeds each layer declares in the registry,
// aggregated so a reader sees which signals the intelligence draws on.
export function ConnectionsPage() {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchLayers().then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error") return setState({ kind: "error" });
      if (out.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", feeds: aggregateFeeds(out.items) });
    });
    return () => {
      alive = false;
    };
  }, [logout]);

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Connections"
        title="Signal feeds"
        subtitle="The external and internal feeds each intelligence layer draws on."
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="Feeds could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No feeds declared" message="No layer declares a feed in the registry." />
        )}
        {state.kind === "ready" && (
          <div style={{ display: "grid", gap: 12 }}>
            {state.feeds.map((f) => (
              <div key={f.feed} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Tag kind="signal">{f.feed}</Tag>
                </div>
                <div style={{ fontSize: 12, color: "var(--slate-light)" }}>
                  {f.layers.length} {f.layers.length === 1 ? "layer" : "layers"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageWidth>
  );
}

// Distinct feeds across the registry, each with the layers that declare it,
// ordered by how many layers depend on the feed.
function aggregateFeeds(layers: LayerRegistryEntry[]): FeedRow[] {
  const map = new Map<string, string[]>();
  for (const l of layers) {
    for (const feed of l.feeds ?? []) {
      if (!map.has(feed)) map.set(feed, []);
      map.get(feed)!.push(l.key);
    }
  }
  return [...map.entries()]
    .map(([feed, ls]) => ({ feed, layers: ls }))
    .sort((a, b) => b.layers.length - a.layers.length || a.feed.localeCompare(b.feed));
}
