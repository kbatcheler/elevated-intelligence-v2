---
name: Portal small-screen table/grid overflow
description: How the portal prevents page-level horizontal overflow on phones, and the gaps the <=480px guard does NOT cover.
---

# Portal phone-width overflow: the guard and its blind spots

The portal's responsive strategy is CSS media queries in `index.css` keyed on
named class hooks, NOT Tailwind `sm:`/`md:` prefixes. The `@media (max-width: 480px)`
block holds the phone-floor overrides (the 375px audit target).

The `.table-base { display:block; overflow-x:auto }` rule at <=480px is the
horizontal-scroll guard, but it ONLY covers tables that carry the `.table-base`
class. Two patterns bypass it and silently force page-level horizontal scroll on a
phone:

- A raw `<table className="w-full ...">` (not `.table-base`) inside a
  `card p-0 overflow-hidden` wrapper. The card clips rather than scrolls, hiding
  data. Fix: wrap the table in a `<div className="table-scroll">` (same pattern
  SpendPage uses), not by adding `.table-base`.
- A side-by-side table/input grid like `grid-cols-[1fr_1fr]` /
  `grid-cols-[1fr_1fr_1fr]` / four inputs in `grid-cols-[1fr_1fr_1fr_1fr]`. A `1fr`
  track has an `auto` minimum, so a wide cell or a form `<input>` (intrinsic
  min-width ~20ch even with `width:100%`) blows the track out past 375px. Fix: give
  the grid a named hook class and collapse it to `1fr` (or `minmax(0,1fr)`) inside
  the <=480px block. Hooks now in use: `.spend-cols`, `.calibration-cols`,
  `.ingestion-report-grid`, `.metric-tiles-grid`.

**Why:** the 375px audits are done per-batch and the operator/owner table-heavy
screens were verified later than the main surfaces. The named-hook pattern (e.g.
`calibration-cols`, `spend-cols`) was pre-placed on the grids but had NO CSS rule
until the phone audit, so the hooks are the intended seam.

**How to apply:** when adding an operator/admin screen with a wide table or a
multi-column table/input grid, either use `.table-base`, or wrap raw tables in
`.table-scroll` and add a named-hook collapse rule to the <=480px block. Verify by
asserting `document.documentElement.scrollWidth <= window.innerWidth` at 375px while
logged in (seed a provider-owner / client-admin per functional-e2e-auth.md).
