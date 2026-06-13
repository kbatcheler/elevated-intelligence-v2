# Phase G: Parity Gate and Core Build Report

Phase id: G. Name: Parity Gate and Core Build Report. Milestone: yes (hard stop for
owner review before Phase H).

The greenfield equivalent of the old regression contract. Every named V1 reference
surface is verified present and at or above parity in the new system, the Phase B
through F acceptance sets are re-verified, typecheck and build and the full test
suite are green, and the long-dash sweep is zero across code, copy, and data. The
core build report is written to `docs/build-report-core.md`. This phase added zero
npm dependencies and contains no em-dash or en-dash.

This report follows the protocol Section 4 outline. The gate surfaced one blocking
data-integrity gap (persisted pipeline-run sub-stage outputs were never sanitized
or swept) and one guard weakness (the source guard caught only the em-dash); both
are remediated and recorded in the Remediation iterations section, with the
affected drift items updated in place.

## Build summary

Phase G is a verification and reporting gate, not a feature build. The work was:

- **Parity inventory against the frozen reference.** The nine V1 running-behaviour
  surfaces named in the Core Master Prompt (boot splash, narrator voice,
  verified-versus-modelled pills, Morning Brief, Board Pack, Ask Different Day,
  scenario war room, anomaly inbox, dependency map) were each located in the V2
  portal and assessed against the frozen `reference/v1` source. All nine exist and
  meet or beat V1; the full table with V2 file paths is in `docs/build-report-core.md`.
- **Long-dash enforcement made complete (the gate's blocking find).** The hard rule
  is no em-dash (U+2014) or en-dash (U+2013) anywhere in code, copy, OR data. A
  deterministic sanitizer (`deepStripDashes` in `lib/cortex`) was wired into the
  orchestrator at every jsonb persist boundary so generated text is normalized at
  write time: the tenant profile, the assembled `tenant_layers` row, and, added this
  phase, the `tenant_pipeline_runs` sub-stage outputs and the run error column. The
  one-off `sanitize:dashes` script cleaned the pre-enforcement rows.
- **Source guard strengthened.** The authored-source guard previously detected only
  U+2014; it now also detects U+2013 and reports which dash it found. This is a
  strengthening of an existing check, not a weakening, and it is covered by a new
  unit test.
- **Full-suite, build, and database verification** at the gate (see below).

## Requirements checklist

- Every reference surface exists and works at equal or better quality. Done. The
  nine named surfaces are inventoried with V2 paths and verdicts in
  `docs/build-report-core.md`; all meet or beat V1. Three V1 extras outside the named
  set are deliberately not carried, logged below.
- Phase B through F acceptance sets re-verified. Done, by the green test suite plus
  the explicit acceptance checks rather than by the suite alone: the persisted
  four-tenant ready seed and its verifiably distinct figures, the database-wide dash
  sweep, and the `anchor:sweep` pass are acceptance evidence beyond unit tests, while
  the registry, the auth and fencing behaviour, the portal surfaces, and the queue
  and express-mode behaviour are covered by the suite.
- Typecheck, build, and the complete test suite green. Done. Typecheck clean; build
  green; 253 tests pass (scripts 4, cortex 48, db 8, portal 108, api-server 85).
- Em-dash sweep zero across code, copy, and data. Done after remediation. The
  strengthened source guard is zero; the database-wide sweep is zero across all
  fifteen tables, including `tenant_pipeline_runs`.
- `docs/build-report-core.md` written. Done, covering what was built, every decision
  defaulted, the seed timings, the parity comparison, and the deferrals.

## Drift items

Category sweep first, then the specific items. Every item below is acceptable
drift; the one blocking find is remediated and recorded as such.

- Faked, stubbed, scripted, or hardcoded output where real output was required:
  none. No new generation happened in this phase; the existing cortex, Confounder,
  and telemetry remain the live, per-tenant output proven in Phases C and F.
- Renamed tables, substituted libraries, or restructured layout to route around a
  problem: none. The sanitizer is a new pure function; no table or library changed.
- Weakened checks to pass the gate: none. The source guard was strengthened to catch
  the en-dash as well as the em-dash, and no existing assertion was relaxed.
- Scope added beyond the phase ask: the persist-boundary sanitization of
  `tenant_pipeline_runs` and the guard strengthening, both logged below as the
  remediation of a real gap, not silent additions.
- Silent assumptions or defaults: none silent. The normalization mapping and the
  parity verification method are both stated below.

Specific items:

- [blocking, remediated] Persisted pipeline-run sub-stage outputs carried long
  dashes and were never swept. The orchestrator persists each stage's raw model
  output into `tenant_pipeline_runs.sub_stages` (the reasoning strip reads it back).
  The earlier data sweep checked the tenant and layer tables but not the run table,
  so a gate sweep found em-dash and en-dash characters in 39 of the run rows while
  every other table was clean. Remediated: `deepStripDashes` now sanitizes the
  sub-stage write and the run error write at the persist boundary, the
  `sanitize:dashes` script was extended to clean the run table (and `pipeline_jobs`),
  it cleaned the 39 rows, and the database-wide sweep is now zero everywhere. The
  source-only guard could never have caught this, because the dashes are
  model-generated data that exists only after a write, not authored source.
- [acceptable] Long-dash normalization is deliberate canonicalization, not
  byte-for-byte preservation. The em-dash becomes a spaced ASCII hyphen and the
  en-dash becomes a plain ASCII hyphen (so numeric ranges stay readable); numbers,
  booleans, null, and model identifiers are untouched. For an exact quotation or a
  proper name that genuinely contained a long dash this is a canonicalization
  required by the typography rule, not semantic loss. No tenant figure or claim
  meaning changes.
- [acceptable] Parity verified at the code and component level, not a live
  two-instance dual-deploy. The Core Master Prompt's words are to run V1 and the new
  system side by side. The verification done is a component-by-component inventory
  against the frozen `reference/v1` source plus the full automated suite and the
  Phase E side-by-side acceptance already recorded in `phase-E.md`. This is honest
  milestone evidence of parity; it is not a synchronized screenshot diff of two
  running instances, and the owner secrets and live-seed cost make that neither
  necessary nor honest to claim. Logged so the method is explicit.
- [acceptable] Three V1 extras deliberately not carried over: the company picker and
  library mode, the coachmark tour, and the signal ticker. None is in the named
  reference-surface set (line 19) and none is a Phase B through F acceptance item, so
  each is a scope decision rather than a parity miss, available to add later.

## Decisions taken

- Sanitize at the persist boundary, not only in the generation prompt. The prompts
  instruct the models to avoid the long dash, but a deterministic post-generation
  pass is the only guarantee, so every jsonb sink the orchestrator writes is
  normalized. Em-dash to spaced ASCII hyphen, en-dash to plain ASCII hyphen.
- Strengthen the existing source guard rather than add a parallel one. Catching both
  long dashes in one guard, with the dash kind reported, keeps a single source of
  truth and is a transparent strengthening.
- State the parity method precisely in the build report. Code and component-level
  parity against the frozen reference plus the automated suite and the Phase E
  side-by-side, with the non-live dual-deploy logged as accepted drift.

## Test and verification summary

- Typecheck: clean across the workspace.
- Build: green. Portal builds; api-server bundles to `dist/index.mjs`.
- Tests: 253 pass. scripts 4 (including the new en-dash detection case), cortex 48
  (including the six dash-sanitizer cases), db 8, portal 108, api-server 85.
- Long-dash sweep, source: the strengthened guard reports zero across `lib`,
  `artifacts`, `docs`, and `scripts`.
- Long-dash sweep, data: zero across all fifteen tables (tenant_layers,
  tenant_profile, tenant_artifacts, tenants, layers, tenant_pipeline_runs,
  pipeline_jobs, tenant_layer_config, committed_actions, claim_broken_reports,
  access_grants, users, orgs, org_tenants, invite_pins), after cleaning 39
  tenant_pipeline_runs rows.
- Anchor sweep: passes (exit 0) against the four ready tenants; no tenant pair and no
  broadcast figure shows a templating signature.

## Remediation iterations

- Iteration 1 (architect evaluate_task review, verdict Pass with fixes; all applied).
  The architect's review of the first-pass remediation (which had sanitized only the
  tenant profile and the `tenant_layers` row) named the real gap and the guard
  weakness: `tenant_pipeline_runs.sub_stages` persists raw model output before the
  sanitized layer row is written and was neither sanitized nor swept, so the
  "data sweep zero" claim was partial; and the source guard detected only U+2014
  while the rule forbids U+2013 too. Both were fixed: the sub-stage and run-error
  writes are now sanitized at the persist boundary, the cleanup script and the
  database-wide sweep were extended to the run table and `pipeline_jobs`, the 39
  contaminated run rows were cleaned to zero, and the source guard now catches both
  long dashes with a new unit test. The architect also confirmed the normalization
  is defensible (log it as canonicalization) and that stating the parity method
  honestly is the right call; both are reflected in the drift items above.

## Verdict

Pass with noted acceptable drift. All gate conditions hold: every named V1
reference surface is met or beaten, the Phase B through F acceptance sets pass,
typecheck and build and the full suite are green, and the long-dash sweep is zero
across code, copy, and data including the previously missed run table. The one
blocking find (unsanitized persisted sub-stage outputs) is remediated; no blocking
drift remains.

## Milestone marker

Phase G is a milestone hard-stop. Execution pauses here for owner review before
Phase H. Passing this gate means the new system may replace V1 as the reference;
V1 stays deployed and frozen until the owner retires it. Do not auto-advance.
