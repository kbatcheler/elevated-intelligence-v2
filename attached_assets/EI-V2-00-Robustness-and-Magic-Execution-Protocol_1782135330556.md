# EI V2 Robustness and Magic: Execution Protocol (Governing Prompt)

This is the governing prompt for the next build wave on Elevated Intelligence
V2. It does not itself change code. It defines the five phase prompts, the order
they run in, the file ownership that keeps them from ever conflicting, and the
invariants every one of them holds. Read this first. Then run the five phase
prompts in the stated order, one at a time, each as its own drift phase, with the
full check suite green before the next begins.

## Why this wave exists

The engine is strong. The gaps to a stellar product are four: the connectors are
mostly declared rather than implemented, so the connected pipeline is fed only by
a warehouse path; the in-boundary local seat that backs connected and sovereign
mode has no real runtime behind it; no single outcome loop has been closed end to
end; and the portal renders a good design language through inconsistent, hand
rolled inline styles across too many surfaces. This wave closes all four and turns
the UI into the product's signature.

## The five phases, in order

Run them in this sequence. Each is independently committable and each leaves
`typecheck`, `build`, and `test` green.

1. Phase AO, Connectors. Implement the six priority connectors as zero SDK HTTP
   adapters. File: `EI-V2-AO-Priority-Connectors.md`.
2. Phase AP, Sovereign seat. Wire a real in-boundary model runtime and prove a
   sovereign run. File: `EI-V2-AP-Sovereign-Seat-Realisation.md`.
3. Phase AQ, Outcome loop. Close and surface one calibration loop end to end.
   File: `EI-V2-AQ-Outcome-Loop-Closure.md`.
4. Phase AR, Operational hardening. Multi instance safe defaults, database role
   least privilege, go-live checklist. File: `EI-V2-AR-Operational-Hardening.md`.
5. Phase AS, The signature surface. Realise the design language, cut the
   navigation, and make the Brief and the public diagnosis exceptional. File:
   `EI-V2-AS-Signature-UI.md`.

The order is chosen so no two phases ever write the same file. AO lives in the
connector library, AP in the cortex library, AQ in the API server plus exactly
one new portal page, AR in infra and docs and config, AS in the portal. AQ runs
before AS so that AS inherits AQ's page and restyles it rather than racing it.

## File ownership map (the non conflict guarantee)

Each phase may create and edit ONLY the paths it owns. If a phase believes it
needs to touch a path owned by another, it stops and records the conflict in its
drift report instead of editing across the boundary.

- AO owns: `lib/connectors/**` (new connector modules, `registry.ts`,
  `catalogue.ts`, connector tests), and connector registration points under
  `artifacts/api-server/src/lib/connectors/**` and
  `artifacts/api-server/src/lib/ingestion/**` strictly where a new connector must
  be registered. AO does NOT touch `lib/cortex`, `artifacts/portal`, `infra`.
- AP owns: `lib/cortex/src/clients/local.ts`, any new in-boundary runtime module
  under `lib/cortex/src/clients/`, the cortex config docs for the local seat, and
  `artifacts/edge-agent/**` only if a runner shim is required. AP does NOT edit
  the `SEATS` object or any external model string, and does NOT touch
  `lib/connectors`, `artifacts/portal`, `infra`.
- AQ owns: `artifacts/api-server/src/lib/outcomes/**`,
  `artifacts/api-server/src/lib/calibration/**`, the outcome and calibration
  routes, `artifacts/api-server/src/scripts/seedLive.ts`, and EXACTLY ONE new
  portal page plus its API client file and ONE appended navigation entry. AQ does
  NOT restructure navigation, the shell, the primitives, or the design tokens.
- AR owns: `infra/**`, `docs/**` runbooks and readiness notes, the rate limit and
  connector bucket store DEFAULTS in their existing config modules, and the
  provenance database role SQL. AR does NOT touch `lib/cortex`,
  `lib/connectors`, or any `artifacts/portal` page.
- AS owns: `artifacts/portal/**`, the whole portal: tokens, shell, navigation,
  primitives, heroes, and the presentation of every page including the one AQ
  added. AS does NOT change any server route, API contract, or shared type
  signature; it consumes the contracts as they stand.

Shared files that more than one phase might be tempted to touch are assigned to a
single owner. `lib/connectors/src/catalogue.ts` belongs to AO alone. The
navigation registry in `artifacts/portal/src/components/TopNav.tsx` belongs to AS;
AQ appends its single nav entry in the same commit as its page and AS later
rationalises the whole nav, so the one line AQ adds is the only portal nav edit
outside AS.

## Invariants every phase holds

These are not negotiable and each phase restates them in its own acceptance gate.

- Zero new npm dependencies. Node built ins, existing workspace packages, and the
  already pinned catalog only. Every external service is reached over HTTP through
  an available, not connected adapter that mirrors the KMS and `gcpSecretStore`
  and warehouse pattern: it constructs without validating, fails loudly and lazily
  on first use with a precise "set X to connect it" error, and never crashes the
  boot. No vendor SDK is ever added.
- ASCII hyphen only. Never an em dash or en dash, in source OR in database data.
  The source guard and the database row sweep both read zero before a phase is
  done.
- Never fabricate telemetry, health, or output. A figure is computed from
  persisted state or it is not shown. Loading, empty, and error states stay
  honest and distinct. A missing figure renders as a dash, never a zero.
- Per phase drift protocol. Each phase writes `docs/drift/phase-<id>.md`, appends
  its section to `docs/build-report-v2.md`, and updates `docs/drift/INDEX.md` and
  `docs/drift/rollup.md` to the new last phase. The INDEX is the source of truth
  for build progress.
- The full suite is the gate. Run `typecheck`, `build`, and `test` through the
  configured workflows, read the flushed logs, and do not close a phase until all
  three pass and the long dash sweep reads zero on both sides.
- All prose and UI copy is plain professional British English. No em dashes, no
  Oxford commas, no Americanisms, no emoji in product UI.

## How to run a phase

Open the phase prompt, confirm the ownership boundary, implement the ordered
tasks, run the suite, write the drift records, then commit. Do not start the next
phase until the current one is committed and green. If a phase cannot complete a
task without crossing an ownership boundary or adding a dependency, it records the
blocker in its drift report and stops rather than working around the invariant.
