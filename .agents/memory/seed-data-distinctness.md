---
name: Seed-data cross-tenant distinctness
description: How to judge whether multi-tenant seed figures are genuinely distinct vs templated, and why same-scale real companies legitimately share headline figures.
---

# Cross-tenant figure distinctness (the anchor sweep)

## The check must detect a templating SIGNATURE, not any single shared figure
A cross-tenant "are the figures distinct" check must not fail on any single shared
currency figure. Independent real companies legitimately coincide on (a) round
numbers ($10, $100, $100m, $1.5b) and (b) genuine same-scale revenue. Templated
(non-distinct) data shows a different, statistical signature: a large fraction of
figures shared and several shared SPECIFIC figures.

**Rule that works:** classify currency figures by significant figures (<=2 sig
figs = round, benign like round percentages; >=3 = specific). Fail on either of
two signatures: (a) a tenant PAIR sharing >=2 specific currency figures OR with
currency-anchor overlap over ~30 percent of the smaller set; or (b) a single
specific figure BROADCAST to >=3 tenants. One specific figure shared by a single
pair can be a real-world coincidence; two-plus between a pair, or one across three
or more tenants, is the signature.

**Why the broadcast rule matters:** a figure hardcoded or leaked into a prompt
appears in EVERY tenant by construction, so it shows up as exactly one shared
specific figure across many pairs, which the pair threshold (>=2) misses entirely.
The broadcast count (one specific figure stated by >=3 tenants) catches a prompt
leak automatically, so you do not have to rely on a manual grep. A naive "any
shared $ figure fails" check false-fails on round numbers and on same-scale
companies; the pair rule alone has a blind spot for a single broadcast figure.

**How to apply:** keep the pure pass/fail logic in a unit-tested module separate
from the DB script, so the gate is testable without live data. When a distinctness
check fails, distinguish a broadcast (likely a real prompt leak: also grep the
prompts/stages) from a high-overlap pair (likely templated generation) before
treating it as a data defect.

**Why exact-token matching is acceptable here:** figures are compared as exact
strings, so format aliases ($1.47b vs $1.47billion vs $1,470m) do not collide.
That is fine for the leak signature the check exists to catch, because a figure
leaked from one prompt is copy-identical across every tenant. Canonicalizing
currency suffixes/magnitudes would only catch cross-format real-world coincidences,
which are benign anyway, so it is an optional robustness nicety, not a correctness
fix.

## Same-scale real companies share headline figures (this is correct grounding)
When choosing demo companies for "distinct figures," do not assume distinct
business categories implies distinct scale. Patagonia (~$1.47B consumer/DTC) and
The Hillman Group (~$1.5B hardware) are nearly identical revenue scale, so both
genuinely report ~$1.47 billion. A shared headline figure that is each company's
true reported revenue is accurate grounding, the OPPOSITE of templating. Verify a
shared figure against reality before treating it as a defect.
