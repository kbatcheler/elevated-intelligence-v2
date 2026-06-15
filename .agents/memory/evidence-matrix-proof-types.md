---
name: Evidence-matrix proof-type honesty
description: In a verification/evidence-matrix phase, map each acceptance criterion to evidence with an ACCURATE proof-type marking, or the architect fails it as an honesty violation.
---

In a verification phase (the ones that close a stage, e.g. M, V, AC), every acceptance
criterion is mapped to evidence. Each citation must carry an accurate PROOF-TYPE marking
and must not overclaim:

- test-proven (a named `*.test.ts` actually exercises the behavior),
- source-reviewed (verified by reading the code, NOT by an automated test),
- available-not-connected (an adapter verified as honest, not a live delivery).

**The trap that fails the gate:** citing a unit test of PURE HELPERS as proof of a
write/IO path. A `findingChallenge.test.ts` that only tests parse/extract/hash helpers does
NOT prove the `runFindingChallenge` engine (uphold/revise/failed/provenance). A
`shareTokens.test.ts` that only tests hash/clamp/status does NOT prove the CSPRNG mint,
plaintext-once, hash-only persist, list-omits-token, resolve telemetry, or the public route.
A `caseStudies.test.ts` driving `buildCaseStudies` over PREBUILT contributions does NOT prove
the loader's reuse of `computeOutcomeSummary`. Some engine/route paths have no automated test
at all because they spend real billed model calls the suite deliberately does not run, or
because no route integration test exists.

**Why:** the project's hard constraint is "never fabricate telemetry/output"; an overclaimed
proof is the documentation form of that violation, and the architect `evaluate_task` will
return FAIL on it.

**How to apply:** before writing an evidence matrix, OPEN each cited test file and confirm
what it actually asserts; grep that the engine/route function is referenced in a `*.test.ts`,
not only in source/routes. In a docs-only verification phase the fix is to mark the
unproven paths source-reviewed (with the reason) and log the coverage gap as an accepted LOW
in BOTH the phase doc and the rollup still-live section, NOT to add product/test code and NOT
to keep the overclaim. Mirror the Phase V posture toward live paid seeds / live OAuth.
