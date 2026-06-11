# Phase A: Grounding

Verdict: Pass.

## Requirements checklist

- Read the Autonomous Execution and Drift Control Protocol. Done. `build-prompts/EI-V2-Autonomous-Execution-and-Drift-Control-Protocol.md`.
- Read the Greenfield Core Master Prompt. Done. `build-prompts/EI-Greenfield-Core-Master-Prompt.md`.
- Read the binding Greenfield Build Plan and Adaptation Guide. Done. `build-prompts/EI-Greenfield-Build-Plan-and-Adaptation-Guide.md`.
- Read the original V2 Master Prompt as the spec library. Done. `build-prompts/Elevated-Intelligence-V2-Master-Prompt.md`.
- Read the Canonical Layer Content Specification. Done. `build-prompts/EI-Canonical-Layer-Content-Specification.md`.
- Read the Top-Down Architecture Review. Done. `build-prompts/EI-V2-Top-Down-Architecture-Review.md`.
- Clone the V1 reference read-only into `reference/v1`, gitignore `reference/`. Done. V1 cloned, `.gitignore` created.
- Read V1 `replit.md` and pipeline code. Done. Read `reference/v1/replit.md`, brand tokens (`reference/v1/artifacts/portal/src/index.css`), core schema files, and obtained a full pipeline walkthrough of `reference/v1/artifacts/api-server/src/lib/pipeline/`.
- Deliver the one-screen grounding confirmation (mini-Palantir derive-and-discard, greenfield rules, Day One Non-Negotiable, em-dash rule, planned monorepo structure). Done, delivered in chat.

## Drift items

- Acceptable: the GitHub import of the V2 target repo arrived empty (only `.replit` plus the build prompts). The V1 reference repo URL was not in the spec set and was provided by the owner in chat. Recorded in memory so future sessions can re-clone. Reason: external dependency that had to be sourced from the owner.
- Acceptable: manual `phase-<id>` git tags are replaced by `docs/drift/INDEX.md` as the progress source of truth, because this Replit environment manages version control through automatic checkpoints and direct git commit or tag operations are not run by the agent here. The protocol itself names INDEX.md as the source of truth for resumability.
- No stubbing, mocking, or faked output in this phase. Phase A produces no runtime code.

## Decisions taken

- Monorepo structure proposed for Phase B mirrors the V1 layout that worked (pnpm workspaces: `lib/db`, `lib/cortex`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `artifacts/api-server`, `artifacts/portal`, `docs/`, gitignored `reference/`).
- Model API keys deferred to the Phase C boundary, which is also a milestone pause. Phase B does not require them.

## Test and verification summary

- No code yet. Verification for Phase A is the grounding read set and the confirmation. Typecheck, build, and the test suite begin in Phase B.

## Milestone marker

Phase A is not a milestone. Next milestone is Phase C.
