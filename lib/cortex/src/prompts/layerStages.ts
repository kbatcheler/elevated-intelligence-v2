// Prompt builders for the nine per-layer sub-stages. Each returns a system
// string and a user string. The layer focus is composed from the registry
// descriptor; prior stage outputs are threaded in as bounded JSON blocks. Every
// user prompt ends with an explicit JSON skeleton (jsonShape): the structured
// stages drift on field names when given prose alone, which forces validation
// retries or hard failures the self-correcting retry cannot recover.

import type { ProfileOutput } from "../schemas/profile";
import type {
  ChallengeOutput,
  ConfounderOutput,
  HypothesisedLayer,
  NarrateOutput,
  PerceiveOutput,
} from "../schemas/stages";
import {
  companyContext,
  jsonShape,
  layerHeader,
  priorStage,
  STAGE_RULES,
  type LayerDescriptor,
} from "./shared";

export interface PromptPair {
  system: string;
  user: string;
}

function sys(role: string, body: string[]): string {
  return [`You are the ${role} of an executive intelligence engine.`, "", ...body, "", STAGE_RULES].join("\n");
}

// ── perceive ──────────────────────────────────────────────────────────────
const PERCEIVE_SHAPE = `
{
  "signals": [
    {
      "observation": "concrete, company-specific observation",
      "relevance": "why it matters for this layer",
      "evidence_type": "grounded|inferred",
      "source_urls": ["https://..."]
    }
  ],
  "named_entities": ["Real Entity Name"],
  "sector_context": "short paragraph on the company's market context"
}`;

export function buildPerceive(profile: ProfileOutput, layer: LayerDescriptor): PromptPair {
  return {
    system: sys("Lens", [
      "Use web search to gather REAL, recent, company-specific signals relevant to the",
      "layer's diagnostic question. Each signal must be a concrete observation about",
      "this exact company or its named market, not a generic industry truism.",
      "Mark a signal grounded only when you cite the source URL you read it from;",
      "otherwise mark it inferred. named_entities is a flat list of real entity name",
      "strings (competitors, channels, products), never objects.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      "Search the web first, then answer.",
      "",
      jsonShape(PERCEIVE_SHAPE),
    ].join("\n"),
  };
}

// ── hypothesise ─────────────────────────────────────────────────────────────
const HYPOTHESISE_SHAPE = `
{
  "headline_finding": "one-sentence finding for this layer",
  "headline_impact": "the business impact of that finding",
  "candidate_causes": [
    {
      "statement": "a candidate root cause",
      "evidence_type": "grounded|inferred",
      "source_urls": ["https://..."],
      "confidence": 0
    }
  ],
  "candidate_actions": [
    {
      "statement": "a candidate action",
      "evidence_type": "grounded|inferred",
      "source_urls": ["https://..."],
      "confidence": 0
    }
  ],
  "hypotheses": [
    {
      "statement": "an explicit hypothesis",
      "supporting_signals": "what supports it",
      "alternative_explanation": "a plausible alternative",
      "evidence_type": "grounded|inferred",
      "source_urls": ["https://..."]
    }
  ],
  "open_questions": ["a question the next stages must resolve"]
}`;

export function buildHypothesise(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  perceive: PerceiveOutput,
): PromptPair {
  return {
    system: sys("Lens", [
      "Form a candidate diagnosis for this layer from the signals. Produce a headline",
      "finding and its business impact, the candidate root causes, the candidate",
      "actions, and explicit hypotheses. For EVERY hypothesis give both the supporting",
      "signals and a plausible alternative explanation: you are setting up the work the",
      "Confounder and Challenger will stress-test next, so surface the weak points",
      "honestly. Mark each claim grounded or inferred.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      priorStage("SIGNALS FROM PERCEIVE", perceive),
      "",
      jsonShape(HYPOTHESISE_SHAPE),
    ].join("\n"),
  };
}

// ── confound (grounded) ─────────────────────────────────────────────────────
const CONFOUND_SHAPE = `
{
  "confounders": [
    {
      "rank": 1,
      "name": "the confounding variable",
      "mechanism": "the causal mechanism by which it could produce the finding",
      "directional_impact": "which way it pushes the headline metric if real",
      "verdict": "ruled_out|partial|unresolved",
      "reason": "grounded reasoning behind the verdict",
      "source_urls": ["https://..."]
    }
  ],
  "residual_confidence_note": "what remains uncertain after this analysis"
}`;

export function buildConfound(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
): PromptPair {
  return {
    system: sys("Confounder", [
      "Your sole job is to find what ELSE could explain the headline finding. A",
      "confounder is a variable that could produce the same observed result without",
      "the proposed root cause being true: a market-wide trend, a seasonal effect, an",
      "accounting artefact, a one-off event, a measurement bias, a peer-group shift.",
      "",
      "For each confounder: name it, explain the causal mechanism by which it could",
      "produce the finding, and state its directional impact on the headline metric.",
      "Then USE GOOGLE SEARCH to test it against real evidence and assign a verdict:",
      "  ruled_out  - evidence shows this is not driving the finding here,",
      "  partial    - it explains some but not all of the finding,",
      "  unresolved - the evidence is insufficient to rule it in or out.",
      "Give grounded reasoning and cite the source URLs you consulted. Rank by how",
      "much each threatens the proposed diagnosis (rank 1 is the biggest threat).",
      "Never declare a confounder ruled_out without evidence.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      priorStage("CANDIDATE DIAGNOSIS TO STRESS-TEST", hypothesised),
      "",
      "Search the web first, then answer.",
      "",
      jsonShape(CONFOUND_SHAPE),
    ].join("\n"),
  };
}

// ── challenge (grounded) ────────────────────────────────────────────────────
const CHALLENGE_SHAPE = `
{
  "findings": [
    {
      "claim_path": "causes[0]",
      "claim_text": "the claim being checked",
      "status": "supported|refuted|uncertain",
      "reason": "grounded reason for the status",
      "source_urls": ["https://..."]
    }
  ],
  "alternative_hypotheses": ["a sharper alternative the evidence points to"],
  "overall_assessment": "overall read on the diagnosis after fact-checking"
}`;

export function buildChallenge(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
): PromptPair {
  return {
    system: sys("Challenger", [
      "Adversarially fact-check the candidate diagnosis against real evidence. For",
      "each material claim, USE GOOGLE SEARCH and mark it supported, refuted, or",
      "uncertain, with a grounded reason and source URLs. Take the Confounder's",
      "unresolved and partial verdicts seriously: a claim that rests on a cause an",
      "unresolved confounder could explain is at best uncertain. Propose sharper",
      "alternative hypotheses where the evidence points elsewhere.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      priorStage("CANDIDATE DIAGNOSIS", hypothesised),
      "",
      priorStage("CONFOUNDER FINDINGS", confounders),
      "",
      "Search the web first, then answer.",
      "",
      jsonShape(CHALLENGE_SHAPE),
    ].join("\n"),
  };
}

// ── narrate ─────────────────────────────────────────────────────────────────
const NARRATE_SHAPE = `
{
  "content": {
    "narrative": "the executive narrative paragraph for this layer",
    "headline_finding": "the finding",
    "headline_impact": "the business impact",
    "headline_lever": "the single highest-leverage action",
    "causes": [
      { "title": "cause title", "impact": "its impact", "detail": "the explanation" }
    ],
    "actions": [
      {
        "title": "action title",
        "detail": "what to do",
        "impact": "the expected impact",
        "timing": "when to act",
        "owner": "who owns it"
      }
    ],
    "hypotheses": [
      {
        "statement": "a surviving hypothesis",
        "supportingSignals": "what supports it",
        "alternativeExplanation": "the alternative still open"
      }
    ],
    "proof": {
      "items": [ { "source": "source name or url", "observation": "what it shows" } ]
    },
    "metrics": [
      {
        "label": "metric label",
        "value": "qualitative or modelled value",
        "sub": "optional sub-line",
        "tone": "good|warn|bad|neutral"
      }
    ]
  },
  "verified_claims": [
    {
      "claim_text": "a statement a web source supports",
      "claim_path": "causes[0]",
      "source_urls": ["https://..."],
      "source_titles": ["source title"],
      "verified_by": "grounded-challenge|web-search",
      "reconciled": false
    }
  ],
  "modelled_claims": [
    {
      "claim_text": "a reasoned estimate with no direct source",
      "claim_path": "actions[0]",
      "rationale": "the reasoning behind it",
      "consistency": "consistent|tension|unknown",
      "source_urls": []
    }
  ]
}`;

export function buildNarrate(
  profile: ProfileOutput,
  layer: LayerDescriptor,
  hypothesised: HypothesisedLayer,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
): PromptPair {
  return {
    system: sys("Synthesist", [
      "Write the final executive read for this layer. Fold in the Confounder and",
      "Challenger work honestly: drop or downgrade refuted claims, hedge anything an",
      "unresolved confounder could explain, and let the surviving diagnosis carry the",
      "narrative. Produce a narrative paragraph, a headline finding, its impact, the",
      "single highest-leverage action, the causes, the actions, the hypotheses, proof",
      "receipts, and the metrics that frame the layer.",
      "",
      "Then split your claims into two lists. verified_claims are statements a web",
      "source supports: give the claim path, the source URLs, and set verified_by to",
      "the channel that established it (grounded-challenge for a fact-checked claim,",
      "web-search for one you read directly). modelled_claims are reasoned estimates",
      "with no direct source: give the claim path and a short rationale. Do NOT assign",
      "numeric confidence here; the Evaluator does that next.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      priorStage("CANDIDATE DIAGNOSIS", hypothesised),
      "",
      priorStage("CONFOUNDER FINDINGS", confounders),
      "",
      priorStage("CHALLENGER FINDINGS", challenge),
      "",
      jsonShape(NARRATE_SHAPE),
    ].join("\n"),
  };
}

// ── score ───────────────────────────────────────────────────────────────────
const SCORE_SHAPE = `
{
  "confidence": 0,
  "confidence_gap": 0,
  "gaps": [
    {
      "kind": "DATA|SIGNAL|INTEG|MODEL|FLOW",
      "description": "what is missing",
      "closes": "what closing it would establish",
      "confidence_lift_pp": 0
    }
  ],
  "claims": [
    { "path": "causes[0]", "confidence": 0, "basis": "verified|modelled" }
  ]
}`;

export function buildScore(
  layer: LayerDescriptor,
  narrate: NarrateOutput,
  confounders: ConfounderOutput,
  challenge: ChallengeOutput,
): PromptPair {
  return {
    system: sys("Evaluator", [
      "You are the SINGLE writer of confidence and basis for this layer. For each",
      "content claim, address it by path and assign a numeric confidence (0 to 100)",
      "and a basis: verified if a source supports it (it appears in verified_claims or",
      "a Challenger supported finding), modelled if it is a reasoned estimate. Paths",
      "look like causes[0], actions[1], hypotheses[0], metrics[2]; index into the",
      "content arrays in order.",
      "",
      "Set an overall confidence (an integer from 0 to 95: the engine never claims",
      "certainty, so never exceed 95). Lower it where unresolved confounders or refuted",
      "claims weaken the diagnosis. Set confidence_gap to the additional confidence",
      "available if the open gaps were closed, and list those gaps with a kind and the",
      "points of lift each would add.",
    ]),
    user: [
      layerHeader(layer),
      "",
      priorStage("FINAL CONTENT AND CLAIM SPLIT", narrate),
      "",
      priorStage("CONFOUNDER FINDINGS", confounders),
      "",
      priorStage("CHALLENGER FINDINGS", challenge),
      "",
      jsonShape(SCORE_SHAPE),
    ].join("\n"),
  };
}

// ── hero ────────────────────────────────────────────────────────────────────
const HERO_SHAPE = `
{
  "metric_label": "the metric name",
  "metric_value": "qualitative or modelled value, never a fabricated precise figure",
  "metric_sub": "optional sub-line",
  "tone": "good|warn|bad|neutral",
  "one_line_read": "the one-line executive read",
  "trend": [ { "label": "period", "value": 0 } ]
}`;

export function buildHero(layer: LayerDescriptor, narrate: NarrateOutput): PromptPair {
  return {
    system: sys("Enrichment", [
      "Distil the single most important metric for this layer into a hero panel: a",
      "label, a value (qualitative or a modelled estimate, never a fabricated precise",
      "figure), an optional sub-line, a tone (good, warn, bad, neutral), and a one",
      "line executive read. Add a short trend series only if it is meaningful.",
    ]),
    user: [
      layerHeader(layer),
      "",
      priorStage("FINAL CONTENT", narrate.content),
      "",
      jsonShape(HERO_SHAPE),
    ].join("\n"),
  };
}

// ── peers ───────────────────────────────────────────────────────────────────
const PEERS_SHAPE = `
{
  "dimension": "the benchmark dimension",
  "unit": "optional unit",
  "peers": [
    { "name": "Peer Name", "value": "value", "note": "optional note", "is_self": false }
  ],
  "read": "the one-line read",
  "source_urls": ["https://..."]
}`;

export function buildPeers(profile: ProfileOutput, layer: LayerDescriptor, narrate: NarrateOutput): PromptPair {
  return {
    system: sys("Enrichment", [
      "Build a peer benchmark on the dimension most relevant to this layer. Use REAL,",
      "named peers of this company (draw on the known entities). Include the company",
      "itself with is_self true. Values may be qualitative or modelled estimates; do",
      "not fabricate precise figures. Add a one line read and cite sources where used.",
    ]),
    user: [
      companyContext(profile),
      "",
      layerHeader(layer),
      "",
      priorStage("FINAL CONTENT", narrate.content),
      "",
      jsonShape(PEERS_SHAPE),
    ].join("\n"),
  };
}

// ── supplements ─────────────────────────────────────────────────────────────
const SUPPLEMENTS_SHAPE = `
{
  "blocks": [
    {
      "kind": "context|risk|watchlist|quote|stat",
      "title": "the block title",
      "body": "the block body",
      "source_urls": ["https://..."]
    }
  ]
}`;

export function buildSupplements(layer: LayerDescriptor, narrate: NarrateOutput): PromptPair {
  return {
    system: sys("Enrichment", [
      "Produce supplementary blocks that enrich this layer: added context, a risk, a",
      "watchlist item, a notable quote, or a standout stat. Each block has a kind, a",
      "title, and a body. Keep them specific to this company and cite sources where a",
      "block rests on one.",
    ]),
    user: [
      layerHeader(layer),
      "",
      priorStage("FINAL CONTENT", narrate.content),
      "",
      jsonShape(SUPPLEMENTS_SHAPE),
    ].join("\n"),
  };
}
