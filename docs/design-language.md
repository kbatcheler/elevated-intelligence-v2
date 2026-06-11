# Design Language

The visual and interaction system for Different Day, the per-tenant executive
intelligence layer. This document is the written specification. Its live
counterpart is the portal design-language page, which renders every primitive
described here from the same tokens.

## Concept

Authority, restraint, and provenance. The product speaks like a trusted analyst
briefing an executive: confident, quiet, and exact. Navy carries authority,
gold marks elevation, and cream is the paper everything sits on. Nothing shouts.
The design earns trust by being precise about what is known versus what is
inferred.

## Palette

Brand:

- Navy `#1B2A4E`: primary authority color for titles, primary actions, accents.
- Navy Deep `#0F1A33`: headers and dark surfaces.
- Navy Soft `#4A5878`: secondary navy for supporting marks.
- Gold `#C8A24A`: elevated accents and eyebrows. Used sparingly.
- Gold Light `#E5C97B`: gold on dark surfaces.
- Cream `#F4F1EA`: the page background, the paper.
- Cream Light `#FAF8F2`: raised hover and inset fills.
- Cream Dark `#E8E2D2`: hairlines and skeleton base.
- Paper `#FFFFFF`: card surface.
- Border `#E5E2D8`: the one-pixel border on every surface.
- Ink `#1F1F1F`: body text.

Provenance and status:

- Teal `#1D9E75` on faint `#E1F5EE`: verified, drawn from a source signal.
- Amber `#BA7517` on faint `#FAEEDA`: modelled, inferred by the cortex.
- Coral `#D85A30` on faint `#FBE8DF`: attention, gaps, model output.
- Blue `#185FA5` on faint `#E6F1FB`: data.
- Purple `#534AB7` on faint `#EEEDFE`: integrations.

## Typography

- Serif, Crimson Pro: headings, the diagnosis, anything stated as a conclusion.
- Sans, Inter: body text, interface, labels.
- Mono, JetBrains Mono: numeric metrics and machine status.

Eyebrows are Inter, 10px, uppercase, weight 600, letter-spacing 0.14em. Body is
15px with line-height 1.55.

## Surfaces

Surfaces are defined by structure, not depth.

- One-pixel border in Border color on every card.
- Four-pixel corner radius.
- A three-pixel top accent bar marks a card's category or status. Accents map to
  the palette: navy, coral, teal, gold, amber.
- No drop shadows. Elevation is communicated by border and accent, never blur.

## Components

- Cards: paper surface, one-pixel border, optional three-pixel top accent.
- Provenance pills: Verified (teal) and Modelled (amber). Every displayed figure
  declares whether it is verified from a signal or modelled by the cortex.
- Status pills: navy, coral, teal, amber, blue, purple on their faint fills.
- Tags: small uppercase labels for data, integration, model, workflow, signal.
- Buttons: primary (navy fill, cream text) and ghost (navy border, white fill).

## Data states

Every data surface designs four states explicitly. The system never shows
placeholder or fabricated values to fill a gap.

- Loading: a shimmer skeleton in the cream range.
- Ready: the content.
- Empty: a plain statement that there is nothing yet, with the action to create
  it.
- Error: a coral-accented card stating what failed. The product fails loudly.

## Motion

Motion is functional and brief. Transitions are around 120ms. A gold underline
sweep can mark a freshly updated value. Avoid decorative or looping motion.

## Forbidden

- Glassmorphism, frosted-glass panels, backdrop blur.
- Gradients as surfaces or fills.
- Drop shadows for elevation.
- Emoji in product UI.
- The long em-dash (U+2014) anywhere. Use a period, a colon, or a hyphen.
