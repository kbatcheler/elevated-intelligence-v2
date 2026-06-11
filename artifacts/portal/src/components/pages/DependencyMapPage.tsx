import React, { useEffect, useMemo, useState } from "react";
import type { SignalLayer } from "../../types";
import { fetchSignals } from "../../lib/tenantApi";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../lib/TenantContext";
import { deriveDependencyGraph, layoutNodes, type DependencyGraph, type PositionedNode } from "../../lib/dependencyGraph";
import { Link } from "../../lib/router";
import { EmptyState, ErrorState, PageHeader, PageWidth, SkeletonLines, formatInt } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "ready"; signals: SignalLayer[] }
  | { kind: "empty" }
  | { kind: "no-tenant" }
  | { kind: "error" };

// A small, stable palette assigned to module groups by name, so the same group
// keeps the same colour across renders. Colours carry no analytical meaning;
// they only let the eye group nodes.
const GROUP_PALETTE = ["--navy", "--teal", "--coral", "--amber", "--blue", "--purple", "--gold"];

const SIZE = 640;
const CENTER = SIZE / 2;
const RADIUS = 248;

function groupColors(graph: DependencyGraph): Map<string, string> {
  const groups = Array.from(new Set(graph.nodes.map((n) => n.moduleGroup))).sort();
  const m = new Map<string, string>();
  groups.forEach((g, i) => m.set(g, `var(${GROUP_PALETTE[i % GROUP_PALETTE.length]})`));
  return m;
}

// The dependency map. Edges are structural truth (two layers share a module
// group or a data feed); node size is the real sum of each layer's gap
// confidence-lift points; positions are circular layout only and carry no
// meaning. Ungenerated layers remain nodes at zero weight so structure never
// dangles. No waterfall, funnel or flow geometry is ever invented.
export function DependencyMapPage() {
  const { logout } = useAuth();
  const { currentId, current, status: tenantStatus } = useTenant();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!currentId) {
      if (tenantStatus === "error") setState({ kind: "error" });
      else if (tenantStatus === "empty") setState({ kind: "no-tenant" });
      else setState({ kind: "loading" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    fetchSignals(currentId).then((out) => {
      if (!alive) return;
      if ("unauthorized" in out) return void logout();
      if (out.state === "error") return setState({ kind: "error" });
      if (out.state === "empty") return setState({ kind: "empty" });
      setState({ kind: "ready", signals: out.items });
    });
    return () => {
      alive = false;
    };
  }, [currentId, tenantStatus, logout]);

  const graph = useMemo(
    () => (state.kind === "ready" ? deriveDependencyGraph(state.signals) : null),
    [state],
  );

  return (
    <PageWidth style={{ paddingTop: 28, paddingBottom: 48 }}>
      <PageHeader
        eyebrow="Dependency map"
        title="How the layers depend on each other"
        subtitle={current ? `Structural links across ${current.name}'s layers, weighted by where intelligence gaps are largest.` : undefined}
      />
      <div style={{ marginTop: 28 }}>
        {state.kind === "loading" && <SkeletonLines lines={6} />}
        {state.kind === "error" && (
          <ErrorState message="The dependency map could not be loaded." onRetry={() => location.reload()} />
        )}
        {state.kind === "no-tenant" && (
          <EmptyState
            title="No tenant selected"
            message="No company is in your scope yet. Once one is bound to your organization, its dependency map will appear here."
          />
        )}
        {state.kind === "empty" && (
          <EmptyState title="No layers to map" message="No layers are registered for this tenant." />
        )}
        {state.kind === "ready" && graph && graph.nodes.length === 0 && (
          <EmptyState title="No layers to map" message="No layers are registered for this tenant." />
        )}
        {state.kind === "ready" && graph && graph.nodes.length > 0 && <MapView graph={graph} />}
      </div>
    </PageWidth>
  );
}

function MapView({ graph }: { graph: DependencyGraph }) {
  const colors = groupColors(graph);
  const positioned = layoutNodes(graph.nodes, { radius: RADIUS, cx: CENTER, cy: CENTER });
  const posByKey = new Map(positioned.map((p) => [p.key, p]));
  const maxWeight = Math.max(0, ...positioned.map((p) => p.weight));
  const anyGenerated = positioned.some((p) => p.generated);

  function nodeRadius(weight: number): number {
    if (maxWeight <= 0) return 14;
    return 14 + (weight / maxWeight) * 16;
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {!anyGenerated && (
        <div style={{ fontSize: 13, color: "var(--slate-light)" }}>
          No layer has been generated yet, so every node sits at zero weight. The structure below is the registry shape.
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" role="img" aria-label="Layer dependency map" style={{ display: "block", maxHeight: 560 }}>
          {graph.edges.map((e, i) => {
            const a = posByKey.get(e.source);
            const b = posByKey.get(e.target);
            if (!a || !b) return null;
            const dashed = !e.sharedModuleGroup;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={dashed ? "var(--gold)" : "var(--navy-soft)"}
                strokeWidth={1.4}
                strokeOpacity={dashed ? 0.5 : 0.35}
                strokeDasharray={dashed ? "4 4" : undefined}
              >
                <title>
                  {e.sharedModuleGroup ? "Same module group" : ""}
                  {e.sharedFeeds.length > 0 ? `${e.sharedModuleGroup ? "; " : ""}shared feed: ${e.sharedFeeds.join(", ")}` : ""}
                </title>
              </line>
            );
          })}

          {positioned.map((n) => (
            <NodeMark key={n.key} node={n} r={nodeRadius(n.weight)} color={colors.get(n.moduleGroup) ?? "var(--navy)"} />
          ))}
        </svg>
      </div>

      <Legend graph={graph} colors={colors} />
    </div>
  );
}

function NodeMark({ node, r, color }: { node: PositionedNode; r: number; color: string }) {
  // Push the label outward from the centre so it clears the node.
  const dx = node.x - CENTER;
  const dy = node.y - CENTER;
  const len = Math.hypot(dx, dy) || 1;
  const lx = node.x + (dx / len) * (r + 8);
  const ly = node.y + (dy / len) * (r + 8);
  const anchor = lx > CENTER + 12 ? "start" : lx < CENTER - 12 ? "end" : "middle";

  return (
    <g>
      <circle
        cx={node.x}
        cy={node.y}
        r={r}
        fill={node.generated ? color : "var(--cream)"}
        fillOpacity={node.generated ? 0.16 : 1}
        stroke={color}
        strokeWidth={1.6}
        strokeDasharray={node.generated ? undefined : "3 3"}
      />
      <text x={node.x} y={node.y + 4} textAnchor="middle" className="font-mono" style={{ fontSize: 11, fill: "var(--navy)" }}>
        {node.weight > 0 ? node.weight : ""}
      </text>
      <text
        x={lx}
        y={ly + 3}
        textAnchor={anchor}
        style={{ fontSize: 11, fill: node.generated ? "var(--slate)" : "var(--slate-light)", fontFamily: "var(--font-serif)" }}
      >
        {node.name}
      </text>
      <title>
        {node.name} ({node.moduleGroup}){node.generated ? `, gap lift ${node.weight} pp` : ", not generated"}
      </title>
    </g>
  );
}

function Legend({ graph, colors }: { graph: DependencyGraph; colors: Map<string, string> }) {
  const groups = Array.from(colors.entries());
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", alignItems: "center", fontSize: 12.5, color: "var(--slate)" }}>
        {groups.map(([name, color]) => (
          <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
            {name}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--navy-soft)" strokeWidth="1.4" strokeOpacity="0.5" /></svg>
          Same module group
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--gold)" strokeWidth="1.4" strokeDasharray="4 4" /></svg>
          Shared feed
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--slate-light)", lineHeight: 1.5 }}>
        Node size is the sum of each layer's gap confidence lift (a real persisted figure). Positions are layout only.
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {[...graph.nodes].sort((a, b) => b.weight - a.weight || a.sortOrder - b.sortOrder).map((n) => (
          <Link key={n.key} to={`/layers/${n.key}`} style={{ textDecoration: "none" }}>
            <div
              className="card"
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flexWrap: "wrap" }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 5, background: colors.get(n.moduleGroup) ?? "var(--navy)", flexShrink: 0 }} />
              <span className="font-serif" style={{ fontSize: 14, color: "var(--navy)", flex: "1 1 160px", minWidth: 0 }}>
                {n.name}
              </span>
              <span className="eyebrow" style={{ color: "var(--slate-light)" }}>{n.moduleGroup}</span>
              <span className="font-mono" style={{ fontSize: 12, color: n.generated ? "var(--navy)" : "var(--slate-light)" }}>
                {n.generated ? `${formatInt(n.weight)} pp` : "not generated"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
