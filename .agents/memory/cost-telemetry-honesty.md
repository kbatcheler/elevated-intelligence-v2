---
name: Cost/token telemetry honesty (the billed flag)
description: How model_usage cost rows stay honest; the no-call vs billed-failure distinction that a first attempt got wrong.
---

# Cost and token telemetry honesty

The rule for any model-cost ledger work (Phase N `model_usage` and anything that
extends it): a cost row exists ONLY because a real provider call billed real tokens.
Cost is real token counts x configured rates, never fabricated, never estimated.

## A model call fails two ways and only one costs money
- No-call failure: no in-boundary model configured, a provider integration with no
  env, or a transport failure before any response. Spent nothing -> record NOTHING.
- Billed failure: a 200 that billed real tokens and then failed OUR OWN schema
  validation. Spent the money -> record at the real cost even though the stage failed.

**Why:** the first implementation attempt was FAILED by the architect for exactly this
- it wrote fabricated zero-cost rows for no-call failures (unconfigured Lens, missing
provider env still carried a model), and it dropped tokens on billed-but-failed and on
retried calls. Conflating the two failure modes is the trap.

## How to apply
- An explicit `billed` flag rides the stage telemetry: true iff a real token-billed
  response occurred (success OR validation-failed-after-200). The usage writer records
  a row only when `billed && model`. Do NOT weaken this gate.
- Accumulate tokens across the two-attempt corrective retry in EACH client: a
  billed-then-retried attempt counts once with the SUMMED tokens, never just the last,
  never doubled. Read provider usage BEFORE any no-text early return.
- Tap usage ONLY in the orchestrator (the sole side-effect owner): the stage run on
  both ok and error, the enrichment as ONE row (not the batched folded peers), and the
  profile build after the tenant is ensured. Resume paths must return before the tap so
  a resumed run records no duplicate.
- Price by SEAT via `SEATS`, never by a model literal (keeps the config invariant); a
  self-hosted/unknown model prices at zero (no external charge, not a silent fallback).
  Rates are published list-price defaults the operator must verify, said so in code.
- Cost tracking is best-effort vs the diagnosis: a ledger-write failure is logged and
  swallowed, never aborts a layer. It can under-count but must never break a seed.
