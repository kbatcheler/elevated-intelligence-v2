import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { LayerRegistryEntry } from "../../types";
import { fetchLayers } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { Link } from "../../lib/router";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines, Tag } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; layers: LayerRegistryEntry[] }
  | { kind: "empty" }
  | { kind: "error" };

// The registry index: all fourteen layers, grouped by module group in their
// registry order. Each card states the diagnostic question the layer answers,
// so a reader chooses where to look in one click and diagnoses in the next.
export function LayersPage() {
  const { logout } = useAuth();
  const { current } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchLayers().then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error") return setState({ kind: "error" });
      if (out.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", layers: out.items });
    });
    return () => {
      alive = false;
    };
  }, [logout]);

  const groups = state.kind === "ready" ? groupLayers(state.layers) : [];

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Intelligence layers"
        title="Fourteen layers"
        subtitle={current ? `Each layer diagnoses one dimension of ${current.name}.` : "Each layer diagnoses one dimension of the business."}
      />

      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The layer registry could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No layers registered" message="The intelligence registry is empty." />
        )}
        {state.kind === "ready" &&
          groups.map((g) => (
            <section key={g.group} style={{ marginBottom: 36 }}>
              <div className="eyebrow" style={{ color: "var(--slate-light)", marginBottom: 14 }}>
                {g.group}
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                }}
              >
                {g.layers.map((l) => (
                  <Link key={l.key} to={`/layers/${l.key}`} style={{ textDecoration: "none" }}>
                    <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span className="font-serif" style={{ fontSize: 18, color: "var(--navy)" }}>
                          {l.name}
                        </span>
                        <ArrowRight size={16} color="var(--gold)" style={{ flexShrink: 0 }} />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--slate)", lineHeight: 1.5, flex: 1 }}>
                        {l.diagnosticQuestion}
                      </div>
                      <div>
                        <Tag kind="model">{l.archetype}</Tag>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
      </div>
    </PageWidth>
  );
}

interface Group {
  group: string;
  order: number;
  layers: LayerRegistryEntry[];
}

// Group by moduleGroup, preserving registry sortOrder within each group and
// ordering groups by their earliest layer.
function groupLayers(layers: LayerRegistryEntry[]): Group[] {
  const sorted = [...layers].sort((a, b) => a.sortOrder - b.sortOrder);
  const map = new Map<string, Group>();
  for (const l of sorted) {
    const key = l.moduleGroup || "Other";
    if (!map.has(key)) map.set(key, { group: key, order: l.sortOrder, layers: [] });
    map.get(key)!.layers.push(l);
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}
