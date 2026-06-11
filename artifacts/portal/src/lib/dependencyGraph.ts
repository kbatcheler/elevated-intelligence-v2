import type { SignalLayer } from "../types";

// The dependency map is structural truth plus per-tenant weight. Edges come from
// the registry: two layers are linked when they sit in the same module group or
// consume a shared feed (a real data dependency). Node weight is the sum of that
// layer's gap confidence-lift points, a real persisted figure (0 when the layer
// has no gaps or has not been generated, which is honest, not invented). Every
// registry layer stays a node even when ungenerated, so structural edges never
// dangle; the page shows the empty state when nothing has been generated yet.
// Node POSITIONS are not data: layoutNodes places them on a circle purely for
// rendering. We never invent waterfall, funnel or flow geometry.

export interface DependencyNode {
  key: string;
  name: string;
  moduleGroup: string;
  sortOrder: number;
  generated: boolean;
  weight: number;
}
export interface DependencyEdge {
  source: string;
  target: string;
  sharedModuleGroup: boolean;
  sharedFeeds: string[];
}
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

function sumLift(s: SignalLayer): number {
  return s.gaps.reduce((acc, g) => acc + (g.confidenceLiftPp ?? 0), 0);
}

export function deriveDependencyGraph(signals: readonly SignalLayer[]): DependencyGraph {
  const sorted = [...signals].sort((a, b) => a.sortOrder - b.sortOrder);

  const nodes: DependencyNode[] = sorted.map((s) => ({
    key: s.key,
    name: s.name,
    moduleGroup: s.moduleGroup,
    sortOrder: s.sortOrder,
    generated: s.generated,
    weight: s.generated ? sumLift(s) : 0,
  }));

  const edges: DependencyEdge[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const sharedModuleGroup = a.moduleGroup !== "" && a.moduleGroup === b.moduleGroup;
      const sharedFeeds = a.feeds.filter((f) => f !== "" && b.feeds.includes(f));
      if (!sharedModuleGroup && sharedFeeds.length === 0) continue;
      edges.push({ source: a.key, target: b.key, sharedModuleGroup, sharedFeeds });
    }
  }

  return { nodes, edges };
}

export interface PositionedNode extends DependencyNode {
  x: number;
  y: number;
}
export interface LayoutOptions {
  radius: number;
  cx: number;
  cy: number;
}
const DEFAULT_LAYOUT: LayoutOptions = { radius: 1, cx: 0, cy: 0 };

// Place nodes evenly on a circle in registry (sortOrder) order, first node at
// the top. Geometry is for layout only and carries no analytical meaning.
export function layoutNodes(
  nodes: readonly DependencyNode[],
  opts: LayoutOptions = DEFAULT_LAYOUT,
): PositionedNode[] {
  const n = Math.max(nodes.length, 1);
  return nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return {
      ...node,
      x: opts.cx + opts.radius * Math.cos(angle),
      y: opts.cy + opts.radius * Math.sin(angle),
    };
  });
}
