# Phase AD: full-application experience audit (opens Stage 5)

Phase id: AD. Name: Experience audit and drift fix. Milestone: no (gated; the opening phase of
Stage 5, Platform completion, run as a single owner-authorized phase that PAUSES at its own gate
before Phase AE; the next protocol milestone hard stop is Phase AI at the end of Stage 5).

Per the binding Adaptation Guide, Phase AD is RETIRED AS AN OVERHAUL. Instead of a redesign it was
run as a SHORT full-application experience AUDIT of the existing portal against the design language
(`docs/design-language.md`) and the AD acceptance set, FIXING DRIFT rather than rebuilding. The phase
is presentation-only: it changed CSS, shared page-chrome classes, and text-color token USAGE, and it
reconciled the design-language document to the implementation. It added no product feature, changed no
route, schema, contract, or product logic, added and changed no test, and added zero npm dependencies.
The full suite stays at 758 tests, unchanged. There is no em-dash or en-dash in source or in data.

Approach: each acceptance criterion was audited against the actual portal source and the rendered
chrome, the real drift was fixed at the SHARED level (so one fix covers every page rather than
fighting per-page inline styles), and the design-language doc was edited to match the implementation
where the two had diverged. Inline style objects outrank CSS classes on specificity, so the
responsive fix converts the shared chrome (page width, the top navigation rows, wide tables) to
classes plus a single `@media (max-width: 480px)` layer rather than rewriting hundreds of inline
styles. The global gates (typecheck, build, the full test suite, the source dash guard, the
database-wide dash sweep) were re-run fresh for this phase and the totals below are from that run.

## The AD acceptance matrix

1. Any diagnosis is reachable in two clicks. PASS (source-reviewed). The tenant picker routes
   straight into the Morning Brief and the layer feed, so a diagnosis is two clicks from the portal
   entry; this was confirmed by reading the routing and nav source, not changed.

2. First insight in under five minutes. PASS (source-reviewed). The Morning Brief leads with the
   headline diagnosis and the top findings above the fold, so the first insight is immediate on a
   ready tenant; confirmed by source review, not changed.

3. Every async surface renders distinct loading, empty, and error states. MET (audited, no fix
   required). The shared `DataState` primitive (loading skeleton, honest empty, distinct error) is
   used across the async surfaces, and the audited pages (Anomalies, War Room, Actions, Heartbeat,
   Notifications, Connections, Reasoning, Spend, and the security child panels) each branch into a
   distinct state rather than collapsing loading into empty. No fabricated data is shown in any state;
   a figure is computed from persisted state or it is not rendered. No real collapse was found, so no
   fix was made.

4. WCAG AA contrast and keyboard operability. MET (contrast fixed, focus ring added, keyboard
   confirmed). The drift here was real: normal-sized tone text (good/warn/bad/neutral) rendered on the
   base brand hues (`--teal`, `--amber`, `--coral`, plus small gold text), which do not clear the AA
   4.5:1 floor on the paper, cream, and faint-fill backgrounds at normal size. The fix introduces a
   tone-INK mapping (`toneInkVar` in `format.ts`: good to `--teal-ink`, warn to `--amber-ink`, bad to
   `--coral-ink`, neutral to `--navy`; `heroToneInkVar` in `heroes/types.ts` for the hero surfaces)
   and routes every normal-sized (under 24px) tone text through it, while the base hue is kept only
   where it is allowed: large display figures (24px and up, which clear the AA large-text floor),
   chart strokes, accent bars and borders, icons, fills and backgrounds, status dots, and dark-surface
   text. The WCAG large-text threshold used is 24px (the weights in play are 500 and 600, not bold at
   700 and up, so the 18.66px bold allowance does not apply). Every ink shade was verified against
   paper, cream, and the faint-fill backgrounds with a Node contrast calculation (built-ins only) and
   clears 4.5:1. A global `:focus-visible` ring (navy-soft) was added so keyboard focus is always
   visible; the controls are native focusable elements, so keyboard traversal works without a tab-order
   change.

5. The core read surfaces (Morning Brief, a layer page, Board Pack) are usable at 375px. MET; this was
   the one CRITICAL drift (fixed). The chrome was built with inline padding and fixed widths that
   overflow a 375px viewport. The fix converts the shared chrome to classes and adds one responsive
   layer: `.page-width` (the shared measure), `.top-nav-row` and `.top-nav-bar` (the top navigation),
   and `.table-scroll` (a horizontal-scroll wrapper for wide tables), with an `@media (max-width: 480px)`
   block that reduces the chrome padding and keeps the bottom navigation horizontally scrollable. On
   the three core read pages the wide tables are wrapped in `.table-scroll` so they scroll within the
   viewport instead of forcing the page wide. The desktop rendering is visually equivalent. The proof
   is source-reviewed (the class and media-query source plus the page markup), not a live-viewport
   screenshot capture; this proof-type limit is logged as an accepted LOW below.

6. The design-language doc matches the UI, with zero unstyled default components. MET (doc synced). The
   doc had drifted from the implementation in three places, now reconciled to match the code: the ink
   shades and the accessibility/responsive guidance were added; the gold/eyebrow guidance was corrected
   so base gold is for elevated accents, borders, and dividers while small gold text (including
   eyebrows on light surfaces) uses gold ink and dark-surface eyebrows use gold light, matching the
   `Eyebrow` primitive default of `--gold-ink`; and the focus ring was documented as navy-soft to match
   the implementation. A stale code comment was corrected to match. No unstyled default component was
   found; the portal renders through the shared primitives.

7. The regression contract holds; the changes are presentation-only. MET (integration). No product
   code, route, schema, or contract changed, and no test was added, removed, or relaxed. The full
   suite (the DerivedSignalSet guard, the connector and edge-agent import boundary, the PIN failure
   modes and owner gating, the session cookie, the append-only ledger with broken-chain detection, the
   no-secret-value sweep, the long-dash source guard, and every Stage 1 through Stage 4 surface) stays
   green at 758, unchanged, which is the regression proof for a presentation-only phase.

## Honest marking

The acceptance items split by proof type. Items 1, 2, and 5 are source-reviewed: the two-click and
five-minute paths are confirmed by reading the routing and the Morning Brief layout, and the 375px
fix is confirmed by reading the responsive class and media-query source plus the page markup, not by a
live-viewport screenshot run (the accepted LOW below). Item 3 is an audit that required no change: the
distinct-state coverage was already present, so the honest result is "audited, no fix" rather than a
claimed fix. Item 4 is a real fix proven by a deterministic contrast calculation over the ink shades
on the actual background tokens. Item 6 is a documentation reconciliation verified by reading the doc
against the primitives. Item 7 is proven by the unchanged green suite. No telemetry, health, or output
figure was touched; this phase changed how existing honest figures are colored and laid out, never
what they say.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal 1753 modules, api-server
  bundled).
- Full suite green at 758 tests (api-server 393 across 46 files, portal 225 across 18 files, cortex
  89, connectors 29, edge-agent 10, db 8, scripts 4). This phase added no tests and changed no product
  code; the count is unchanged from Phase AC.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this
  Phase AD Markdown, and a fresh database-wide cast over all 138 public text and jsonb columns across
  37 tables reports zero hits.
- Zero new npm dependencies.

## Logged drift and deviations

- The 375px usability proof is source-reviewed, not a live-viewport screenshot. The responsive
  classes and the `@media (max-width: 480px)` layer plus the core-read page markup were read to confirm
  no overflow; a live capture at 375px was not run. The fix is at the shared-chrome level so it applies
  uniformly, but the honest proof type is source review. A future pass can attach screenshots.
- The 375px fix targets the three core read surfaces (Morning Brief, a layer page, Board Pack) per the
  acceptance scope. The operator and admin tables outside that scope (Portfolio, Spend, Break-glass,
  the admin console, Onboarding) are not retrofitted; `.table-scroll` is available for them but was not
  applied, since they are operator surfaces outside the core-read 375px requirement. Logged as accepted
  drift; a future pass can wrap them.
- The Dashboard living-spec palette renders deliberate hex swatches (it IS the color showcase), and a
  few dark-surface treatments use translucent scrims; these are intentional and not contrast drift on a
  text surface. Logged so a future audit does not re-flag them.
- The Stage 4 still-live item carried forward unchanged: a tenant case study is recomputed per public
  cold-link hit rather than cached (AB). It is correct and never stale, a latency consideration at
  scale only, and is presentation-unrelated; carried into the rollup, not addressed here.

## Gate

Phase AD passed its architect `evaluate_task` review (PASS) after two remediation rounds that routed
every remaining normal-sized base-hue tone text to ink and reconciled the gold/eyebrow doc guidance.
The drift index, the rollup, and the V2 build report are updated to "A through AD". Phase AD opens
Stage 5 (Platform completion) as the retired-overhaul experience audit. Per the owner authorization
for this single phase, the build now PAUSES at the AD gate for owner review before Phase AE and does
not auto-advance. The next protocol milestone hard stop is Phase AI at the end of Stage 5.
