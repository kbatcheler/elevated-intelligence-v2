# Phase AT: the Intelligence Gap Assessment (the pre-auth top of funnel)

Phase id: AT. Name: the Intelligence Gap Assessment. Milestone: no (a gated per-phase stop). Phase AT
opens a NEW top-of-funnel surface in front of the product: a pre-auth self-assessment a cold prospect
can take with no account, leading to a slick forwardable and printable report that names their
intelligence gap, maps it to the canonical layers, teaches the one line, frames the cost honestly, and
OPTIONALLY folds in a bounded outside_in profile-grade diagnosis of their own public footprint. AT adds
only new files plus four additive registrations and changes no cortex, connector, pipeline, design
token, shell, or existing page.

## Ownership and the additive seam

AT is built as new files only, with the smallest possible additive registrations into existing files:
two export lines in the db schema barrel (`lib/db/src/schema/index.ts`, the unavoidable table
registration every prior table also did), one mount line in `artifacts/api-server/src/app.ts` (the
public assessment router, mounted beside the existing public router and BEFORE the `requireAuth` fence
so the whole funnel is reachable without a session), and two route branches in the portal shell
(`artifacts/portal/src/App.tsx`, the `/assess` flow and the `/a/:token` report, both placed before the
`AuthProvider` so neither mounts the authenticated app). No cortex, connector, pipeline, `index.css`
design token, or existing page was touched.

## The schema

Two new tables. `assessment_submissions` is one row per completed assessment: the prospect's scored
`answers`, the deterministically computed `dimension_scores`, and the `qualification` answers as three
jsonb columns; an optional `company_url`; the optional diagnosis as an authoritative
`diagnosis_status` enum (`not_requested` default, `pending`, `in_progress`, `ready`, `unavailable`,
`failed`) plus a `diagnosis` jsonb that holds only the detail; and the captured contact (`contact_name`,
`contact_email`, `contact_company`, `contact_captured_at`) all nullable, because the on-screen result is
shown free and a row is valid before any contact exists. `assessment_share_tokens` mirrors the Phase AB
diagnosis share token exactly (opaque token shown once and never persisted, only its sha256 hash stored
unique, resolved by hashing and matching one unexpired unrevoked row, with real `last_accessed_at` and
`access_count` telemetry) with two deliberate differences because the funnel is anonymous: it references
an `assessment_submissions` row ON DELETE CASCADE rather than a tenant, and it carries no `createdBy`
because the minter is a cold prospect with no session.

## The honest, model-free scoring core

The scoring is pure deterministic compute with no model, no clock, and no database, so it is instant,
free, cannot fabricate, and is fully unit tested. The question bank
(`artifacts/api-server/src/lib/assessment/questions.ts`) is ten scored behavioural questions across the
four provenance dimensions (three Visibility, two Speed, three Foresight, two Confidence), each tagged
to one or more of the fourteen canonical layer keys, plus three qualification questions (sector,
revenueBand, systems) that route and qualify the lead rather than score the gap. Each scored option runs
the rungs flying-blind (0), partial (1), ahead (2). The public projection of the bank withholds the
option scores so the prospect answers honestly about behaviour rather than against a visible weighting.

`scoring.ts` normalises each dimension to 0 to 100 against its own maximum (so dimensions with a
different number of questions stay comparable), bands each score (`blind` 0 to 33, `reactive` 34 to 66,
`ahead` 67 to 100), and selects the gap layers entirely from the prospect's own weak answers (a layer
only surfaces because a question tagged to it was answered below "ahead", weighted 2 for blind and 1 for
partial). The honesty contract lives here: a genuinely sharp operation that answers everything "ahead"
scores well, yields an EMPTY gap selection, and the narrative FLIPS its message (the headline becomes
"You are ahead, and that is the risk", and the cost framing reframes the risk as concentration and
fragility rather than blindness). The cost framing is qualitative and derived only from the prospect's
own weak dimensions and their stated revenue band used as a scale WORD; it never multiplies a band into
a figure and explicitly says it will not invent one. The single teaching line ("Your software records
what happened. Elevated Intelligence tells you what it means and what to do.") is a constant, never
computed from state.

`report.ts` assembles the two payloads: the free on-screen `AssessmentResult` (scores, the templated
gap narrative, the gap-to-layers mapping with each layer's real registry name, module group and the
`closedBy` capability, the qualitative cost framing, the prospect's named systems, and a CTA) and the
forwardable `AssessmentReport`, which is the same result plus the optional diagnosis read HONESTLY from
its status column (a `not_requested` row carries `diagnosis: null`; any other status carries the
status, domain, narrow profile projection, provenance and honest homepage fetch metadata, never raw
HTML or a model snippet).

## Approach B: the bounded outside_in diagnosis that never creates a tenant

The optional diagnosis (`diagnosisRunner.ts`) is the architect-approved Approach B. It NEVER creates a
tenant. It reuses the pure cortex primitives directly: `fetchHomepageContext` (the existing
SSRF-hardened fetch) then `runProfile` standalone, records any billed model usage through
`recordModelUsageSafe` with `tenantId: null` (so the cost is honestly attributed to the funnel and not
to any client), and persists only a narrow profile projection (name, sector, tagline, url) plus honest
fetch and billing telemetry, never raw HTML. It is fired ONLY after contact capture (friction before
spend) and ONLY once per submission (the contact route flips `diagnosisStatus` to `pending` in the same
write that captures the contact, so a duplicate contact post cannot start a second run). It is bounded
on three sides: `assertSeedWithinBudget({ tenantId: null })` is checked BEFORE any spend and a ceiling
degrades to `unavailable` with no model call; a failed or empty homepage fetch (`!ctx.ok`) degrades to
`unavailable` with no model call, so the cost ceiling is at most the single profile call; and the
contact endpoint, the only endpoint that can trigger a billed call, carries the tightest per-IP rate
limit (5 per minute) stacked on top of the budget governor. Every model-generated profile field is
passed through `stripDashes` before it is persisted, so a model that emits an en or em dash cannot push
a long dash into the database where the source guard cannot see it. The status machine is the honest
record: `pending` (set by the route) to `in_progress` to one of `ready`, `unavailable`, or `failed`.

## The route and the funnel

`routes/assessment.ts` mounts four public endpoints, each per-IP rate limited: `GET /questions` (the
score-withheld bank), `POST /submit` (validates the answers and qualification, computes the scores,
persists the submission, and returns the FREE on-screen result with no contact required),
`POST /submissions/:id/contact` (captures the contact, mints the forwardable token, attempts a
best-effort email, triggers the bounded diagnosis once when a company url was supplied, and ALWAYS
returns the link regardless of the email outcome), and `GET /report/:token` (resolves the token and
assembles the forwardable report, returning a uniform 404 for an expired, revoked or unknown token).
The email seam (`email.ts`) is "available, not connected" by default, mirroring the notifier transport
selection, so an unconfigured environment returns `not_connected` and the link still works.

## The portal flow

The portal adds a framework-free `lib/assessmentApi.ts` with the mirrored types and honest discriminated
outcomes, an `AssessmentPage` (`/assess`) carrying the question flow, the free on-screen result, the
contact-capture step, and the share, print and CTA actions, and an `AssessmentReportPage` (`/a/:token`)
that resolves a forwarded token to the full report with provenance pills and the four honest data states
(loading, empty, error, ready), including a `DiagnosisPanel` that renders each diagnosis status
honestly. A scoped print stylesheet (`styles/assessmentPrint.css`, `@media print` scoped under
`.assessment-report`, hiding `.no-print`) makes the report cleanly printable without touching the global
design tokens.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; the portal build at 1778 modules and
  the api-server bundle clean).
- The full suite is green at 1213 tests with zero failures: api-server 690 across 87 files (up from 664
  across 83, the +26 being the new assessment coverage: scoring 11, shareTokens 5, email 4, and the
  funnel integration test 6), portal 327, cortex 111, connectors 63, edge-agent 10, db 8, scripts 4
  (the source guard `scripts/emDashGuard.test.ts` is in the suite). The funnel integration test proves
  the questions are returned with the option scores withheld, that a strong answer set scores high and
  flips the narrative while a blind set scores low and maps to layers, that a malformed submission is a
  400, that a captured contact mints a token whose report resolves, that an unknown token is a 404, and
  that the optional diagnosis bounds itself: pointed at a non-resolving host it degrades to
  `unavailable` with NO model spend.
- Long-dash sweep zero on both sides: the source guard is green over authored source including this
  Phase AT Markdown, and a fresh database-wide row-cast over all 194 public text and jsonb columns
  across 46 tables (now including `assessment_submissions` and `assessment_share_tokens`) reports zero
  hits. The persisted model-generated profile fields are `stripDashes`-cleaned at the write boundary, so
  the diagnosis path cannot smuggle a long dash into the database.
- Zero new npm dependencies: the scoring is pure TypeScript, the diagnosis reuses the existing cortex
  primitives over the existing seams, and the print stylesheet is plain CSS.

## Honest marking

What is PROVEN here: that the workspace typechecks and builds with the new funnel, that the full
automated suite stays green including the new deterministic scoring unit tests and the end-to-end funnel
integration test, that the long-dash sweep is zero across source and data, that the scoring is honest
(a strong operation passes and the narrative flips, proven by test, never an instrument that fails
everyone), and that the optional diagnosis is genuinely bounded (the degrade-to-unavailable-with-no-spend
path is exercised against a non-resolving host in the integration test). The cost framing is qualitative
and derived only from the prospect's own inputs; it states plainly that it will not invent a figure, and
no fabricated number is ever shown.

What is the accepted boundary (logged drift): the bounded diagnosis's SUCCESSFUL `ready` path (a real
homepage fetch plus a real billed `runProfile` call) is not exercised by the automated suite, because a
green run must not make a paid model call or reach the public internet; the integration test deliberately
drives the no-spend degrade path instead, and the `ready` path is the same `runProfile` primitive already
proven under live seeds in Phases C and F. The forwardable report's visual print fidelity is handled by
construction (a scoped `@media print` stylesheet) and smoke-tested, not asserted cross-browser.

Nothing is fabricated: every dimension score, band, gap layer and cost line is computed from the
prospect's own persisted answers or the canonical layer registry, the diagnosis is read honestly from
its status (an in-progress, unavailable or failed taste reads as such, never as a fabricated result),
and a link that has not been opened shows null and zero rather than an invented access figure.

## Logged drift and deviations

- The bounded diagnosis's successful `ready` path is not covered by the automated suite (a green run
  makes no paid model call and reaches no external network); the integration test covers the no-spend
  degrade-to-unavailable path, and the `ready` path reuses the `runProfile` primitive already proven
  under the live seeds of Phases C and F.
- The diagnosis is fire-and-forget from the contact route (void-fired, never awaited) so the contact
  response stays fast; its result is read later through the report's status, which is the honest record
  of an asynchronous bounded job. This is the same pattern the scheduled loops use, scoped to a single
  run rather than a timer.
- The four additive registrations (two schema barrel exports, one app mount line, two portal route
  branches) are the unavoidable minimum to register a new table, a new public router, and two new
  routes; every prior phase that added a table or a surface did the same.

## Gate

Phase AT passed its architect `evaluate_task` review. The hard constraints hold: zero new dependencies,
ASCII hyphen only in source and data, no fabricated figure (the cost framing is qualitative and the
diagnosis is read honestly from its status), British UI copy with American data-contract identifiers
(the dimension keys, option keys, layer keys, and enum values are verbatim American), the on-screen
result is free with only the forwardable download gated on contact, and the optional diagnosis never
creates a tenant and is bounded by budget, rate limit, and graceful degradation. The drift index, the
rollup, and the V2 build report advance to "A through AT". Phase AT is gated but not a milestone.
