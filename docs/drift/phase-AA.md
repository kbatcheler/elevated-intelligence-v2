# Phase AA: interactive challenge

Phase id: AA. Name: Interactive Challenge. Milestone: no. The third phase of the
owner-authorized autonomous Stage 4 run (Y, Z, AA, AB, AC), which pauses at the Stage 4/5
boundary for owner review (before Phase AD); the next protocol MILESTONE hard stop is AI at
the end of Stage 5. Phase AA lets a seat CHALLENGE one finding in a layer's diagnosis: the
objection is re-reasoned through the Confounder and Synthesist seats, which either uphold the
finding with reasoning or revise it with a new confidence and a note, and every exchange is
recorded as an append-only, auditable verdict. The user's input is context, never an override:
a challenge can never delete a finding, and a revise re-bases the challenge row only, never the
stored layer content. It added zero npm dependencies and contains no em-dash or en-dash in
source or in data.

This EXTENDS Ask Different Day, it does not replace it: the same finding cards on the layer
pages and the Ask Different Day surface gain an inline challenge control and per-finding
history, while the existing perspective-lens re-reasoning stays exactly as it was. A challenge
is a finding-scoped overlay on top of the diagnosis, not a rewrite of it.

## What was built

New schema (`lib/db/src/schema/findingChallenges.ts`, one table, two enums):

- `finding_challenges` is one recorded challenge against one finding: the tenant, the layer
  key, the `findingRef` (`causes[i]`, `actions[i]`, `hypotheses[i]`, or `metrics[i]`), a
  `findingHashRef` (the sha256 of the canonical finding text AT challenge time, so a later
  refresh that changes the finding is detectable), the challenger user id, the sanitized
  challenge text, the original confidence and basis snapshot, the outcome's revised confidence
  and `revisedBasis`, the confounder note, the synthesist reasoning, an `error` for an honest
  failure, the billed `telemetry`, and the `provenanceContentHash` of the ledger entry a
  success appended.
- `finding_challenge_status` is `completed` and `failed`; `finding_challenge_outcome` is
  `upheld` and `revised` (null on a failed row). A model call that does not return a usable
  result is an honest `failed` row with the real billed telemetry and NO outcome and NO
  provenance entry, never a fabricated uphold or revise.

New cortex stages (`lib/cortex/src/schemas/stages.ts`, prompts, runners): a challenge-confound
stage re-tests the objection against the evidence and a challenge-synthesis stage decides
uphold-or-revise. Both are grounded (the architecture page already flags the challenge stage as
grounded). No model literal enters source; the seats resolve through the existing `SEATS` map.

The service (`artifacts/api-server/src/lib/challenge/findingChallenge.ts`):

- `runFindingChallenge` loads the live finding, hashes its canonical text, runs the Confounder
  then the Synthesist seat, records the billed model usage for each, and writes the outcome in
  ONE transaction: on success it appends exactly one hash-chained provenance entry (claim path
  `<layerKey>.challenge.<findingRef>`, source ref a `challenge:sha256:` digest over the outcome
  with the user text HASHED in, never embedded) and inserts a `completed` row; on a model
  failure (or a `revised` verdict with no new confidence) it inserts an honest `failed` row with
  no provenance. A revise sets `revisedBasis` to `modelled_user_informed` on the challenge row
  ONLY; the cortex basis enum and the stored layer content are never touched, so the finding is
  re-based as engine reasoning informed by the user, not overwritten by the user.
- The pure helpers (`parseFindingRef`, `extractFinding`, `canonicalFindingText`, `findingHash`,
  `currentFindingHash`) are unit-tested in isolation; `serializeChallenge` is the single shaper
  the list AND the submit path share, so a just-recorded challenge returns the SAME contract the
  history does.
- `listFindingChallenges` returns a tenant's challenges newest first, each annotated with the
  challenger's email (null when the user was removed) and an honest `isCurrentVersion` flag
  (true when the challenged finding still hashes the same, false when a refresh changed it, null
  when the layer or finding no longer exists). Layer content is loaded once per layer, not once
  per challenge.

The HTTP surface (`artifacts/api-server/src/routes/tenants.ts`, both under the shared
`requireAuth` gate and `requireTenantAccess`): `POST /tenants/:id/layers/:key/challenges`
re-reasons one finding, and `GET /tenants/:id/challenges` reads the tenant's history. The POST
order is the tenant fence, then a zod parse (the `findingRef` must match the challengeable kinds;
the `challengeText` is bounded, trimmed, and refused when empty after trim), then the
client-viewer model-spend gate, then the live re-reasoning, so a malformed body, a blank body, or
a read-only seat is rejected BEFORE any model call.

Portal (`artifacts/portal/`): `lib/challengeApi.ts` (a framework-free client returning honest
discriminated states for fetch and submit plus `groupChallengesByRef`), the `ChallengeControl`
component (the inline challenge box and per-finding history with distinct states; a seat that
cannot challenge sees the history but no submit box), `FindingChallengeSlot` wired into the
Causes, Actions, and Challengers cards in `sections.tsx`, the layer page (`LayerPage.tsx`, which
fetches challenges alongside the layer and computes `canChallenge` as a non-client-viewer seat),
and the Ask Different Day page (`AskDifferentDayPage.tsx`, which groups challenges by layer and
threads a slot onto its cause and action cards). The submit prepends the serialized row so the
just-recorded challenge shows the challenger and the current-version flag immediately.

## Acceptance evidence

- Challenge re-runs reasoning: a POST routes the finding through the Confounder and Synthesist
  seats and records the outcome; the route boundary tests prove every NON-model path (auth,
  tenant fence, role gate, malformed and empty and over-long bodies, honest empty history) is
  rejected or served without spending a model call, and the pure-helper unit tests prove the
  finding extraction, canonicalization, and hashing the re-reasoning is built on.
- Uphold or revise: the outcome enum is exactly `upheld` or `revised`; a revise carries a new
  confidence (a `revised` verdict with no confidence is recorded as an honest failure, never an
  invented number), and the revised basis becomes `modelled_user_informed`.
- Cannot unilaterally delete: `runFindingChallenge` never mutates or deletes `tenant_layers`
  content; the challenge is an append-only overlay row, so a user can object to a finding but can
  never remove it.
- Logged and auditable, revised basis shown: every exchange is a `finding_challenges` row
  (completed OR failed); a completed challenge also appends one hash-chained provenance entry, so
  `verifyChain` still passes and the revised basis and confidence are persisted and surfaced in
  the history.
- Extends Ask Different Day: the challenge control is added to the existing finding cards on the
  layer pages and Ask Different Day; the perspective lens is unchanged.

## Verification

- Typecheck green across all workspace projects (exit 0).
- Build green (exit 0; portal 1750 modules, api-server bundled).
- Full suite green at 716 tests: api-server 377 across 42 files (the new `findingChallenge`
  pure-helper unit tests and the challenge route-boundary tests, +20 over Phase Z's 357), portal
  204 across 16 files (the new `challengeApi` tests, +11 over Phase Z's 193), cortex 84,
  connectors 29, edge-agent 10, db 8, scripts 4.
- Long-dash sweep zero on BOTH sides: a fresh `rg` over the authored tree (lib, artifacts, docs,
  scripts, replit.md, .replit, .github) returns zero, and a database-wide cast over every public
  text and jsonb column (135 columns; Phase AA added the `finding_challenges` text and jsonb
  columns) reports `TOTAL DASH HITS 0`.
- Zero new npm dependencies. User challenge text is sanitized once (`stripDashes`) before it is
  used for the prompt OR stored, so the hard constraint holds for user input, not only generated
  content.

## Logged drift and deviations

- Token-scoped challenge is not built; a challenge is finding-scoped. A challenge addresses one
  finding at one ref in one layer, the same granularity Ask Different Day works at. This is the
  intended scope, recorded for completeness.
- Synchronous re-reasoning over a job queue. The POST runs the Confounder and Synthesist seats
  inline and returns the recorded row, mirroring the seed pipeline's per-stage model calls rather
  than enqueuing a background job. A background challenge queue is a later additive change, not
  built this phase.
- The challenge-history fetch is treated as non-critical on the layer and Ask Different Day
  pages: if the history fetch fails, the page renders the diagnosis WITHOUT the challenge overlay
  rather than blanking the whole page on a supplementary-data outage. This is a deliberate
  honest-degradation choice (the main diagnosis is primary; the challenge overlay is additive),
  logged as accepted drift; a future refinement could surface a distinct "challenge history
  unavailable" affordance on the control.
- The `metrics[i]` ref kind is accepted by the route regex for forward-compatibility, but the
  finding cards that currently expose a challenge control are Causes, Actions, and Challengers
  (hypotheses); a metric challenge is reachable by the API contract, not yet surfaced in the UI.

## Remediation iterations

- Architect `evaluate_task`: PASS on the first review, with no HIGH or SEVERE finding. Two LOW
  items were surfaced and FIXED rather than logged as accepted drift, because both touch the
  honest-output bar and were cheap:
  - The submit response returned the raw database row, so a just-recorded challenge lacked the
    challenger email and the version flag until a refetch and could momentarily mislabel the
    current user as "a removed user". The fix extracts a single `serializeChallenge` shaper used
    by both the list and the submit path and returns the serialized contract from the POST with
    this seat's email and `isCurrentVersion` true (the challenge was just recorded against the
    live finding and never mutates the layer content, so it is the current version).
  - The `challengeText` validator admitted a whitespace-only body (a single space passed
    `min(1)`). The fix trims the text and refuses an empty-after-trim body, so a blank submission
    can never spend a model call or store a meaningless row.
- A pre-existing database step was required before the integration suite passed: the new
  `finding_challenges` table had to be pushed (`drizzle-kit push`) to the live database. The GET
  history test correctly returned 500 until the table existed; it passes once the schema is
  applied.

## Gate

Phase AA passed its architect `evaluate_task` review (PASS, no HIGH or SEVERE; two LOW items
remediated). The drift index, the rollup, and the V2 build report are updated to "A through AA".
Phase AA is NOT a milestone; per the owner-authorized Stage 4 run, execution continues to Phase
AB and does not pause here (the pause is at the Stage 4/5 boundary before Phase AD; the next
protocol milestone hard stop is AI at the end of Stage 5).
