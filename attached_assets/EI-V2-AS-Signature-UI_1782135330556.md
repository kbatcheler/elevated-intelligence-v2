# Phase AS: The Signature Surface (a UI that is magical because it is precise)

## Objective

The portal renders a genuinely good design language through inconsistent, hand
rolled inline styles across far too many surfaces, which is exactly why it reads
as clunky despite each screen being individually fine. This phase makes the UI the
product's signature. The magic does not come from flash. For an executive and a PE
audience the magic is authority, restraint, and provenance made visible: a product
that looks like it cost more than the deal and that lets you watch it reason. This
phase realises the existing design language properly, cuts the navigation to a
confident few, and makes two surfaces exceptional: the Morning Brief, which is the
daily reason to open the product, and the public diagnosis, which is the cold
prospect's first and most important impression.

## Ownership boundary

This phase owns `artifacts/portal/**` entirely: the tokens, the shell, the
navigation, the primitives, the heroes, and the presentation of every page
including the outcome loop page that phase AQ added. It does not change any server
route, API contract, or shared type signature; it consumes the contracts exactly
as they stand. If a surface needs data the API does not expose, it records that in
the drift report rather than reaching into the server.

## Invariants (restated)

ASCII hyphen only in source and in any copy. No new dependency: build on the
already pinned React 19, Tailwind 4, `framer-motion`, `lucide-react`, and `wouter`.
Honour the design language's forbidden list without exception: no glassmorphism,
no frosted panels, no backdrop blur, no gradients as surfaces or fills, no drop
shadows for elevation, no emoji in product UI. Never fabricate a figure on a
surface: the four data states stay honest and a missing value renders as a dash,
never a zero. All copy is plain professional British English, no Oxford commas, no
Americanisms. Full suite green before close.

## The design philosophy this phase commits to

The concept is already right: an analyst quietly briefing an executive, navy for
authority, gold for elevation, cream as the paper, a serif for conclusions. Do not
discard it. Deepen it. The unique, magical quality comes from four moves, all
inside the existing restraint.

First, provenance as the signature. The verified versus modelled distinction is
the product's whole promise. Make the provenance pill a deliberate, recurring,
beautifully executed motif rather than an occasional label: teal for a figure
drawn from a real signal, amber for a figure the cortex modelled. Every headline
figure carries one. This is the single visual idea a prospect should remember.

Second, reasoning made legible. The product runs a real adversarial pipeline: a
Lens perceives and hypothesises, a Confounder challenges, a Challenger tests, a
Synthesist concludes. Most products hide their reasoning. This one should let you
see it, quietly. A restrained reasoning ribbon that shows the path from hypothesis
through confounder to conclusion turns the architecture into a felt experience of
rigour, which is exactly what earns an executive's trust.

Third, typographic authority. Conclusions are set in the serif, large and
confident, with generous space around them. Interface and labels are the sans.
Figures and machine status are the mono. Hierarchy is carried by type and space,
not by boxes and colour. One confident diagnosis on a quiet page reads as
expensive; a grid of equal cards reads as a dashboard.

Fourth, motion as confirmation, never decoration. Transitions around 120ms. A gold
underline sweep marks a freshly updated value. Nothing loops, nothing floats,
nothing announces itself. The restraint is the luxury.

## Ordered tasks

1. Tokenise everything. Remove the inline `style={{ ... }}` objects from the shell,
   the heroes, and the pages, and route every colour, space, radius, border, and
   type decision through the design tokens in `index.css` and a small set of
   utility classes and primitives. After this task there is one place to change a
   colour or a spacing step, and the design language doc and the rendered product
   agree token for token. This is the largest task and the one that fixes the
   clunkiness at its root.
2. Cut the navigation. The top navigation today exposes thirteen primary
   destinations and up to seventeen for provider seats, which reads as a tool that
   has not decided what it is. Reduce to four or five primary surfaces, for example
   Brief, Layers, Board pack, and Ask, with the remainder nested under a clearly
   labelled secondary grouping (analysis, operations, audit). The provider and
   owner tools stay provider and owner only. Fewer doors, each excellent. Keep the
   server side fences exactly as they are; this is a navigation affordance, not the
   access control.
3. Make the Morning Brief exceptional. It is the daily hero surface, so it should
   be the most refined screen in the product: one confident serif diagnosis at the
   top with room to breathe, the headline figures each carrying a provenance pill,
   the single most important lever stated plainly, and the reasoning ribbon
   available but quiet beneath. Honest loading, empty, and error states. This is
   the screen that should make an executive feel briefed, not dashboarded.
4. Make the public diagnosis the sales weapon. The shareable diagnosis at
   `/d/:token` renders outside auth for a cold prospect who has connected nothing,
   produced by outside_in mode from the company's public footprint alone. It must
   look like it cost more than the deal: a cinematic, earned trust artefact with
   the company's own context reflected back, the diagnosis in the serif, the
   provenance made explicit so the prospect sees what is known versus inferred, and
   a single quiet call to connect for the full picture. This page, made
   exceptional, is the top of the funnel.
5. Build the signature primitives once and use them everywhere: the provenance
   pill, the reasoning ribbon, the headline metric, the serif diagnosis block, the
   four honest data states, and the gold underline sweep on a fresh value.
   Restyle the outcome loop page from phase AQ with these primitives so the closed
   loop, the most persuasive thing the product can show, is also one of the most
   beautiful.
6. Confirm accessibility and responsiveness hold: text meets WCAG AA using the ink
   shades for small brand hued text, every interactive element shows a visible
   focus ring on `:focus-visible`, and the core read surfaces (Brief, layer pages,
   Board pack, public diagnosis) are usable down to a 375px viewport with no
   horizontal overflow.

## What you must not do

Do not add a dependency or reach for glassmorphism, gradients, drop shadows, or
emoji; the restraint is the brand. Do not change a server route, an API contract,
or a shared type. Do not fabricate a figure to fill a surface; honour the four data
states and the dash for a missing value. Do not reintroduce inline style objects;
everything routes through tokens and primitives. Do not widen the navigation back
out.

## Acceptance gate

Inline style objects are gone and every visual decision routes through the tokens
and a small primitive set, so the rendered product and the design language doc
agree; the navigation is cut to a confident few with provider and owner tools
still fenced; the Morning Brief and the public diagnosis are exceptional, provenance
carried on every headline figure and reasoning legible but quiet; the outcome loop
page is restyled with the signature primitives; accessibility and the 375px
responsive floor hold. `typecheck`, `build`, and `test` green. Long dash sweep
zero. Drift records written for phase AS: `docs/drift/phase-AS.md`, the build
report appended, the INDEX and rollup advanced to AS as the closing phase of this
wave.
