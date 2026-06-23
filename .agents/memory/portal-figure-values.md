---
name: Portal figure slots tolerate verbose cortex values
description: The lead/hero "figure" can be a whole phrase not a compact number; figure-rendering surfaces must bound their column and wrap or they break layout.
---

The cortex's `hero.metricValue` and `leadMetric.value` (surfaced by `leadFigure` and rendered on
the Morning Brief hero, the lead cards, the layer rows, and the Board Pack) are NOT guaranteed to
be compact figures like "8.2%" or "$1.2M". The model sometimes emits a full phrase, e.g.
"Estimated 8-12% of ARR trapped in one-way device flow".

**Why:** these values are model-generated and the pipeline is off-limits (no-touch-cortex,
derive-and-discard). The UI must render any string gracefully and never fabricate or truncate the
persisted value.

**How to apply:** a figure-rendering surface must
1. bound the column the value sits in. In CSS grid use `minmax(0, Nrem)` for the figure track,
   NOT `auto`: an `auto` track sizes to the value's max-content width and, beside a `1fr` text
   track, collapses that text column down to its longest word (this was the "Morning Brief
   paginated to the left" bug). In flex, use `min-w-0`.
2. `break-words` so a long value wraps inside the bounded column.
3. prefer length-aware presentation: when the value is long, drop from display size to lead/body,
   left-align instead of right-align, and skip the single-line gold underline sweep, so a phrase
   reads as a supporting line rather than a giant block. The `isLongFigure` helper
   (trim().length > 16) in BriefPage encodes the threshold.

Make a two-column hero conditional on a figure being present, so a figureless lead renders the
diagnosis full width instead of reserving an empty figure column.
