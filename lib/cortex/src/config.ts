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

// The grounding regimes a run can use. outside_in is the public-web demo (the
// regression contract); connected grounds on the tenant's own derived signals
// and routes the two sensitive Lens stages in-boundary on the local seat (Tier 2,
// the split pipeline); sovereign (Phase AF) runs EVERY stage in-boundary on the
// local seat with no external provider and no public-web grounding at all, for a
// deployment that must never reach an external model.
export type CortexDataMode = "outside_in" | "connected" | "sovereign";

// The sensitive extraction stages. In connected mode these run in-boundary on
// the local seat so the client's own signals are interpreted inside the
// deployment boundary; the external Synthesist and adversarial seats only ever
// see the already de-identified output. In outside_in mode they run externally
// exactly as before, because public data is not sensitive.
export const IN_BOUNDARY_STAGES: readonly StageName[] = ["perceive", "hypothesise"];

export function runsInBoundary(stage: StageName, dataMode: CortexDataMode): boolean {
  return dataMode === "connected" && IN_BOUNDARY_STAGES.includes(stage);
}

// Whether a stage executes on the in-boundary local seat for this data mode. This
// is the single routing predicate every runner consults. Sovereign mode runs
// EVERY stage on the local seat, so no external provider is ever consulted;
// connected mode runs only the two sensitive Lens stages in-boundary (delegating
// to runsInBoundary); outside_in runs nothing local. Because runsOnLocal reduces
// to runsInBoundary for the non-sovereign modes, connected and outside_in routing
// is unchanged byte-for-byte.
export function runsOnLocal(stage: StageName, dataMode: CortexDataMode): boolean {
  if (dataMode === "sovereign") return true;
  return runsInBoundary(stage, dataMode);
}

// Whether external grounding/verification channels are available in this mode.
// Sovereign mode has neither Anthropic web search nor Gemini grounded challenge,
// so no claim can be honestly marked verified and the Lens/adversarial stages run
// ungrounded; outside_in and connected both keep the external grounding seats. The
// orchestrator reads this to downgrade sovereign verified claims to modelled, and
// the local runner reads it to mark telemetry honestly.
export function groundingAvailable(dataMode: CortexDataMode): boolean {
  return dataMode !== "sovereign";
}

// The single switch that selects the run's grounding regime from the environment,
// read once at the seed boundary and threaded as a StageContext so no stage ever
// reads the environment itself. CORTEX_DATA_MODE=sovereign runs the whole pipeline
// in-boundary with no external provider; =connected is the Tier 2 split; anything
// else (including unset) is outside_in, the public-web regression default.
export function resolveCortexDataMode(env: NodeJS.ProcessEnv = process.env): CortexDataMode {
  const raw = env["CORTEX_DATA_MODE"];
  if (raw === "sovereign") return "sovereign";
  if (raw === "connected") return "connected";
  return "outside_in";
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
