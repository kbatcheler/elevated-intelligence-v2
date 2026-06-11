# Drift Report Index

Source of truth for build progress. On any restart, read this file, find the last phase that passed its gate, and continue from the next one. Do not restart from Phase A.

Protocol: per phase, build, verify (typecheck, build, acceptance checks, regression/parity contract, em-dash sweep, test suite from Phase B on), write the drift report, remediate until truly green, then advance. PAUSE_AT_MILESTONES = true.

Milestones (hard stops for owner review): C, G, H and I, K, T, X, AI, AJ.

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | not started | yes |

## Notes

- V1 reference: cloned read-only into `reference/v1` (gitignored). Re-clone each session from the repo recorded in memory.
- Model API keys (Anthropic, Gemini) are required by the Phase C gate and are not yet wired. Phase C is also a milestone pause.
- Git tagging: this is a Replit managed-VCS environment where commits are created as automatic checkpoints. This INDEX is the protocol's stated source of truth for progress in place of manual `phase-<id>` tags. Logged as acceptable drift.
