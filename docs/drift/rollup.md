# Drift rollup: Phases A through D

A cross-phase view of every drift item logged so far, grouped by whether it is
still live, one-time and resolved, or a recurring environmental fact. Read the
per-phase reports for the full context; this is the at-a-glance comparison.

Last updated after Phase D.

## Phase verdicts

| Phase | Name | Verdict | Milestone |
| --- | --- | --- | --- |
| A | Grounding | Pass | no |
| B | Foundations | Pass | no |
| C | Cortex and Confounder | Pass | yes (passed) |
| D | Auth, Orgs and Access | Pass | no |

## Recurring environmental drift (accepted, not fixable in code)

- No manual git tags. Replit manages version control through automatic
  checkpoints, so `docs/drift/INDEX.md` is the progress source of truth in place of
  per-phase `phase-<id>` tags. Logged in A, B, C, D.
- Hosted CI cannot execute inside this environment. The GitHub Actions workflow's
  four steps (install, typecheck, build, test) run locally and pass, which is the
  same evidence the hosted job would produce. Introduced in B, referenced in C, D.

## Still live, worth attention

- In-memory rate limiter (D). Per process, resets on restart, not shared across
  instances. Fine for a single instance; needs a shared store before horizontal
  scaling. Captured in `docs/deploy-readiness.md`.
- SESSION_SECRET coupling (D). PIN code hashes and session signatures both derive
  from it, so rotating it invalidates all sessions and all outstanding PINs at
  once. Operational caveat, captured in `docs/deploy-readiness.md`.

## Live but runtime-only or cosmetic

- Provider rate limits (C). Free-tier Anthropic and Gemini return frequent 429
  under fan-out; absorbed by inner backoff and outer retry. Surfaces only during a
  seed; no failure is masked as success.
- Schema tolerance over rejection (C). Grounded model output is coerced and sliced
  rather than rejected. Known cosmetic limit: a thousand-separated sparkline value
  such as 1,200 reads as 1. Semantic enums are never coerced.

## One-time or resolved

- Portal had zero automated tests (B). Deferred from B with `--passWithNoTests`.
  Closed after Phase D: the portal data layer is now unit tested across both
  surfaces. The auth calls (login, register, status, logout) and the Access console
  admin calls (PIN mint and revoke, user enable and disable, org create, tenant
  bind, and the list loaders) are extracted into framework-free modules and tested
  with a mocked fetch, covering every status-to-error and 401 branch. The portal
  test script no longer uses `--passWithNoTests`, so a missing suite now fails
  loudly. Only DOM-rendering component tests remain deferred, because jsdom and a
  testing-library would be new dependencies held off under the zero-new-dependency
  rule.
- Empty V2 import and V1 reference URL from the owner (A). The V2 target repo
  imported empty and the V1 reference URL was supplied by the owner in chat.
  Recorded in memory for re-clone; resolved.
- Model API keys deferred (A). Deferred to the Phase C boundary and wired there;
  exercised live by the Phase C seed. Resolved.
- Live owner login not exercisable from the agent shell (D). Secrets reach only the
  workflow processes, not the agent shell or sandbox, so login was verified via the
  integration suite and the bootstrapped owner row rather than an interactive curl.
  Inherent to secret isolation; accepted.

## Logged spec deviations (decisions)

- scrypt instead of bcrypt or argon2 (D). The spec authorised bcrypt or argon2, but
  both ship native addons that are fragile under the Nix toolchain. scrypt is a
  strong, memory-hard KDF in the standard library, so it keeps the
  zero-new-dependency rule. The stored hash is self-describing, so the cost can be
  raised later without breaking existing rows.
- Zod v4 via the `zod/v4` subpath of zod 3.25.x (B). The chosen contract layer.

## No faked output, any phase

Across A through D nothing is stubbed, mocked, or faked: the cortex and Confounder
run live (C), the portal renders real registry and session data with explicit
loading, empty, and error states, and the auth suite drives the real app against
live Postgres (D).
