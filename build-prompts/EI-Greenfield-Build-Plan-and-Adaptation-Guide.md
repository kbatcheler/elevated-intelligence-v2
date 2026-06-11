# GREENFIELD BUILD PLAN AND ADAPTATION GUIDE
## Different Day · Elevated Intelligence · The Re-Sequenced Phase Map, Binding on the Agent

This guide is binding. It defines the complete greenfield build sequence and exactly how the existing downstream prompts apply when the core was built new rather than retrofitted. Where this guide and a downstream prompt conflict, this guide wins. The protocol governs throughout: per-phase gates, drift reports, tagged commits, honest remediation, no faked output, no em-dashes anywhere.

---

## THE COMPLETE SEQUENCE

**Stage 1 · Greenfield Core** (per `EI-Greenfield-Core-Master-Prompt.md`)
- A Grounding · B Foundations · C Cortex and Confounder · D Auth, Orgs and Access · E Product Surfaces · F Seeding and Seed Data · G Parity Gate.

**Stage 2 · Connectors and SOC 2** (per `EI-V2-Data-Connectors-and-SOC2-Master-Prompt.md`)
- Phases H to M, applied essentially unchanged. The DerivedSignalSet contract, its guard, and the break-glass tables already exist from Phase B; H builds the framework and registry on top of them rather than introducing them.

**Stage 3 · Operations and Hardening** (per `EI-V2-Operations-and-Hardening-Master-Prompt.md`), with these adaptations:
- N (cost), O (connector ops), P (observability), Q (secrets), S (retention), U (backups): unchanged.
- **R becomes "expand test coverage", not "introduce testing."** Tests and CI exist from Phase B. R's job is to verify every load-bearing invariant on its list has a test and add any missing, not to stand up the harness.
- **T becomes "client onboarding experience", not "add orgs."** The org and role model, scoped PINs and tenant fencing were built in Phase D. T delivers the client-facing onboarding polish: the client-admin flow for minting viewer PINs within their org, the client-side first-run, and the documented rollout runbook (mint scoped PIN, client self-registers, seed or connect their tenant).
- V verification: unchanged, against the adapted scope.

**Stage 4 · Differentiation and Moat** (per `EI-V2-Differentiation-and-Moat-Master-Prompt.md`), with one adaptation:
- W (outcome loop), X (benchmarking, still a security milestone), Z (push), AA (interactive challenge), AB (sellability), AC (verification): unchanged.
- **Y (portfolio view): the portfolio org type already exists from Phase D.** Y builds only the experience: the ranked multi-tenant dashboard, cross-portfolio gap patterns, and drill-down.

**Stage 5 · Platform completion** (per `EI-V2-Platform-Experience-and-Flexibility-Master-Prompt.md`), with these adaptations:
- **AD is retired as an overhaul.** The design language was implemented from Phase B and applied throughout. In its place, run AD as a short full-application experience audit against the design language and the Phase AD acceptance set (click depth, first-run, states, AA, 375px), fixing drift rather than redesigning.
- AE (ingestion suite): unchanged, and now trivially attachable since every path lands on the contract that has existed since Phase B.
- AF (local LLM seat and sovereign mode): unchanged.
- **AG is retired entirely.** The layer registry, per-tenant configuration and the data model for custom layers were native from Phase B. What remains of AG is only the curated custom-layer creation flow (the guarded template UI, owner approval, the benchmarking exclusion guardrail), which runs here as a small phase under the same letter.
- AH (portability): reduced. The Postgres-backed queue and the SecretStore were built natively; AH delivers the Dockerfile, the storage interface with object-storage implementations, the migration runbook with the infrastructure definition, and the containerised full-seed proof.
- AI: final verification and the consolidated build report, unchanged.

**Stage 6 · Calibration, Efficacy and Decision Intelligence** (per `EI-Calibration-Efficacy-and-Decision-Intelligence-Addendum.md`)
- Phases AJ to AN: the Brier-scored calibration ledger (which supersedes Phase W's loose calibration score), the per-layer Data Efficacy Index, the decision ledger and pre-mortem, as-of reasoning replay and the diligence pack, and final verification. AJ and AK run first within the stage; AL and AM consume their outputs.

## WHAT THE GREENFIELD PLAN REMOVED

For the drift record and for the owner's understanding: the retrofit plan's highest-risk work no longer exists. The layer-registry refactor (old AG steps 1 and 2, with its before-and-after seed-identity gate) is gone because layers were never constants. The auth replacement and the org bolt-on merged into one native build. The late UX overhaul became a day-one design language plus a closing audit. The in-memory-to-queue limiter migration is gone because the queue came first. The regression contract became the Phase G parity gate against a frozen V1. Net effect: roughly thirty phases instead of thirty-five, with the riskiest refactoring eliminated rather than gated.

## MILESTONES (the protocol's review pauses, restated for this sequence)

With PAUSE_AT_MILESTONES = true, pause for owner review at: **Phase C** (the Confounder is real, ranked, and different per tenant; the non-negotiable), **Phase G** (parity with V1, side by side), **Phases H and I** (client-data architecture begins; derive-and-discard enforced in code), **Phase K** (per-tenant keys; revocation shreds), **Phase T** (a client user is fenced to their org), **Phase X** (benchmarks hold no raw data, no identity, and respect the cohort minimum), **Phase AI** (the consolidated report), and **Phase AJ** (the calibration page is mathematically honest: misses visible, sample sizes labelled, no filtering). The old AG milestone is retired with the refactor it guarded.

## V1 DISCIPLINE, RESTATED

V1 is never modified, never merged, and never deleted by the agent. It remains deployed as the live demo and the parity reference until the owner retires it after Phase G or later. The clone at `reference/v1` is read-only and gitignored. Anything worth keeping from V1 enters the new system by being rebuilt to spec, not by being copied wholesale, with two exceptions: the pipeline prompt texts and the brand tokens, which port directly and are then adapted.
