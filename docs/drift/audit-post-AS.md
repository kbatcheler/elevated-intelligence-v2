# Post-AS reconciliation (2026-06-23)

A pre-AT quality and drift reconciliation, run on owner request before opening the next
lettered phase. It mints no phase and advances no gate: Phase AS remains the last gated
phase and the close of the Robustness and Magic wave. Its purpose is to bring the drift
ledger back into step with the working tree, which had moved nine substantive commits past
the recorded "A through AS" without a per-phase drift record, and to state honestly the two
elements that may cause issues before the build resumes.

## Why this record exists

The hard constraint in `replit.md` is a per-phase drift protocol with `docs/drift/INDEX.md`
as the single source of truth for build progress. After Phase AS closed (commit `7d2d53c`),
nine substantive commits merged through the task queue (range `7d2d53c..ac98ef4`, 28 files,
1669 insertions, 23 deletions). None updated `INDEX.md`, `rollup.md`, or
`docs/build-report-v2.md`, all of which still read "A through AS", and the recorded suite
total (1179) no longer matched the tree (1187). The only document added was the standalone
`docs/portal-a11y-audit.md`, which was never wired into the protocol. The ledger was
therefore stale relative to the code. This record reconciles it, following the same
not-a-new-phase convention as `docs/drift/audit-post-AN.md`.

## Scope: the post-AS merges

Grouped by surface (commit range `7d2d53c..ac98ef4`):

- Test isolation and reliability (test infrastructure only, no product runtime change):
  per-vitest-worker isolated databases created from a template clone in `globalSetup`, a
  marker-based orphan-row purge with an FK-ordered sweep and a CLI plus a SET-NULL telemetry
  cleanup, a guard test asserting the worker URL is a `_test_w<N>` clone and never the live
  dev database, the api-server DB-contention fix (files run sequentially against the one
  shared dev Postgres), and a 375px horizontal-overflow regression guard for the portal
  surfaces. The new api-server test files are `testDb.test.ts` (4), `portalOverflow`
  integration (3), and `purgeTestData` integration (1), which is the full +8 over AS.
- One shared-library test-only change: `lib/db/src/index.ts` raises the pool
  `connectionTimeoutMillis` to 20s under `VITEST` only; the production default stays 10s and
  `DATABASE_POOL_CONNECT_TIMEOUT_MS` still wins in both. Verified VITEST-gated.
- Product UI (portal, responsive and accessibility): the notification-bell hit target
  enlarged to 32x32, small-phone admin and navigation tweaks, and related token and layout
  adjustments. CSS and markup only.
- Product runtime (api-server): `GET /notifications` no longer materialises default push
  rules on the read path; the comment and the code confirm it is now a pure read. Default
  rules are still materialised by the scheduled evaluator (platform-wide, where events are
  minted) and lazily by `GET /rules` when the tuning surface is opened, so nothing the
  notification centre shows depends on a rule row existing. Behaviour is preserved; the only
  effect is that opening the centre no longer rewrites one rule row per reachable tenant, so
  its cost no longer grows with the client base.
- Cortex model: the `grounder` seat in `lib/cortex/src/config.ts` moved from
  `gemini-2.5-pro` to `gemini-3.1-pro-preview`. See the risk section.
- Tooling: a `scripts/post-merge.sh` reconciliation hook plus a `.replit` `[postMerge]`
  block (180s timeout). Benign, runs only after a task merge.
- Documentation: `docs/portal-a11y-audit.md` (new, standalone).

## Quality gate (fresh, on HEAD `ac98ef4`)

Run through the configured workflows, not ad hoc commands, then read the flushed logs.

- typecheck: PASS (exit 0; api-server, edge-agent, portal, scripts, plus the library
  project references via `tsc --build`).
- build: PASS (exit 0; portal vite build at 1773 modules, api-server bundle).
- test: PASS. Full suite green at 1187 tests across all seven packages: api-server 664 over
  83 files, portal 327, cortex 111, connectors 63, edge-agent 10, db 8, scripts 4. This is
  +8 over the AS total of 1179, all of it the new api-server test infrastructure.
- Zero new npm dependencies (the merges add a `package.json` script and test infrastructure,
  no runtime dependency).

## Two-sided long-dash sweep (zero on both sides)

- Source guard: `findLongDashViolations` over the authored source reports 0 violations.
- Database-wide: a fresh row-cast over all 185 public text and jsonb columns (en-dash
  U+2013 and em-dash U+2014) returns 0 hits. The sweep is computed entirely server-side
  (a single summed UNION ALL over every column) to avoid client-side parsing of the
  executeSql text output.

## Product-code changes verified safe

- `GET /notifications`: behaviour preserved, an optimisation only, as above.
- The push evaluator read-first default-rule materialisation keeps its `ON CONFLICT` guard,
  so a concurrent insert is still safe.
- `lib/db` connect timeout: VITEST-gated, the production path is unchanged.
- Portal UI: CSS and markup only, covered by the new 375px overflow guard.
- `.replit` `[postMerge]` and `scripts/post-merge.sh`: tooling, runs only after a merge.

## Elements that may cause issues (logged drift)

1. The grounder seat now runs a PREVIEW model (`gemini-3.1-pro-preview`) on the live cortex
   grounding path. It was swapped outside the per-phase protocol and is not verified against
   the live Gemini API, because the cortex suite makes no live model calls. A preview model
   can be rate-limited, renamed, or withdrawn, and the published list-price defaults in
   `lib/cortex/src/pricing.ts` (keyed by seat, so cost attribution still works) may not match
   a preview model's real price. Recommended before any paid seed or live demo: confirm the
   model id resolves on the live API, confirm the price, and consider pinning to a generally
   available model id.
2. The ambient `DATABASE_URL` is a destructive-operation target with no
   refuse-on-production guard. Two paths share this risk class. The per-worker test
   isolation issues `CREATE DATABASE ... TEMPLATE` through the psql binary in `globalSetup`;
   the new guard test asserts the worker URL is a `_test_w<N>` clone, but nothing PREVENTS
   `pnpm test` from running against a production `DATABASE_URL` and creating databases there.
   Separately, the `.replit` `[postMerge]` hook runs `scripts/post-merge.sh`, which issues
   `pnpm --filter @workspace/db run push-force` against the same ambient `DATABASE_URL`, so a
   merge in a workspace pointed at a production database would push schema there. In the
   normal Replit task-merge context the workspace database is non-production, but neither path
   refuses a production target. The open follow-up to warn or refuse on a production target
   should cover both the test CREATE DATABASE and the post-merge schema push before any
   environment where production credentials could be present.

Neither item blocks the build; both are stated so AT starts from an honest baseline.

## Drift-ledger correction

- This record is added as `docs/drift/audit-post-AS.md`.
- `INDEX.md` gains one dated note line after the Phase AS entry.
- `rollup.md` notes the reconciliation against its "Last updated after Phase AS" orientation
  and adds the two elements above to "Still live, worth attention".
- No `docs/build-report-v2.md` phase section is written, consistent with the post-AN and
  post-X audits: a reconciliation is not a phase.

## Verdict

The build is functionally healthy and gate-clean: typecheck, build, and the full 1187-test
suite pass; the two-sided long-dash sweep is zero; zero new npm dependencies. The only true
gap was documentation drift, now reconciled. No phase is minted; Phase AS remains the last
gated phase. Phase AT may proceed once the two logged elements are acknowledged.
