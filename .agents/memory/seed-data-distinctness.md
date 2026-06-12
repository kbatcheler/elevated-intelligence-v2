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
figs = round, benign like round percentages; >=3 = specific). Fail a tenant PAIR
only if it shares >=2 specific currency figures OR its currency-anchor overlap
exceeds ~30 percent of the smaller set. One shared specific figure can be a
real-world coincidence; two-plus between the same pair is the signature.

**Why:** the anti-leakage intent is that no templated example figure leaks from
prompts into every tenant. The real test is whether a figure leaked from a prompt
(grep the prompts and stages for it) and whether overlap is statistically high,
not whether any one number coincides. A naive "any shared $ figure fails" check
false-fails on round numbers and on same-scale companies.

**How to apply:** when a distinctness check fails, first grep the prompts/stages
for the colliding figures (zero hits means no leakage) and compute pairwise
overlap before treating it as a data defect.

## Same-scale real companies share headline figures (this is correct grounding)
When choosing demo companies for "distinct figures," do not assume distinct
business categories implies distinct scale. Patagonia (~$1.47B consumer/DTC) and
The Hillman Group (~$1.5B hardware) are nearly identical revenue scale, so both
genuinely report ~$1.47 billion. A shared headline figure that is each company's
true reported revenue is accurate grounding, the OPPOSITE of templating. Verify a
shared figure against reality before treating it as a defect.
