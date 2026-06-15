# Phase AB: sellability pack

Phase id: AB. Name: Sellability Pack. Milestone: no. The fourth phase of the
owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC), which pauses at the Stage 4/5
boundary for owner review (before Phase AD); the next protocol MILESTONE hard stop is AI at
the end of Stage 5. Phase AB turns a finished diagnosis into a sales surface: a provider can
mint a read-only, summary-only shareable link that a cold prospect opens with no account; the
public diagnosis carries anonymized, segment-level social proof drawn from the real Phase W
outcome loop, plus a viral "powered by" mark and path back to the product; and the narrate
stage now carries a deterministic editorial voice-quality measurement recorded honestly
alongside the content. It added zero npm dependencies and contains no em-dash or en-dash in
source or in data.

The selling surface is additive and read-only: it never rewrites a diagnosis, never exposes a
client's raw data or provenance, and never reveals an identity. A share is a fenced, expiring
view of one tenant's board-pack-level read; a case study is a distribution over a cohort, never
a named company.

## What was built

New schema (`lib/db/src/schema/diagnosisShareTokens.ts`, one table, one enum):

- `diagnosis_share_tokens` is one read-only share of one tenant's diagnosis: the tenant, the
  sha256 `tokenHash` (never the plaintext token), the `privacyLevel` enum
  `diagnosis_share_privacy` (`summary_only`), the optional creator and label, the `expiresAt`,
  an optional `revokedAt`, and real access telemetry (`accessCount`, `lastAccessedAt`). The
  plaintext token is 32 bytes of CSPRNG entropy rendered base64url and is returned to the
  minter exactly ONCE; only its hash ever touches a column, so a database read can never
  reconstruct a working link.

The share-token data layer (`artifacts/api-server/src/lib/sellability/shareTokens.ts`):

- `mintShareToken` generates the token, stores only the hash, clamps the requested lifetime into
  a 1-to-365-day band (default 30), and returns the metadata plus the one-time plaintext and the
  relative portal path `/d/<token>`. `listShareTokens` returns a tenant's shares newest first as
  metadata only (never the token, never the hash), each with a status derived from its real
  columns (`revoked` if revoked, `expired` if elapsed, else `active`). `revokeShareToken` is an
  idempotent early revoke that never moves an original revocation time and returns null (a 404)
  for an id outside the tenant. `resolveShareToken` hashes the presented token, loads the one
  unexpired, unrevoked row, records real access telemetry, and returns only the tenant id and
  privacy posture; a non-match (unknown, expired, or revoked) is indistinguishable, which keeps
  the public 404 uniform.

The case-study builder (`artifacts/api-server/src/lib/sellability/caseStudies.ts`):

- A case study is a DISTRIBUTION over a cohort of opted-in tenants in one segment, never a named
  company and never a single company's figure. It reuses the EXACT Phase X privacy machinery:
  the same k-anonymity floor (`getBenchmarkMinCohort`) hard-gates whether a segment is published
  at all, and the same bounded noise (`applyNoise` within the `noiseBand`) blurs a small cohort's
  quartiles, with an honest `noised` flag on the output. The per-tenant outcome math is the same
  `computeOutcomeSummary` the `/outcomes` endpoint uses, so a case study can never disagree with
  the counter; only a tenant with at least one resolved outcome (a real track record) contributes.
  No tenant id, name, url, or date ever appears in the output. `loadCaseStudyForTenant` returns
  the single published study for one tenant's own segment (or null), which is the social-proof
  block on the public diagnosis.

Editorial voice quality (`lib/cortex/src/quality/voice.ts`):

- `evaluateNarrativeVoice` is a deterministic, side-effect-free MEASUREMENT of an assembled
  layer's prose against a fixed editorial bar (seven genuine checks: sentence length in a human
  band, no marketing hype, no first-person consultant voice, numeric specificity, has proof,
  names a gap, no long dash). It reports a 0-to-100 score, a band (strong / adequate / weak), and
  per-check detail, and it never rewrites a single character. Rewriting the prose to "pass" would
  be fabricating output, so the orchestrator records the report on the layer row
  (`tenant_layers.voice_quality`) and a below-bar layer is shown with its real lower band, not
  silently corrected.

The HTTP surface:

- Authed provider/owner routes (`artifacts/api-server/src/routes/sellability.ts`, mounted at
  `/api` under `requireAuth`): `POST /tenants/:id/share-tokens` (mint), `GET /tenants/:id/share-tokens`
  (list), `POST /tenants/:id/share-tokens/:tokenId/revoke` (revoke), and `GET /case-studies`
  (the published case studies). Each route requires a provider seat (and the tenant routes
  per-tenant access), since minting, revoking, listing, and reading case studies are provider-side
  selling actions, never a client or portfolio concern.
- The ONLY unauthenticated data surface (`artifacts/api-server/src/routes/public.ts`, mounted at
  `/api/public`): `GET /diagnosis/:token` resolves the token through the share-token middleware
  (`requireDiagnosisShareToken`), loads the tenant overview, narrows each layer through
  `toPublicDiagnosisLayer` (which strips `ownerPersona`, `diagnosticQuestion`, and `feeds`), and
  returns the public layers, the tenant's case study, and the constant powered-by mark. A tight
  per-IP rate limit blunts scraping.

Portal (`artifacts/portal/`):

- `App.tsx` now renders a `Root()` that matches `/d/:token` and mounts `PublicDiagnosisPage`
  OUTSIDE the `AuthProvider`, so a cold prospect never triggers an auth probe or sees the sign-in
  gate; every other path runs through the authenticated shell unchanged.
- `PublicDiagnosisPage.tsx` is a standalone, scroll-owning page with its own chrome and honest,
  distinct loading / ready / empty / unavailable / error states. It renders the public layer
  cards (finding, leading figure, narrative, recommended move, honest blind spot), the
  anonymized case-study card, and the powered-by mark.
- The Board Pack gains a provider-only `ShareLinks` panel (`BoardPackPage.tsx`): create a link,
  copy the full URL exactly once (it is shown once and never retrievable again), and see the
  existing links as metadata only (status pill, real view count, expiry) with an early Revoke on
  an active link, plus honest action-error text.
- `lib/sellabilityApi.ts` and `lib/publicApi.ts` are framework-free clients returning typed
  discriminated outcomes; `types.ts` carries the share, case-study, and public-diagnosis shapes,
  with `PublicDiagnosisLayer` defined as `Omit<OverviewLayer, "ownerPersona" | "diagnosticQuestion" | "feeds">`
  so the public projection is enforced in the type, not just at runtime.

## Acceptance evidence

- Instant self-serve shareable diagnosis: a cold, unauthenticated URL (`/d/:token`) renders the
  read-only diagnosis with no session; the page is mounted outside the auth provider so it never
  blocks on an auth probe, and the token resolves through a single hash-based lookup.
- Shareable read-only link with privacy controls: a provider mints a `summary_only` link whose
  plaintext token is shown exactly once; lists are metadata only; expiry is clamped to a sane band
  and an early revoke is idempotent; the public projection strips the internal owner persona,
  diagnostic question, and layer feed graph, and the public surface exposes no raw connector data
  or provenance.
- Case study without identity: a case study is published only for a segment with at least k
  distinct opted-in contributors that each have a resolved outcome, the quartiles are blurred when
  the cohort is below the noise band (flagged honestly), and no tenant id, name, url, or date is
  ever emitted; the math is the same outcome summary the counter uses.
- Board-pack viral hook: every public diagnosis carries the constant "Powered by Elevated
  Intelligence" mark with a path back to the product, and the provider panel states that the
  shared link carries it.
- Narrative meets the voice bar with drift confirming: the deterministic voice evaluator scores
  the assembled prose against seven editorial checks and is recorded on the layer; it measures and
  reports honestly rather than editing, so a below-bar layer is shown at its real band.

## Verification

- Typecheck green across all workspace projects (exit 0).
- Build green (exit 0; portal 1753 modules, api-server bundled).
- Full suite green at 758 tests: api-server 393 across 46 files (the new `shareTokens`,
  `caseStudies`, `overviewProjection`, and `redactRoute` tests, +16 over Phase AA's 377), portal
  225 across 18 files (the new `sellabilityApi` and `publicApi` tests, +21 over Phase AA's 204),
  cortex 89 (the new `voice` editorial-quality tests, +5 over Phase AA's 84), connectors 29,
  edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on BOTH sides: a fresh `rg` over the authored tree (lib, artifacts, docs,
  scripts, replit.md, .replit, .github) returns zero, and a database-wide cast over every public
  text and jsonb column (138 columns; Phase AB added the `diagnosis_share_tokens` text columns)
  reports zero dash hits.
- Zero new npm dependencies. The token is `node:crypto` `randomBytes`/`createHash`; the public
  page, clients, and routing are framework-free over the existing stack.

## Logged drift and deviations

- The voice-quality report is a backend measurement surfaced on the layer row, not a new portal
  panel. The portal `OverviewLayer` type intentionally omits the `voice` field, so the editorial
  check is satisfied by the cortex evaluator plus this drift record rather than a UI widget; a
  future surface could expose the per-check detail in the layer page. The measurement never edits
  the prose, so a below-bar narrative is reported honestly, never auto-corrected.
- `loadCaseStudyForTenant` recomputes the full case-study set on each public diagnosis hit rather
  than reading a materialized cache. This is correct and never stale, but at scale it is a
  performance consideration on the cold-link path; the architect noted it as non-blocking and it
  is accepted as logged drift until latency measurements show it violates the fast-link
  experience. A future refinement could cache the published studies with an honest freshness
  stamp.
- The public diagnosis is summary-only by design; the `diagnosis_share_privacy` enum carries only
  `summary_only` today. A richer privacy tier (for example a fuller read for a trusted recipient)
  is an additive enum value and projection, not built this phase.
- Token-scoped sharing is tenant-scoped: a link shares one tenant's whole board-pack-level
  diagnosis, not a single layer. A per-layer share is a later additive scope, recorded for
  completeness.

## Remediation iterations

- Architect `evaluate_task` (first pass): FAIL on one HIGH finding. The global unhandled-error
  handler attached `req.path` to the observability aggregator context, and for
  `GET /api/public/diagnosis/:token` the path contains the bearer share token itself, so a DB,
  lookup, or render failure deep in the public request could forward a live or attempted token to
  an external Sentry-compatible sink even though the database correctly stores only the hash.
- Fix applied: a single redaction chokepoint
  (`artifacts/api-server/src/lib/observability/redactRoute.ts`) collapses
  `/api/public/diagnosis/<bearer>` to the route template `/api/public/diagnosis/:token`, and the
  error handler now reports `redactRoute(req.path)`. A new regression test
  (`redactRoute.test.ts`, 4 tests) proves the token is collapsed to the template, the token
  substring never survives the redaction, the collection path with no token is unchanged, and
  unrelated routes are untouched. The chokepoint is the place to add any future secret-bearing URL
  pattern.
- Architect `evaluate_task` (re-review after the fix): PASS. The HIGH token-leak path is fully
  resolved; the public token path is hash-resolved, rate-limited, returns uniform 404s for
  invalid/expired/revoked tokens, and the known observability leak vector is redacted before any
  external reporting. The case-study recomputation note was confirmed as accepted non-blocking
  drift.

## Gate

Phase AB passed its architect `evaluate_task` review (PASS after one HIGH remediation: the public
share token is redacted from the observability route before capture, with a regression test). The
drift index, the rollup, and the V2 build report are updated to "A through AB". Phase AB is NOT a
milestone; per the owner-authorized Stage 4 run, execution continues to Phase AC (the Stage 4
verification and build-report close), after which the run PAUSES at the Stage 4/5 boundary for
owner review before Phase AD; the next protocol milestone hard stop is AI at the end of Stage 5.
