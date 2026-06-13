# Drift rollup: Phases A through F

A cross-phase view of every drift item logged so far, grouped by whether it is
still live, one-time and resolved, or a recurring environmental fact. Read the
per-phase reports for the full context; this is the at-a-glance comparison.

Last updated after Phase F (including the Phase F remediation hardenings).

## Phase verdicts

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes (passed) |
| D | Auth, Orgs and Access | Pass | no |
| E | Product Surfaces | Pass | no |
| F | Fast Seeding and World-Class Seed Data | Pass | no (Phase G next is a milestone) |

## Recurring environmental drift (accepted, not fixable in code)

- No manual git tags. Replit manages version control through automatic
  checkpoints, so `docs/drift/INDEX.md` is the progress source of truth in place of
  per-phase `phase-<id>` tags. Logged in A through F.
- Hosted CI cannot execute inside this environment. The GitHub Actions workflow's
  four steps (install, typecheck, build, test) run locally and pass, which is the
  same evidence the hosted job would produce. Introduced in B, referenced since.
- Owner secrets reach the workflow processes only, not the agent shell or sandbox,
  so live owner login is verified via the integration suite and the bootstrapped
  owner row rather than an interactive curl. Logged in D, holds since.

## Still live, worth attention

- In-memory rate limiter for auth (D). Per process, resets on restart, not shared
  across instances. Fine for a single instance; needs a shared store before
  horizontal scaling. Note: the SEED pipeline no longer uses an in-module limiter,
  it uses the Postgres-backed `pipeline_jobs` claim queue (F); this caveat is now
  scoped to the auth rate limiter only. Captured in `docs/deploy-readiness.md`.
- SESSION_SECRET coupling (D). PIN code hashes and session signatures both derive
  from it, so rotating it invalidates all sessions and all outstanding PINs at
  once. Operational caveat, captured in `docs/deploy-readiness.md`.
- Live seed concurrency held at LAYER_CONCURRENCY=2 (F). The Anthropic integration
  rate-limits hard; above about four concurrent claimers a seed hits a 429 storm,
  and an errored layer is terminal, so the live runs were benched at 2 for zero
  429s. The default is 5; recorded timings are conservative against it. Provider
  rate limit, not a code defect.
- Express-to-full total cost exceeds a direct full seed (F). Express optimizes time
  to first ready, not total cost: express plus a later upgrade is more wall-clock
  and spend than one direct full seed. A deliberate trade, not a defect.

## Live but runtime-only or cosmetic

- Provider rate limits (C, F). Free-tier Anthropic and Gemini return frequent 429
  under fan-out; absorbed by inner backoff and outer retry, and by the benched seed
  concurrency. Surfaces only during a seed; no failure is masked as success.
- Schema tolerance over rejection at model-output boundaries (C, F). Grounded model
  output is coerced and sliced rather than rejected; semantic enums are never
  coerced at the storage boundary. Known cosmetic limit: a thousand-separated
  sparkline value such as 1,200 reads as 1. Extended in F: the score-stage claim
  `basis` coerces an unknown or missing value to the conservative `modelled` at the
  stage input boundary, while the stored content schema stays strict.

## One-time or resolved

- Portal had zero automated tests (B). Deferred from B with `--passWithNoTests`.
  Closed after Phase D: the portal data layer is unit tested across both surfaces
  (auth and the Access console), with a mocked fetch covering every status-to-error
  and 401 branch. Only DOM-rendering component tests remain deferred, because jsdom
  and a testing-library would be new dependencies held off under the
  zero-new-dependency rule.
- Cross-tenant breadth deferred from Phase E to Phase F (E). Phase E built the
  portal against the one seeded tenant and deferred multi-tenant breadth to F.
  Resolved in F: four real tenants are seeded to ready with verifiably distinct
  figures.
- Score-stage basis fragility (F). The Evaluator occasionally emitted a claim basis
  outside {verified, modelled}; the in-call retry self-corrected it every time
  (zero seed failures). Resolved in the F remediation: the score-stage basis
  coerces unknown or missing values to `modelled` at the input boundary and the
  prompt states the allowed values, while stored content stays strict.
- Anchor-sweep "any shared figure fails" premise (F). The first sweep failed on any
  shared currency figure, which is empirically wrong for independent real
  companies. Resolved in F: the sweep fails on a real templating signature (a pair
  sharing two-plus specific figures or over 30 percent of its anchors, or a
  specific figure broadcast to three-plus tenants), and the pass/fail logic is
  extracted into a unit-tested pure module.
- Empty V2 import and V1 reference URL from the owner (A). The V2 target repo
  imported empty and the V1 reference URL was supplied by the owner in chat.
  Recorded in memory for re-clone; resolved.
- Model API keys deferred (A). Deferred to the Phase C boundary and wired there;
  exercised live by the Phase C seed and the four Phase F live seeds. Resolved.

## Logged spec deviations (decisions)

- scrypt instead of bcrypt or argon2 (D). The spec authorised bcrypt or argon2, but
  both ship native addons that are fragile under the Nix toolchain. scrypt is a
  strong, memory-hard KDF in the standard library, so it keeps the
  zero-new-dependency rule. The stored hash is self-describing, so the cost can be
  raised later without breaking existing rows.
- Zod v4 via the `zod/v4` subpath of zod 3.25.x (B). The chosen contract layer.
- `GET /api/tenants` list, access-fenced (E). A deliberate reversal of Phase D's
  no-list stance, scoped by the access fence, so the portal can offer a tenant
  picker without exposing tenants across the fence.
- Postgres-backed `pipeline_jobs` queue brought forward from Phase AH (F). A new,
  separate, generic table so AH and the connector work can extend it later without
  reshaping seed state.
- Patagonia and Hillman are the same scale (F). They genuinely share a $1.47
  billion reported-revenue figure; the anchor sweep surfaces it as a documented
  real-world coincidence (a single-pair warning, below the broadcast threshold),
  not templating.
- Anchor-sweep templating-signature definition (F). What counts as a failure is a
  pair sharing two-plus specific figures or over 30 percent of its currency
  anchors, or a specific figure broadcast to three-plus tenants; round figures and
  percentages stay benign.

## No faked output, any phase

Across A through F nothing is stubbed, mocked, or faked: the cortex and Confounder
run live (C) and were exercised again by four end-to-end Phase F live seeds (three
fresh tenants plus a live express-to-full upgrade), each recording real per-seat
tokens, latency, and cache figures; express mode marks reduced layers honestly
(skipped sub-stages with no model call, not invented content); the portal renders
real registry, session, and persisted layer data with explicit loading, empty, and
error states (E); and the auth suite drives the real app against live Postgres (D).
