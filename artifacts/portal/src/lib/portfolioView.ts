import type { GapSeverity } from "../types";

// Pure view logic for the Portfolio Intelligence board (Phase Y). The
// gap-severity accent mapping and the missing-signal label are extracted so they
// are unit-testable without rendering the board.

// The gap-severity to accent-color mapping for the board's missing-signal pills.
export const SEVERITY_COLOR: Record<GapSeverity, "coral" | "amber" | "gray"> = {
  high: "coral",
  medium: "amber",
  low: "gray",
};

// A human label for a missing-signal key. Unknown keys pass through unchanged
// rather than being dropped or relabelled.
export function labelMissing(key: string): string {
  if (key === "layer_content") return "diagnosis";
  if (key === "outcomes") return "outcomes";
  return key;
}
