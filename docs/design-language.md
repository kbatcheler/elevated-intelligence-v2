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
- Gold `#C8A24A`: elevated accents, borders, and dividers. Used sparingly.
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

Accessible text shades. The brand hues above are tuned for marks, three-pixel
accent bars, borders, icons, and large display figures, where they read at
AA-large or serve a decorative role. Small body text that needs a brand hue uses a
darkened, hue-preserving ink variant that meets WCAG AA on cream and paper:

- Gold ink `#826930`: small gold text, including eyebrows on light surfaces. The
  gold base stays for large figures and decorative accents; on dark surfaces
  eyebrows use gold light.
- Teal ink `#177B5B`: small verified text. The teal base stays for pills and large
  figures.
- Amber ink `#975F13`: small modelled text.
- Coral ink `#B04927`: small attention and error text.

Slate is the secondary text color; slate light `#666D7A` is the muted variant,
darkened so it clears AA on cream.

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

## Accessibility and responsiveness

- Contrast: text meets WCAG AA. Small text in a brand hue uses the ink shade above;
  the brand bases are reserved for large figures, accent bars, borders, and icons.
- Keyboard: every interactive element shows a visible focus ring on
  `:focus-visible` (a navy-soft outline), so the interface is fully operable from
  the keyboard.
- Responsive: the core read surfaces (Morning Brief, layer pages, Board Pack) are
  usable down to a 375px viewport with no horizontal overflow. Shared chrome (the
  page width, the top navigation rows) is styled by class with a narrow-viewport
  media query rather than fixed inline widths; the bottom navigation scrolls
  horizontally rather than wrapping.

## Motion

Motion is functional and brief. Transitions are around 120ms. A gold underline
sweep can mark a freshly updated value. Avoid decorative or looping motion.

## Forbidden

- Glassmorphism, frosted-glass panels, backdrop blur.
- Gradients as surfaces or fills.
- Drop shadows for elevation.
- Emoji in product UI.
- The long em-dash (U+2014) or en-dash (U+2013) anywhere. Use a period, a colon,
  or an ASCII hyphen.
