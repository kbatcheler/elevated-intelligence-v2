# Phase AS: signature surface (portal tokenisation and the signature vocabulary)

Phase id: AS. Name: signature surface. Milestone: no (a gated per-phase stop). Phase AS is the FIFTH and
CLOSING phase of the Robustness and Magic wave (AO through AS), the post-AN follow-on wave that reopened the
Elevated Intelligence V2 build to harden the platform and sharpen its surface. AS owns `artifacts/portal/**`
in full and changes no server, route, contract, or shared type; the authoritative diff since the Phase AR
commit is portal-only (67 portal files plus this phase's drift records, and nothing outside `artifacts/portal`).

AS changes no product behaviour and no data. Its deliverable is the portal's visual language made consistent
and deliberate: every inline style object replaced by the frozen token vocabulary and Tailwind utilities, the
top navigation cut to five primary destinations with the rest grouped and role-fenced, the two signature
surfaces (the Morning Brief and the public diagnosis at `/d/:token`) made exceptional, a small set of signature
primitives built and adopted, and the UI copy normalised to British English while the data-contract
identifiers stay American.

## The token vocabulary as the single source

`artifacts/portal/src/index.css` is the frozen vocabulary: the colour, type, spacing, pill, tag, eyebrow,
serif-diagnosis, and gold-sweep tokens plus the component utility classes the whole portal now composes from.
Tokenisation means a component states its intent through these classes and the Tailwind utilities, not through
a hand-built inline `style={{...}}` object. Across the portal this removed far more than it added (the diff is
a net reduction of roughly 376 lines over 67 files), because a repeated inline object collapses to one shared
class. The text tokens carry the `-ink` foreground variants that meet WCAG AA against their surfaces, so
choosing the token is choosing the accessible colour.

## The signature primitives

The signature vocabulary lives in `artifacts/portal/src/components/primitives/` and is exported through its
`index.ts`:

- `Signature.tsx` (new) holds the two most expressive surfaces. `SerifDiagnosis` sets the product's single
  confident conclusion in the serif voice on a comfortable measure, with an optional eyebrow, supporting line,
  and action; its thin leading rule is the only thing the tone colours, so the conclusion itself always reads
  in navy authority and a "bad" diagnosis is rendered no less confidently than a good one. `GoldUnderlineSweep`
  is a thin gold rule that wipes in once beneath a freshly computed value; the animation is pure CSS (no
  library), remounting on a changed `sweepKey` so the wipe replays exactly once per recompute, holding fully
  drawn under reduced motion, and `aria-hidden` because it is decorative.
- `Pills.tsx` carries the provenance vocabulary: `ProvenancePill` declares each figure verified or modelled,
  `ConfidencePill` folds in the numeric confidence, and `VerdictPill`/`Tag` complete the set.
- `ReasoningStrip.tsx` (the reasoning ribbon), `MetricTile.tsx` (the headline metric), and `DataState.tsx` (the
  loading, empty, error, and ready states as one honest primitive) round out the set the pages compose from.

## The navigation cut

`TopNav.tsx` cuts the primary bar to five destinations: Brief, Board pack, Layers, Decisions, and Outcome loop.
Everything else moves into a secondary "More" grouping split into Analysis and Operations, and the role fences
are preserved exactly: Portfolio appears only for a provider seat, and Connections, Break-glass, Onboarding,
Security, Spend, Calibration, and Admin appear only for the seats already entitled to them. The cut is presentation
only; no route, guard, or server fence changed, so a surface a seat could not reach before is still unreachable.

## The two signature surfaces

The Morning Brief (`BriefPage.tsx`) and the public diagnosis (`PublicDiagnosisPage.tsx`, the `/d/:token` share
surface) are restyled to the signature vocabulary: the serif diagnosis voice, the provenance pills on every
figure, and the four honest data states, so the first surface a client sees and the one surface an outsider can
see are the most considered. The outcome-loop page that Phase AQ built (`OutcomeLoopPage.tsx`) is restyled onto
the same primitives.

## British English copy

The UI copy is normalised to British spelling, closing the normalisation that Phase AQ deferred to AS: the
visible "organization" in the onboarding copy and the empty-state messages across the pages becomes
"organisation", and the Login "not recognized" becomes "not recognised". The data-contract identifiers stay
American by deliberate decision: the `OutcomeMeasurementStatus` `"realized"` enum value, the `realizedValueUsd`
fields, and the `catalog` layer identifiers are wire and code names, not user-visible copy, so changing them
would be a contract change AS is forbidden from making. No test asserts the changed copy strings (verified by
grep before editing), so the normalisation breaks nothing.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; build at 1773 modules).
- The deterministic suites pass on every run: portal 327 tests across 31 files, cortex 111, connectors 63, db
  8, and scripts 4 (the source guard `scripts/emDashGuard.test.ts` is in the suite), plus edge-agent 10. The
  api-server integration suite (656 tests across 80 files, untouched by AS) is contention-sensitive in this
  environment: two workflow runs each flaked a DIFFERENT single integration test (first the
  `spend.integration.test.ts` ledger-SUM reconciliation, `expected 517 to be 519` on the call count; then the
  `asOf.integration.test.ts` deterministic-replay equality), both concurrent-write races on the shared dev
  database between parallel test files while the live dev workflows hold the same Postgres, the recurring
  environmental flake logged from AP and AQ. Both flaky files pass deterministically when run serially with
  file parallelism disabled (`vitest run --no-file-parallelism`, 18 of 18, exit 0), proving the failures are
  test-isolation races, not a regression, and structurally unreachable from a portal-only change since AS
  alters no api-server code. A subsequent full workflow run then passed completely green with no flake at all:
  1179 tests across every suite (api-server 656 across 80 files, portal 327, cortex 111, connectors 63,
  edge-agent 10, db 8, scripts 4), zero failures.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AS
  Markdown, and a fresh database-wide row-cast over the public text and jsonb columns reports zero hits (AS
  writes no schema and no data, so the database side stays clean and is re-run fresh to claim zero honestly).
- Zero new npm dependencies: the gold-underline sweep and every transition are pure CSS, framer-motion is
  absent, and AS added one primitive module, utility classes, and markup only.

## Honest marking

What is PROVEN here: that the workspace typechecks and builds with the tokenised portal, that the full
automated suite stays green, that the long-dash sweep is zero across source and data, and that the public
login surface renders the signature vocabulary correctly (visually smoke-tested at the running dev server).
What is the accepted boundary (logged drift): WCAG AA and the 375px mobile floor are handled by construction
(the AA `-ink` text tokens, and fluid layouts that wrap and reflow via `flex-wrap`, `min-w-0`, and arbitrary
`minmax` grids rather than fixed wide widths) and confirmed on the public surface, but the AUTHENTICATED
portal could not be screenshotted at a controlled viewport in this environment, because the owner secrets are
not in the agent shell (so no interactive sign-in) and the screenshot tool exposes no viewport parameter; an
automated cross-viewport accessibility sweep is therefore an operator follow-up, recorded honestly rather than
claimed. A small number of inline styles are deliberately KEPT where the value is genuine runtime geometry that
cannot be a static token: chart and bar dimensions and positions computed from data (BenchmarkHero, SpendPage,
the FlowFunnel and Network heroes), a per-figure or per-group palette colour resolved at runtime (the
AsOfReplay figure colour, the DependencyMap group palette, the Dashboard palette swatch), and the boot-splash
skeleton dimensions; a Lucide icon `color="var(--token)"` prop is left as-is because it reads the same token.

Nothing is fabricated: the restyle adds no figure, no telemetry, and no output; every data state stays honest
(a missing figure remains a disclosed dash, never a zero), and the gold-underline sweep marks a real recompute
rather than inventing one.

## Logged drift and deviations

- AS is presentation only and adds no new unit test: the change is token-and-markup tokenisation of existing
  surfaces with no new pure logic to test, and the portal suite deliberately avoids a DOM-testing dependency
  (the zero-new-dependency invariant), so the restyle is proven by typecheck, build, the unchanged green
  suite, the two-sided long-dash sweep, and a visual smoke of the public surface rather than by new assertions.
- The authenticated-portal cross-viewport AA and 375px sweep is an operator follow-up (owner secrets are not in
  the agent shell and the screenshot tool has no viewport control); AA and the mobile floor are handled by
  construction and confirmed on the public login surface.
- The data-contract identifiers (`realized`/`realizedValueUsd`, the `catalog` layer keys) keep American
  spelling because they are wire and code names; only user-visible copy is British. This is the same boundary
  Phase AQ logged when it deferred the portal-wide normalisation to AS.
- A few inline styles are kept where the value is genuine runtime geometry or a runtime-resolved palette colour
  that cannot be expressed as a static token; these are data-driven values, not style drift.

## Gate

Phase AS passed its architect review. The hard constraints hold (zero new dependencies, ASCII hyphen only in
source and data, no fabricated figure, British UI copy with American data-contract identifiers). The drift
index, the rollup, and the V2 build report advance to "A through AS". Phase AS is gated but not a milestone; it
is the closing phase of the Robustness and Magic wave (AO through AS), which is now complete.
