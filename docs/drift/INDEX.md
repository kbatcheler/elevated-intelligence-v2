# Drift Report Index

Source of truth for build progress. On any restart, read this file, find the last phase that passed its gate, and continue from the next one. Do not restart from Phase A.

Protocol: per phase, build, verify (typecheck, build, acceptance checks, regression/parity contract, em-dash sweep, test suite from Phase B on), write the drift report, remediate until truly green, then advance. PAUSE_AT_MILESTONES = true.

Milestones (hard stops for owner review): C, G, H and I, K, T, X, AI, AJ.

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes |

## Notes

- V1 reference: cloned read-only into `reference/v1` (gitignored). Re-clone each session from the repo recorded in memory.
- Phase C gate met: one real tenant (Patagonia) seeded end to end, fourteen of fourteen layers built, live three-model cortex and grounded Confounder, per-seat telemetry readable via routes. See `phase-C.md`. Milestone pause before Phase D.
- Model API keys (Anthropic, Gemini) are wired via the AI integrations env vars and were exercised live by the Phase C seed.
- Git tagging: this is a Replit managed-VCS environment where commits are created as automatic checkpoints. This INDEX is the protocol's stated source of truth for progress in place of manual `phase-<id>` tags. Logged as acceptable drift.
