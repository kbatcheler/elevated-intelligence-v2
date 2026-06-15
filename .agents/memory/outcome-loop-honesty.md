---
name: Outcome loop value/calibration honesty
description: The honesty boundaries for the predicted-value-vs-realized outcome loop, and why W's calibration is kept deliberately loose.
---

# Outcome loop value and calibration honesty

The outcome loop turns the track record into a graded history (predicted value at
commit time vs measured realized value). Several rules keep it honest, and one is a
cross-phase decision that is NOT visible from the code alone.

## Rules

- A predicted dollar value is parsed from a free-text impact ONLY when anchored by a
  `$` or `USD` token. A bare percentage, a margin-point figure, or prose yields null,
  never a coerced/invented dollar amount. The same restraint applies to the baseline:
  snapshot it only from a single real scalar derived signal in connected mode, null
  otherwise.
- A measurement is `basis=measured` ONLY when a real finite scalar derived signal
  backs it. A missing or non-scalar signal is a loud `400 signal_not_found`, never a
  silent downgrade to `modelled`, so a modelled estimate is never presented as a
  measured fact.
- `status=missed` is set ONLY on a final measurement, so an in-flight action below its
  prediction reads `on_track`, never a spurious miss.
- Summary figures are computed in a pure module from already-persisted numbers, so the
  value counter reconciles against a direct database sum; use the latest measurement
  per action so a re-measured action is never double-counted; an empty record returns a
  null calibration score, never a fabricated 100 percent.

## Why the calibration is loose (the cross-phase part)

Phase W's calibration is a deliberately simple hits-over-resolved fraction.

**Why:** milestone AJ supersedes it with a Brier-scored calibration ledger. W only has
to be honest, not statistically clever, so it was intentionally NOT over-built.

**How to apply:** when you reach AJ (or any later calibration work), replace the loose
score rather than layering on top of it, and do not "fix" W's simplicity in the
meantime as if it were an oversight.
