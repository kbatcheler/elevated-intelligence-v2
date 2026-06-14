// Shared prompt scaffolding. The per-layer focus is composed at runtime from
// the registry descriptor (name, description, diagnosticQuestion); there is no
// LAYER_KEYS or LAYER_FOCUS constant anywhere. The orchestrator reads the
// registry and passes a plain descriptor in, so this pure package never imports
// the database.

import type { ProfileOutput } from "../schemas/profile";

// The layer registry row, narrowed to what prompts need.
export interface LayerDescriptor {
  key: string;
  name: string;
  description: string;
  diagnosticQuestion: string;
}

// A single derived signal as the cortex sees it: de-identified math only (a
// score, ratio, count, aggregate, trend delta, or a non-reversible embedding),
// never a raw client record. Mirrors the persisted derived_signals row narrowed
// to what a prompt needs. This is the empirical anchor connected mode grounds on
// in place of the public homepage snippet.
export interface DerivedSignalView {
  signalKey: string;
  value: number | number[];
  window?: string;
  unit?: string;
  sourceConnectorKey?: string;
  computedAt?: string;
}

// The connected-mode grounding for one layer: the derived signals that anchor
// this layer's reasoning. Carries only math, never raw client content.
export interface LayerGrounding {
  layerKey: string;
  signals: DerivedSignalView[];
}

// Hygiene rules appended to every stage system prompt. Two hard rules:
// invent no precise figures, and use no long dash.
export const STAGE_RULES = [
  "OUTPUT RULES:",
  "1. Return ONE JSON object and nothing else. No prose before or after, no code fence.",
  "2. Never invent precise figures (revenue, headcount, percentages, dates). State a",
  "   number only when a web source supports it and you cite that source; otherwise",
  "   speak qualitatively or label the value as a modelled estimate.",
  "3. Do not use the long dash character. Use a comma, a colon, or a period instead.",
  "4. Be specific to THIS company. Generic, swappable observations are failures.",
  "5. Distinguish what is grounded (supported by a source) from what is inferred",
  "   (reasoned from context). Mark each claim accordingly where the schema asks.",
].join("\n");

// Compact company identity block injected into every layer prompt so each stage
// is anchored to the real tenant rather than a generic archetype.
export function companyContext(profile: ProfileOutput): string {
  const lines: string[] = [];
  lines.push(`COMPANY: ${profile.name}`);
  lines.push(`WEBSITE: ${profile.url}`);
  if (profile.sector) lines.push(`SECTOR: ${profile.sector}`);
  const loc = [profile.hqCity, profile.hqState].filter(Boolean).join(", ");
  if (loc) lines.push(`HEADQUARTERS: ${loc}`);
  if (profile.revenueBand) lines.push(`REVENUE BAND: ${profile.revenueBand}`);
  if (profile.ownership) lines.push(`OWNERSHIP: ${profile.ownership}`);
  if (profile.founded) lines.push(`FOUNDED: ${profile.founded}`);
  if (profile.tagline) lines.push(`TAGLINE: ${profile.tagline}`);
  if (profile.executiveRead) lines.push(`EXECUTIVE READ: ${profile.executiveRead}`);
  const vocab = profile.vocab ? Object.entries(profile.vocab) : [];
  if (vocab.length) {
    lines.push("KNOWN ENTITIES (use these real names, do not invent rivals):");
    for (const [k, v] of vocab.slice(0, 16)) lines.push(`  - ${k}: ${v}`);
  }
  return lines.join("\n");
}

// The layer focus block, composed from the registry descriptor. This replaces
// the hardcoded LAYER_FOCUS map from V1.
export function layerHeader(layer: LayerDescriptor): string {
  return [
    `LAYER: ${layer.name}`,
    `WHAT THIS LAYER EXAMINES: ${layer.description}`,
    `DIAGNOSTIC QUESTION THIS LAYER MUST ANSWER: ${layer.diagnosticQuestion}`,
  ].join("\n");
}

// Render a JSON-ish block of prior stage output for inclusion in a later
// stage's user prompt. Bounded so a verbose upstream stage cannot blow the
// context budget.
export function priorStage(label: string, value: unknown, max = 6000): string {
  const text = JSON.stringify(value, null, 2);
  const clipped = text.length > max ? `${text.slice(0, max)}\n... (truncated)` : text;
  return `${label}:\n${clipped}`;
}

// Render the connected-mode derived-signal grounding for a layer's user prompt.
// In connected mode the diagnosis is anchored on the client's own derived
// metrics (de-identified aggregates and scores), never on raw records. Scalars
// render in full; embeddings render by dimension only, never dumped, both to
// bound the context and because a raw vector adds nothing the reasoning can use.
// Returns an empty string when there is no grounding, so the outside_in prompts
// stay byte-for-byte unchanged.
export function derivedSignalsBlock(grounding: LayerGrounding | undefined): string {
  if (!grounding || grounding.signals.length === 0) return "";
  const lines: string[] = [
    "GROUNDING SIGNALS (the client's own derived metrics for this layer: de-identified",
    "aggregates and scores, never raw records). Treat these as the primary evidence for",
    "this layer in place of public web signal:",
  ];
  for (const s of grounding.signals) {
    const head = Array.isArray(s.value) ? `${s.signalKey} = vector[${s.value.length}]` : `${s.signalKey} = ${s.value}`;
    const value = s.unit ? `${head} ${s.unit}` : head;
    const meta: string[] = [];
    if (s.window) meta.push(`window ${s.window}`);
    if (s.sourceConnectorKey) meta.push(`source ${s.sourceConnectorKey}`);
    if (s.computedAt) meta.push(`computed ${s.computedAt}`);
    lines.push(`  - ${value}${meta.length ? ` (${meta.join(", ")})` : ""}`);
  }
  return lines.join("\n");
}

// The grounding lines a per-layer builder splices into its user message. Empty
// in outside_in mode (no grounding), so those prompts are unchanged; in
// connected mode it is a blank separator line followed by the signal block.
export function groundingSection(grounding: LayerGrounding | undefined): string[] {
  const block = derivedSignalsBlock(grounding);
  return block ? ["", block] : [];
}

// An explicit output skeleton appended to a stage's user prompt. Models match
// field names reliably when shown the exact shape; prose alone drifts and forces
// validation retries (or hard failures the self-correction cannot recover). The
// skeleton is illustrative: enums are shown as a|b|c and values are placeholders.
export function jsonShape(skeleton: string): string {
  return [
    "Return EXACTLY this JSON object, using these exact field names and nothing else.",
    "Replace every placeholder with real content. Values shown as a|b|c are enums: pick one.",
    "Repeat array items as needed. Omit an optional field only when you cannot fill it, and",
    "never add keys that are not shown here.",
    "",
    skeleton.trim(),
  ].join("\n");
}
