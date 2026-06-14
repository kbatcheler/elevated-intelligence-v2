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

// "local" is the in-boundary extraction seat added in Tier 2 (the split
// pipeline). Unlike the three external seats its model is not a fixed identifier
// baked into source: it is a self-hosted or open model supplied at runtime from
// env, so the no-literal-model-string invariant still holds (resolveLocalSeat
// reads it from the environment, never a literal here).
export type Provider = "anthropic" | "gemini" | "local";
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

// The two grounding regimes a run can use. outside_in is the public-web demo
// (the regression contract); connected grounds on the tenant's own derived
// signals. This is the switch that decides whether the sensitive Lens stages run
// in-boundary on the local seat (Tier 2, the split pipeline).
export type CortexDataMode = "outside_in" | "connected";

// The sensitive extraction stages. In connected mode these run in-boundary on
// the local seat so the client's own signals are interpreted inside the
// deployment boundary; the external Synthesist and adversarial seats only ever
// see the already de-identified output. In outside_in mode they run externally
// exactly as before, because public data is not sensitive.
export const IN_BOUNDARY_STAGES: readonly StageName[] = ["perceive", "hypothesise"];

export function runsInBoundary(stage: StageName, dataMode: CortexDataMode): boolean {
  return dataMode === "connected" && IN_BOUNDARY_STAGES.includes(stage);
}

// The in-boundary extraction seat, resolved from the environment. Its model
// identifier is supplied at runtime (a self-hosted or open model), never a
// literal in source, so the config invariant that bans repeated model strings is
// preserved. Returns null when no in-boundary model is configured: connected
// mode then fails loudly ("available, not connected") rather than silently
// sending the sensitive stages to an external provider.
export interface LocalSeatConfig {
  provider: "local";
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export function resolveLocalSeat(env: NodeJS.ProcessEnv = process.env): LocalSeatConfig | null {
  const baseUrl = env["LOCAL_MODEL_BASE_URL"];
  const model = env["LOCAL_MODEL_MODEL"];
  if (!baseUrl || !model) return null;
  const apiKey = env["LOCAL_MODEL_API_KEY"];
  return { provider: "local", model, baseUrl, ...(apiKey ? { apiKey } : {}) };
}

// Provenance channels a verified claim can cite. These are channel names, not
// model identifiers, so the content schema never hardcodes a model string.
export const VERIFICATION_CHANNELS = ["grounded-challenge", "web-search"] as const;
export type VerificationChannel = (typeof VERIFICATION_CHANNELS)[number];
