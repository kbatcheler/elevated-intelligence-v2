# Drift Report Index

Source of truth for build progress. On any restart, read this file, find the last phase that passed its gate, and continue from the next one. Do not restart from Phase A.

Protocol: per phase, build, verify (typecheck, build, acceptance checks, regression/parity contract, em-dash sweep, test suite from Phase B on), write the drift report, remediate until truly green, then advance. PAUSE_AT_MILESTONES = true.

Milestones (hard stops for owner review): C, G, H and I, K, T, X, AI, AJ.

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes |
| D | Auth, Orgs and Access | Pass | no |

## Notes

- V1 reference: cloned read-only into `reference/v1` (gitignored). Re-clone each session from the repo recorded in memory.
- Phase C gate met: one real tenant (Patagonia) seeded end to end, fourteen of fourteen layers built, live three-model cortex and grounded Confounder, per-seat telemetry readable via routes. See `phase-C.md`. Milestone pause before Phase D.
- Model API keys (Anthropic, Gemini) are wired via the AI integrations env vars and were exercised live by the Phase C seed.
- Phase D gate met: PIN-gated registration, owner-minted and scoped PINs, client and portfolio tenant fencing, owner Access console, scrypt passwords and HMAC PIN hashing with zero new dependencies. Owner bootstraps from secrets (one provider org, one active owner confirmed in the database). The four PIN failure modes return one byte-identical error. See `phase-D.md`. Not a milestone; continuing to Phase E.
- Owner secrets (OWNER_EMAIL, OWNER_PASSWORD, SESSION_SECRET) are injected into the workflow processes only, not the agent shell or sandbox, so live owner login is verified via the integration suite and the bootstrapped owner row rather than an interactive curl.
- Git tagging: this is a Replit managed-VCS environment where commits are created as automatic checkpoints. This INDEX is the protocol's stated source of truth for progress in place of manual `phase-<id>` tags. Logged as acceptable drift.
- Cross-phase drift rollup (A through D) lives in `rollup.md`; deploy-time operational caveats (in-memory limiter, SESSION_SECRET rotation, owner bootstrap secrets) live in `docs/deploy-readiness.md`.
