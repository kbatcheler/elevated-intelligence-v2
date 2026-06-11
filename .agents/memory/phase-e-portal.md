---
name: Phase E portal architecture
description: Durable decisions for the per-tenant portal product surfaces (Phase E), especially the parallel archetype-hero fan-out contract.
---

# Phase E portal architecture

## Archetype hero fan-out contract
Each of the 8 layer archetypes gets ONE component file under
`artifacts/portal/src/components/heroes/<Name>.tsx`, all sharing a single prop
shape `ArchetypeHeroProps { entry: LayerRegistryEntry | null; detail: TenantLayerDetail }`.
The main agent alone owns `heroes/registry.ts` (maps the EXACT archetype display
string to its component, falling back to the generic metric+sparkline hero) and
the one-line dispatch in `LayerPage`. Parallel design subagents touch only their
own hero file.
**Why:** archetype is a free string on the registry entry, so a typo silently
falls through; and 8 parallel subagents editing shared files would collide or
drift the data contract. Centralizing the map and the props localizes both risks.
**How to apply:** when adding/regenerating heroes, never let a subagent edit
`registry.ts` or `LayerPage`; hand each subagent the shared props type and one
filename. The exact archetype display strings are the ground truth in
`lib/db/src/seed/canonicalLayers.ts` and must match `heroes/registry.ts` keys
character for character (pinned by `heroes/registry.test.ts`).

## Real-data-only hero rule
Metric values (`heroPanel.metric_value`, `content.metrics[].value`) are STRINGS.
No client-side arithmetic. Heroes morph layout/emphasis only over real fields
(heroPanel, content.metrics, peerBenchmark). `heroPanel` can be null and its
`trend` can have <2 points (Sparkline returns null then); degrade to a
metric-only layout, never invent waterfall/funnel/node geometry.
**Why:** the Drift Control Protocol forbids fabricated figures; invented chart
geometry is the easiest accidental violation.

## Persisted cortex JSON shapes are inconsistent
On the tenant-layer detail: `verifiedClaims`/`modelledClaims` are
`{ items: [...] } | null`, `supplementBlocks` is `{ blocks: [...] } | null`,
but `confounders` is a bare `Confounder[] | null`.
**Why:** the object-wrapped vs bare-array mix is a recurring `.map is not a
function` trap; check the wrapper before iterating.

## Perspective lens re-ranks by ownerPersona substring match
`lib/perspective.ts` scores a layer by the highest-priority seat token its
registry `ownerPersona` contains (case-insensitive `includes`), ties broken by
`sortOrder`. It re-ranks only; it never changes a figure or adds/drops a layer.
The Morning Brief and Board Pack both order through it; the lens lives in
TenantContext (persisted to localStorage).
**Why:** substring matching is collision-free ONLY for the current seeded
persona set (e.g. "controller" and "CHRO" do not contain "cro"). A new persona
whose text accidentally contains an unintended seat token would silently
mis-rank with no error.
**How to apply:** when adding personas or seat tokens, re-check for substring
collisions against the `SEAT_PRIORITY` lists and keep `perspective.test.ts`
(which pins each lens's lead layer) green.

## Tenant-scoped pages must reflect tenant status, not spin
Any page that fetches by `currentId` must branch on `useTenant().status`: when
`currentId` is null because the tenant list is empty or errored, render the
designed empty/error state, not a perpetual loading skeleton.
**Why:** effects that early-return on null `currentId` leave the page stuck in
loading, violating "designed states everywhere".

## Never name a component after a global builtin (Map, Set, Promise)
A component `function Map(...)` shadows the global `Map`, so `new Map<...>()` in
the same module fails with the cryptic pair TS7009 ("'new' expression whose
target lacks a construct signature") and TS2558 ("Expected 0 type arguments").
**Why:** the error points at the `new` call, not the shadowing declaration, so it
reads as a generics bug and wastes time. Rename the component (e.g. `MapView`).

## Distinguish a fetch error from an empty result, never collapse to zero
When a surface overlays optional data (e.g. per-seat run telemetry on the global
architecture, or a heartbeat poll), an errored fetch must render a visible
"temporarily unavailable" note, not silently degrade to "no data"/zero, and a
poll must reschedule after a transient error rather than freeze on a stale
live-indicator.
**Why:** the protocol forbids fabrication; showing absent-because-error as a real
zero is a quiet lie, and a frozen poll leaves a stale "updating live" badge.

## War room commit dedup is by layerKey::title
A recommended action is treated as already committed when a `committed_actions`
row shares its `layerKey` and `title`; commit is gated on a real basis AND
confidence (uncommittable moves render read-only, never with a faked number).
**Why:** the title-based key is collision-free only until content is regenerated
with reworded action titles, which will resurface an already-committed move as
committable. Acceptable for Phase E; revisit if a stable action id is added.
