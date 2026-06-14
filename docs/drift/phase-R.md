# Phase R: expand test coverage and confirm CI

Phase id: R. Name: Expand test coverage and confirm CI. Milestone: no, but gated (a
per-phase hard stop deferred because the owner authorized an autonomous run of R, S, and
T back to back). T is the milestone in this run; execution stops for owner review after T.

Adaptation note (binding, from `EI-Greenfield-Build-Plan-and-Adaptation-Guide.md`): the
Operations prompt's Phase R reads "introduce testing", but this build already had a Vitest
suite and a GitHub Actions CI workflow from Phase B onward. Phase R is therefore "expand
test coverage": take the list of load-bearing invariants, prove each one already has a test
that turns red when the invariant is broken, add the single missing guard, and confirm CI
runs typecheck, build, and test and blocks on failure. This phase added zero npm
dependencies and contains no em-dash or en-dash.

## The invariant ledger

Each load-bearing invariant on the Phase R list, with the test that already pins it or the
test added this phase:

1. The DerivedSignalSet guard rejects raw records. Covered (pre-existing):
   `lib/db/src/contracts/derivedSignalSet.test.ts` asserts `assertDerivedSignalSet` accepts
   a numeric-only set and throws on raw text, on a non-numeric value, and on a missing
   field, so a connector that tries to return a raw column fails loudly at the contract.
2. The extraction path holds no database handle and writes no filesystem. Covered
   (pre-existing): `lib/connectors/src/importBoundary.test.ts` and
   `artifacts/edge-agent/src/importBoundary.test.ts` statically assert the connector and
   edge-agent source import only `@workspace/db/contracts` (never the db root that opens the
   pool) and never `node:fs`.
3. PIN validation is constant-shaped across failure modes and decrements exactly once.
   Covered (pre-existing): `artifacts/api-server/src/routes/auth.integration.test.ts`
   asserts the wrong, expired, revoked, and used-up PIN each return one byte-identical
   generic error, a valid PIN succeeds, and a successful consume decrements the remaining
   uses exactly once.
4. requireOwner refuses a member and admits an owner. Covered (pre-existing): the same
   auth integration suite drives a provider-member session to a 403 on an owner-only route
   and a provider-owner session to success.
5. The session cookie verifies when valid and is rejected when tampered or expired.
   Covered (pre-existing): `artifacts/api-server/src/lib/auth/session.test.ts` signs a
   cookie, verifies it, then flips a byte and advances past the TTL and asserts both are
   rejected.
6. The provenance ledger is append-only and a broken chain is detected. Covered
   (pre-existing): `artifacts/api-server/src/lib/provenance/ledger.test.ts` appends a chain,
   verifies it intact, then mutates a row and asserts `verifyChain` reports the break with
   its index.
7. The prompt-hygiene guard scans the prompt sources and fails on a literal example figure.
   THE GAP, filled this phase (see below).
8. The long-dash guard scans authored source including portal copy and narrator and hero
   text. Covered (pre-existing): `scripts/src/emDashGuard.test.ts` scans the repo for the
   em-dash and the en-dash and asserts zero, and turns red on an injected long dash.

## What Phase R built (invariant 7)

- `lib/cortex/src/prompts/promptHygiene.ts`: a pure, dependency-free detector. It exposes
  `scanLineForLiteralFigures(line)` which returns every literal figure on a line, matched by
  three unit-anchored regexes: a basis-points pattern (`120bps`, `250 basis points`), a
  percent pattern (`12.5%`, `8 percent`), and a dollar pattern (`$1.2M`, `$50k`). Each
  pattern requires actual digits adjacent to a unit, so a bare placeholder, a schema field
  name, a rank, or a numeric scale bound never matches. A line that carries the
  `PROMPT_HYGIENE_ALLOW_MARKER` is exempt in full, the explicit escape hatch for the rare
  case where a prompt must name a unit deliberately. The module is pure (no `node:fs`, no
  I/O), so it stays inside the cortex source boundary.
- `lib/cortex/src/prompts/promptHygiene.test.ts`: the guard. It walks the real
  `lib/cortex/src/prompts` directory, reads every `.ts` that is not a test and is not the
  detector module itself, scans each line, and asserts the authored prompt builders contain
  zero literal figures. It then proves the guard bites: synthetic strings holding a bps, a
  percent, and a dollar figure each scan to the expected kind, legitimate strings
  (placeholders, scale bounds, interpolation tokens, the word "percent" alone) scan clean,
  and an allow-marked line with a figure is exempt. The breakage is demonstrated through
  synthetic strings in the test, never by committing a bad prompt.

## The honesty constraint

The detector reports only what it actually finds. It does not flag bare numbers, because a
JSON placeholder of `0` or a rank is not a fabricated figure; it flags a digit welded to a
unit, which is the shape a hardcoded example anchor takes. The allow marker is an explicit,
greppable exemption rather than a silent skip, so an intentional unit reference is visible
in the source rather than hidden. No prompt source was altered to pass the guard; the scan
was green on the real sources on the first clean run.

## Acceptance checklist

1. The suite runs green locally and in CI. Met: typecheck and build exit 0, and the full
   suite is green at 482 tests (478 before, plus the 4 new prompt-hygiene tests). The CI
   workflow (`.github/workflows/ci.yml`) installs with a frozen lockfile then runs
   `pnpm run typecheck`, `pnpm run build`, and `pnpm run test` as separate required steps of
   the `verify` job, so any nonzero exit fails the job and blocks the merge.
2. Breaking any one invariant turns its test red. Met by construction for the seven
   pre-existing invariants (each test asserts the failing case) and proven for invariant 7:
   the synthetic-breakage cases in `promptHygiene.test.ts` are exactly "a literal figure
   appears in a scanned line", and they assert it is detected, so adding such a figure to a
   real prompt source would fail the directory scan.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 482 tests (api-server 198 across 26 files, portal 149, cortex 84 across
  10 files, connectors 29, edge-agent 10, db 8, scripts 4). New this phase: the 4
  prompt-hygiene tests in `lib/cortex/src/prompts/promptHygiene.test.ts`.
- Long-dash sweep zero on both sides: the source guard over lib, artifacts, docs, scripts,
  `replit.md`, `.replit`, and `.github` is zero, and a database-wide cast over every text and
  jsonb column in every public table is zero (`NOTICE: TOTAL DASH HITS 0`).
- Zero new npm dependencies (Vitest was already in the lockfile; the detector is pure
  TypeScript and the guard uses only `node:fs` and `node:path` in the test).

## Logged drift and deviations

- Phase R is "expand test coverage", not "introduce testing" (the adaptation guide overrides
  the Operations prompt). The suite and the CI workflow predate this phase; R proves the
  invariant coverage and fills the one real gap rather than standing up the harness.
- The prompt-hygiene detector module is excluded from its own directory scan, because the
  detector necessarily contains the example unit strings it looks for; including it would be
  a guaranteed self-flag. Test files are excluded for the same reason (they hold the
  synthetic offenders on purpose). The scanned set is the authored prompt builders only,
  which is the surface that reaches a model.
- The detector matches unit-anchored figures only and deliberately does not flag bare
  numbers, to keep the false-positive rate at zero on the current prompt sources. If a later
  prompt introduces a new risky unit, the pattern set is extended; the architect noted, as a
  non-blocking item, making the directory scan recursive if prompt builders are ever nested
  under subdirectories.

## Gate

Phase R passed its architect `evaluate_task` review (PASS, no blocking issues; the
non-blocking notes above are recorded). Execution continues to Phase S as part of the
owner-authorized autonomous R-S-T run; the hard stop is after the Phase T milestone. The
drift index, the rollup, and the V2 build report are updated to "A through R".
