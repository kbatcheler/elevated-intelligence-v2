// The reduced express-chain decision, extracted as a pure, dependency-free
// function so the contract is unit-testable without the orchestrator's database
// imports.
//
// In express mode only the high-signal priority layers run the full nine-stage
// adversarial chain (perceive through supplements); every other layer runs a
// reduced chain with the confound and challenge sub-stages skipped. Full mode
// runs the complete chain on every layer.
//
// Sovereign mode (Phase AF) runs the WHOLE pipeline in-boundary on the local
// seat: every stage, including the two adversarial ones, always runs. So a
// sovereign run is NEVER reduced regardless of the seed mode, and a sovereign
// layer is always a full build. This is the single place that decision lives.

import type { CortexDataMode } from "@workspace/cortex";

// The keys match the registry's stable layer keys; a fixed product policy, not
// data.
export const PRIORITY_LAYER_KEYS: ReadonlySet<string> = new Set<string>([
  "business-performance",
  "finance",
  "pricing-margin",
  "demand-intelligence",
  "competitive-intelligence",
]);

export function isReducedLayer(
  mode: "full" | "express",
  layerKey: string,
  dataMode: CortexDataMode,
): boolean {
  if (dataMode === "sovereign") return false;
  return mode === "express" && !PRIORITY_LAYER_KEYS.has(layerKey);
}
