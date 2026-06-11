---
name: EI V2 greenfield build
description: Cross-session pointers for the Elevated Intelligence V2 greenfield build (V1 location, resume rules, non-negotiables).
---

# Elevated Intelligence V2 greenfield build

This repo is a greenfield rebuild governed by the documents in `build-prompts/`. Read `build-prompts/EI-V2-Autonomous-Execution-and-Drift-Control-Protocol.md` first, then the Greenfield Core Master Prompt and the binding Adaptation Guide.

## V1 reference (NOT derivable from this repo)
- The V1 system is a separate GitHub repo: `https://github.com/kbatcheler/Elevated-Intelligence` (note: the V2 target repo `kbatcheler/elevated-intelligence-v2` imported empty).
- Re-clone read-only at the start of every session: `git clone --depth 1 https://github.com/kbatcheler/Elevated-Intelligence reference/v1`. `reference/` is gitignored. Never modify, merge, or delete it.
- Use it only for: porting the pipeline prompt texts and the brand tokens, and as the behavioural parity reference for Phase G.

## Resume rule
- `docs/drift/INDEX.md` is the source of truth for progress. On restart, read it, find the last passed phase, continue from the next. Do not restart from Phase A.

## Non-negotiables (the ones easy to violate)
- No long em-dash anywhere (code, copy, seed data, schema comments, drift reports, status output). Comma, colon, or full stop. Middot as a separator inside display strings. There is an automated guard test from Phase B.
- The three-model cortex and a genuine Confounder sub-stage must be REAL on a live seed before Phase C completes. Never stub, mock, script, or back them with static data.
- PAUSE_AT_MILESTONES = true: hard stop for owner review at phases C, G, H and I, K, T, X, AI, AJ.

## Environment notes
- GitHub https clone works from this sandbox (V1 cloned fine). `git ls-remote` against the empty V2 origin timed out, that was the empty repo, not a network block.
- Replit manages VCS via automatic checkpoints; the agent does not run manual git commit or tag. Per-phase `phase-<id>` tags from the protocol are replaced by `docs/drift/INDEX.md` as the progress record.

## Model seat mapping (from spec, restated so it is not lost)
- Cortex Lens and Synthesist: Claude Sonnet (V1 used `claude-sonnet-4-6`).
- Evaluator and Enrichment: Claude Haiku (V1 used `claude-haiku-4-5`).
- Confounder and Challenger: Gemini grounded (V1 used `gemini-2.5-pro`).
- One CORTEX config is the only place model strings live. New sub-stage order per layer: perceive, hypothesise, confound, challenge, narrate, score, hero, peers, supplements (9 sub-stages; V1 had 8, Confounder is the new one before Challenger).
