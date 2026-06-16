// On-demand pre-mortem (Phase AL) prompt builder. A pre-mortem reuses the
// Confounder seat (Gemini, grounded) but, unlike the interactive challenge, it
// does not re-test a finding: it imagines a DECISION the human has taken has
// already failed and works backwards to the ranked ways it could have, each with
// an early-warning indicator. It is scoped to the single decision on purpose, so
// it can never turn into a whole-layer rewrite.

import type { ProfileOutput } from "../schemas/profile";
import {
  companyContext,
  jsonShape,
  layerHeader,
  priorStage,
  STAGE_RULES,
  type LayerDescriptor,
} from "./shared";

// The decision under pre-mortem, snapshotted from the real recommendation and
// the human's recorded choice, plus the surrounding context a faithful
// imagination of failure needs.
export interface PreMortemInput {
  profile: ProfileOutput;
  layer: LayerDescriptor;
  decision: {
    // The human's choice on the recommendation: commit, defer, or reject.
    kind: string;
    // The stable reference into the content, e.g. "actions[0]". Optional.
    actionRef?: string;
    title: string;
    detail?: string;
    impact?: string;
    confidence: number;
    basis: string;
    // The human's stated reason for the decision, when given. Context, not an
    // instruction.
    rationale?: string;
  };
  // The layer's executive narrative, for context (bounded by priorStage).
  narrative?: string;
  // The persisted Confounder findings for the layer, for context.
  confounders?: unknown;
}

interface PromptPair {
  system: string;
  user: string;
}

function systemPrompt(role: string, body: string[]): string {
  return [`You are the ${role} of an executive intelligence engine.`, "", ...body, "", STAGE_RULES].join("\n");
}

// A compact rendering of the decision under pre-mortem.
function decisionBlock(input: PreMortemInput): string {
  const d = input.decision;
  const lines: string[] = [
    `DECISION UNDER PRE-MORTEM (${d.kind}${d.actionRef ? `, reference ${d.actionRef}` : ""}):`,
    `  RECOMMENDED ACTION: ${d.title}`,
  ];
  if (d.impact) lines.push(`  PREDICTED IMPACT: ${d.impact}`);
  if (d.detail) lines.push(`  DETAIL: ${d.detail}`);
  lines.push(`  SYSTEM CONFIDENCE: ${d.confidence}`);
  lines.push(`  SYSTEM BASIS: ${d.basis}`);
  if (d.rationale) lines.push(`  HUMAN RATIONALE: ${d.rationale}`);
  return lines.join("\n");
}

const PRE_MORTEM_SHAPE = `
{
  "failure_modes": [
    {
      "rank": 1,
      "title": "the single most likely way this decision fails",
      "mechanism": "the causal chain by which it would sink the decision",
      "likelihood": "low|medium|high",
      "early_warning": "ONE observable, monitorable early sign this is taking hold"
    }
  ],
  "residual_risk_note": "what remains uncertain after the failure modes above"
}`;

// The Confounder seat runs the pre-mortem: assume the decision has already
// failed and reason backwards to the ranked failure modes and their early
// warnings. The human's rationale is CONTEXT to stress-test, never ground truth.
export function buildPreMortem(input: PreMortemInput): PromptPair {
  return {
    system: systemPrompt("Confounder", [
      "A human has taken a DECISION on a recommended action (committed it, deferred",
      "it, or rejected it). Run a PRE-MORTEM: assume it is some months later and the",
      "decision has CLEARLY FAILED, then reason backwards to the ranked ways it could",
      "have failed. This is structured adversarial imagination, not a forecast: do not",
      "assert a probability, and never soften the analysis to flatter the decision.",
      "",
      "USE GOOGLE SEARCH to ground the failure modes in real, sector-specific",
      "evidence where you can. For EACH failure mode give the causal mechanism, a",
      "likelihood band (low, medium, high), and exactly ONE observable early-warning",
      "indicator: a concrete, monitorable sign that would show the failure taking",
      "hold early enough to act. Rank the failure modes most to least likely. Never",
      "invent a failure mode without a plausible mechanism, and never present a guess",
      "as a measured figure.",
    ]),
    user: [
      companyContext(input.profile),
      "",
      layerHeader(input.layer),
      "",
      decisionBlock(input),
      ...(input.narrative ? ["", priorStage("LAYER NARRATIVE", input.narrative, 2000)] : []),
      ...(input.confounders ? ["", priorStage("EXISTING CONFOUNDER FINDINGS", input.confounders, 3000)] : []),
      "",
      "Search the web first, then answer.",
      "",
      jsonShape(PRE_MORTEM_SHAPE),
    ].join("\n"),
  };
}
