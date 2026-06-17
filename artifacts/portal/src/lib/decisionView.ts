import type { Basis } from "../types";

// Pure view logic for the decision ledger surfaces (Phase AL). The decision
// control's error copy and the recommendation basis classifier are extracted so
// they are unit-testable without rendering the timeline.

const ERROR_LABEL: Record<string, string> = {
  invalid_input: "Add a short rationale and try again.",
  forbidden: "Your seat can read decisions but cannot record one.",
  action_not_found: "This action is no longer present to decide on.",
  layer_not_found: "This layer is no longer available.",
  not_an_action: "A decision can only be recorded against a recommended action.",
  failed: "The decision could not be recorded. Try again.",
};

// Human copy for a decision-record error code; an unrecognised code falls back to
// the generic failure message.
export function decisionErrorText(code: string): string {
  return ERROR_LABEL[code] ?? ERROR_LABEL.failed;
}

// Classify a recommendation basis string; anything other than "verified" is
// treated as "modelled" rather than trusted as verified.
export function basisOf(s: string): Basis {
  return s === "verified" ? "verified" : "modelled";
}
