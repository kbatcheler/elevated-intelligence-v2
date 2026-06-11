import type { LayerRegistryEntry, TenantLayerDetail } from "../../types";

// The single prop shape every archetype hero receives. A hero is a layout and
// emphasis morph over the real persisted fields on `detail` (heroPanel,
// content.metrics, peerBenchmark). It never computes derived figures and never
// invents chart geometry: with no heroPanel or a flat trend it degrades to a
// metric-only layout. `entry` is the registry identity (name, archetype, feeds)
// and may be null if the registry could not be loaded.
export interface ArchetypeHeroProps {
  entry: LayerRegistryEntry | null;
  detail: TenantLayerDetail;
}

// Tone to CSS variable name, shared by every hero so the numeric color is
// consistent across archetypes.
export function heroToneVar(tone: string): string {
  if (tone === "good") return "teal";
  if (tone === "warn") return "amber";
  if (tone === "bad") return "coral";
  return "navy";
}
