// The CORTEX configuration. This is the SINGLE place in the engine where model
// identifier strings live. Every stage resolves its model through this module;
// no other file under src/ may contain a literal model string. An invariant
// test (config.test.ts) enforces that rule by scanning the source tree.
//
// Three physical model seats back six product roles:
//   - reasoner  (Claude Sonnet): the Lens (perceive, hypothesise) and the
//                Synthesist (narrate).
//   - evaluator (Claude Haiku):  the Evaluator (score) and Enrichment (hero,
//                peers, supplements).
//   - grounder  (Gemini, grounded): the Confounder (confound) and the
//                Challenger (challenge).

export type Provider = "anthropic" | "gemini";
export type SeatKey = "reasoner" | "evaluator" | "grounder";

export interface SeatConfig {
  provider: Provider;
  model: string;
}

// The three model seats. Model strings appear ONLY in this object.
export const SEATS: Record<SeatKey, SeatConfig> = {
  reasoner: { provider: "anthropic", model: "claude-sonnet-4-6" },
  evaluator: { provider: "anthropic", model: "claude-haiku-4-5" },
  grounder: { provider: "gemini", model: "gemini-2.5-pro" },
};

// The nine per-layer sub-stages plus the tenant-scope profile stage. The order
// of the nine is fixed by the Day One Non-Negotiable: confound is a genuine
// stage of its own, placed before challenge.
export type StageName =
  | "profile"
  | "perceive"
  | "hypothesise"
  | "confound"
  | "challenge"
  | "narrate"
  | "score"
  | "hero"
  | "peers"
  | "supplements";

export interface StageConfig {
  seat: SeatKey;
  // The product role label surfaced on telemetry and the Intelligence
  // Architecture page. Several stages share a seat but carry distinct roles.
  role: string;
  // Anthropic server-side web_search tool (perceive only).
  webSearch?: boolean;
  // Gemini Google Search grounding (confound, challenge). When grounded, the
  // Gemini call MUST NOT request a JSON response mime type; JSON is enforced by
  // prompt discipline instead.
  grounding?: boolean;
}

export const STAGE_CONFIG: Record<StageName, StageConfig> = {
  profile: { seat: "reasoner", role: "Lens" },
  perceive: { seat: "reasoner", role: "Lens", webSearch: true },
  hypothesise: { seat: "reasoner", role: "Lens" },
  confound: { seat: "grounder", role: "Confounder", grounding: true },
  challenge: { seat: "grounder", role: "Challenger", grounding: true },
  narrate: { seat: "reasoner", role: "Synthesist" },
  score: { seat: "evaluator", role: "Evaluator" },
  hero: { seat: "evaluator", role: "Enrichment" },
  peers: { seat: "evaluator", role: "Enrichment" },
  supplements: { seat: "evaluator", role: "Enrichment" },
};

// The ordered nine sub-stages a layer run executes.
export const LAYER_STAGES: StageName[] = [
  "perceive",
  "hypothesise",
  "confound",
  "challenge",
  "narrate",
  "score",
  "hero",
  "peers",
  "supplements",
];

export function seatForStage(stage: StageName): SeatConfig {
  return SEATS[STAGE_CONFIG[stage].seat];
}

export function modelForStage(stage: StageName): string {
  return SEATS[STAGE_CONFIG[stage].seat].model;
}

// Provenance channels a verified claim can cite. These are channel names, not
// model identifiers, so the content schema never hardcodes a model string.
export const VERIFICATION_CHANNELS = ["grounded-challenge", "web-search"] as const;
export type VerificationChannel = (typeof VERIFICATION_CHANNELS)[number];
