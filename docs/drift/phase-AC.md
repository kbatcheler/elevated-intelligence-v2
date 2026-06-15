# Phase AC: verification and the build-report append (closes Stage 4)

Phase id: AC. Name: Verification and the build-report append. Milestone: no (gated; the closing
phase of Stage 4, Differentiation and Moat, run back to back with Y, Z, AA, and AB under owner
authorization, pausing at the Stage 4/5 boundary before Phase AD). This phase built no product
feature and changed no product code; like Phase M closed Stage 2 and Phase V closed Stage 3, its
only artifacts are this evidence matrix, the build-report append, and the drift updates. It added
zero npm dependencies and contains no em-dash or en-dash in source or in data.

Approach: each acceptance criterion of the Stage 4 phases (Y portfolio intelligence, Z proactive
push, AA interactive challenge, AB sellability pack) is mapped to the EXISTING evidence built and
tested across those phases, with the proof type marked honestly (proven by the integration suite
against live Postgres, proven by a deterministic unit test, or an adapter that is
available-not-connected unless its env is set). The global gates (typecheck, build, the full test
suite, the source dash guard, the database-wide dash sweep) were re-run fresh for this phase and the
totals below are from that run.

## The Stage 4 evidence matrix

1. Typecheck, build, and the test suite all pass, in CI. MET (integration; hosted CI is a standing
   logged drift). Fresh run: typecheck green across all workspace projects, build green (portal 1753
   modules, api-server bundled), full suite green at 758 tests. CI is defined in
   `.github/workflows/ci.yml` (Phase R) as separate required typecheck, build, and test steps that
   block the merge on any nonzero exit; the hosted runner cannot execute inside this environment, so
   the same steps run locally and pass, which is the same evidence the hosted job would produce
   (recurring environmental drift since Phase B).

2. The value counters reconcile and a case study can never disagree with the outcome counter. MET
   (deterministic math test-proven; the shared compute path source-reviewed). The outcome math
   itself is proven by `lib/outcomes/outcomeMath.test.ts` and `lib/outcomes/predictedValue.test.ts`,
   and the case-study AGGREGATION (the k-anonymity floor, the bounded noise band, the identity-free
   quartiles) by `lib/sellability/caseStudies.test.ts`, which drives `buildCaseStudies` over prebuilt
   contributions. The reason a published case study can never disagree with the outcome counter is
   that the case-study LOADER (`caseStudies.ts`) calls the SAME `computeOutcomeSummary` the
   `/outcomes` endpoint uses; that reuse is verified by source inspection, NOT by a dedicated
   end-to-end test, because the loader test feeds prebuilt contributions rather than re-deriving them
   from a live outcome set. The portal outcome surface is proven by `lib/outcomeApi.test.ts`. The
   realized-value figures themselves are written by the Phase W outcome loop; this phase recomputed
   them, it did not fabricate any.

3. Benchmark privacy holds: a published cohort never exposes a raw value or an identity, and a small
   cohort is suppressed or blurred. MET (integration plus deterministic math). The k-anonymity floor
   (`BENCHMARK_MIN_COHORT`) suppresses any cohort too small to hide an individual and the bounded
   noise band blurs a borderline cohort with a disclosed `noised` flag, proven by
   `lib/benchmarks/benchmarkMath.test.ts`; the recompute reads decrypted scalar signals through the
   machine grounding read, skips and counts an unreadable tenant, and writes only identity-free
   distributions, proven by `lib/benchmarks/benchmarks.integration.test.ts` and the owner-only routes
   by `routes/benchmarks.integration.test.ts`; the portal consent and band surface by
   `lib/securityApi.test.ts`. Consent is default off.

4. A portfolio user is fenced to the bound tenants and sees a 403 on any tenant outside the
   portfolio. MET (integration). The ranked multi-tenant board, the value-at-risk and identified
   versus realized rollups, the overall confidence, and the open-gap counts are computed from
   persisted state by `lib/portfolio/portfolioMath.test.ts`, and the access fence (only bound
   tenants visible, 403 on any tenant outside the portfolio, the cross-portfolio gap patterns) is
   proven end to end by `routes/portfolio.integration.test.ts` against live Postgres.

5. A material threshold breach produces a ranked digest to the chosen channel, low-impact signal is
   suppressed, and a user can tune or mute without losing high signal. MET (integration; external
   sinks available-not-connected unless env is set). The ranking by predicted dollar impact and
   confidence and the low-impact suppression are proven by `lib/push/pushMath.test.ts`; the per-seat
   rules, the read-state and mute, the Morning Brief drain delivered exactly once, and the
   access-revoked event failed in place are proven by `routes/push.integration.test.ts`; the portal
   notification center by `lib/pushApi.test.ts`. With no Slack or webhook env the digest delivers to
   the honest log sink and never fabricates a delivery.

6. A challenge re-runs the reasoning and either upholds or revises, it can never unilaterally delete
   a finding, and every exchange is logged and auditable with the revised basis shown. MET (the route
   boundary and the finding-version helpers test-proven; the re-reason engine itself source-reviewed).
   Test-proven: the finding-addressing helpers that bind a challenge to a specific finding VERSION
   (`parseFindingRef`, `extractFinding`, `canonicalFindingText`, `findingHash`, and `currentFindingHash`,
   including that the hash changes when the finding's content changes) by
   `lib/challenge/findingChallenge.test.ts`; the route boundary (tenant fencing, the read-only
   client-viewer seat refused a spend, a malformed ref or a blank or over-long challenge rejected
   before any model call, auth required to read the history, and an honest empty history) by the Phase
   AA challenge-route block in `routes/tenants.integration.test.ts`; and the portal challenge control
   and per-finding history by `lib/challengeApi.test.ts`. Source-reviewed, NOT covered by an automated
   test: the `runFindingChallenge` engine that re-reasons through the Confounder and Synthesist seats
   and returns uphold (with reasoning), revise (a new confidence and a `modelled_user_informed`
   basis), or an honest `failed` row, the rule that a revise re-bases the challenge ROW only and never
   the stored layer content, and the single hash-chained provenance append on a completed challenge.
   That path spends real billed model calls the suite deliberately does not run (the same posture
   Phase V took toward live paid seeds), so it is verified by reading the code; the coverage gap is
   logged as accepted drift below.

7. A cold URL resolves a shareable read-only diagnosis fast, the public projection leaks no internal
   field, the case study carries no identity, the board pack shows the viral mark, and the narrative
   is measured against the voice bar. MET (the projection, redaction, helpers, aggregation, and voice
   measurement test-proven; the token mint and the public route source-reviewed). Test-proven: the
   share-token one-way hash (the persisted value is the sha256 digest and never the plaintext), the
   1-to-365-day lifetime clamp, and the status helper, by `lib/sellability/shareTokens.test.ts`; the
   public projection `Omit` that strips the owner persona, the diagnostic question, and the layer feed
   graph in the type AND at runtime, by `lib/overview/overviewProjection.test.ts`; the redaction
   chokepoint that collapses the bearer path to its route template so a token can never reach an
   external observability sink, by `lib/observability/redactRoute.test.ts`; the anonymized,
   k-anonymized case-study aggregation, by `lib/sellability/caseStudies.test.ts`; the deterministic
   editorial voice MEASUREMENT (seven genuine checks, a 0-to-100 score and band, identical output for
   identical input, never an edit), by `lib/cortex/src/quality/voice.test.ts` (wired into the narrate
   stage in the orchestrator and stored on `tenant_layers`); and the portal public page honest ready,
   unavailable, and error states and the provider-only share panel, by `lib/publicApi.test.ts` and
   `lib/sellabilityApi.test.ts`. Source-reviewed, NOT covered by a server integration test: the
   32-byte CSPRNG token mint that returns the plaintext EXACTLY ONCE and persists only the hash, the
   list that omits the token and the hash, the resolve that records access telemetry and returns a
   uniform 404 on a non-match, and the unauthenticated `GET /api/public/diagnosis/:token` route end to
   end (there is no `routes/public` or `routes/sellability` integration test). The portal public page
   is mounted OUTSIDE the auth provider so a cold prospect never triggers an auth probe; the coverage
   gap is logged as accepted drift below.

8. The regression contract holds: every load-bearing invariant from Phases A through AB still has a
   test and the suite was not weakened to pass. MET (integration; no test was broken or relaxed to
   verify this phase). The carried-forward invariants all still pass: the DerivedSignalSet guard, the
   connector and edge-agent no-db-handle no-`node:fs` import boundary, the four PIN failure modes and
   owner gating, the session cookie, the append-only ledger with broken-chain detection, the
   no-secret-value sweep over every public column plus `.replit`, the long-dash source guard, and
   prompt hygiene. Each was demonstrated to bite on a tampered or synthetic input in its own phase;
   this phase did not re-break them. The new Stage 4 surfaces added their own tests rather than
   editing an older assertion.

9. The em-dash sweep returns zero hits in user-facing prose and in data. MET (freshly re-run, both
   sides). The source guard (`scripts/emDashGuard.test.ts`) is green over authored source, including
   the Phase AB and AC drift and build-report Markdown written this stage, and a fresh database-wide
   cast over every public text and jsonb column (37 public tables, 138 text and jsonb columns,
   including the `diagnosis_share_tokens` text columns) reports zero hits.

10. Append to `docs/build-report-v2.md`. MET. The consolidated Phase AC section records the Stage 4
    tables, enums, and routes, the privacy reuse, the share-token and voice-measurement choices, the
    fresh gate totals, and the Stage 4/5 pause.

## Honest integration-versus-deterministic marking

Most Stage 4 acceptance criteria are proven by the integration suite running the real application
against live Postgres (the portfolio access fence, the push drain and revocation, the challenge route
boundary, the benchmark recompute and routes), or by deterministic unit tests over pure functions
(the portfolio and push and benchmark and outcome math, the voice measurement, the share-token
status and clamp, the public projection, the route redaction, the case-study k-anonymized
aggregation). A third class is honestly marked source-reviewed rather than test-proven: the challenge
re-reason engine (`runFindingChallenge`) and the share-token mint and resolve and the unauthenticated
public cold-URL route are verified by reading the code, because the first spends real billed
Confounder and Synthesist model calls the suite deliberately does not run and the second and third
have no dedicated `routes/public` or `routes/sellability` integration test; this coverage gap is the
one accepted LOW logged for Phase AC, below. Two further boundaries are honestly not "live" here and
are marked as such: the external push sinks (Slack, generic webhook) and the durable secret and
archive backends remain available-not-connected unless their env is configured, so they are verified
as honest adapters rather than live deliveries; and the realized-value and benchmark figures were
produced by earlier real runs and recomputed here, not generated by a fresh paid model seed. No
figure in any Stage 4 surface is fabricated: a value is computed from persisted state or it is not
shown.

## Verification

- Typecheck and build green across the workspace (exit 0 on both).
- Full suite green at 758 tests (api-server 393 across 46 files, portal 225 across 18 files, cortex
  89, connectors 29, edge-agent 10, db 8, scripts 4). This phase added no tests and changed no
  product code.
- Long-dash sweep zero on both sides: the source guard is green, and a fresh database-wide cast over
  all 138 public text and jsonb columns across 37 tables reports zero hits.
- Zero new npm dependencies.

## Logged drift and deviations

- Phase AC is verification and documentation only; it built no product code, matching how Phase M
  closed Stage 2 and Phase V closed Stage 3. Where re-running a check would have been destructive or
  paid (breaking an invariant test on purpose, running a fresh paid model seed), the existing
  in-phase evidence is cited instead and the proof type is marked.
- Hosted CI cannot execute in this environment; the CI workflow's steps run locally and pass
  (recurring environmental drift since Phase B).
- The Stage 4 still-live item carried into the rollup is the per-hit recompute of a tenant case study
  on the public cold-link path (AB), correct and never stale but a latency consideration at scale; it
  is logged, not yet built, and the architect marked it non-blocking.
- The AC verification surfaced one accepted LOW (a test-coverage gap, not a defect): several Stage 4
  write and IO paths are proven by source inspection, not by an automated test. The challenge
  re-reason engine `runFindingChallenge` spends real Confounder and Synthesist model calls the suite
  deliberately does not run; the share-token mint, list, and resolve and the unauthenticated
  `GET /api/public/diagnosis/:token` route have no `routes/public` or `routes/sellability` integration
  test. The pure helpers (the finding-version hashing, the token hash and clamp and status, the public
  projection, the route redaction), the challenge route boundary and rejection cases, and the portal
  clients around these paths ARE tested. The architect marked the gap non-blocking; a future phase can
  close it with an injected-model challenge test and a public-route integration test. Logged as
  accepted drift and carried into the rollup.

## Gate

Phase AC passed its architect `evaluate_task` review (PASS). The drift index, the rollup, and the V2
build report are updated to "A through AC". Phase AC closes Stage 4 (Differentiation and Moat). Per
the owner-authorized Y-Z-AA-AB-AC run, the build now PAUSES at the Stage 4/5 boundary for owner
review before Phase AD; it does not auto-advance. The next protocol MILESTONE hard stop is Phase AI
at the end of Stage 5.
