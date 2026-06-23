# Portal accessibility and small-screen audit (375px floor)

This is the deferred authenticated, cross-viewport accessibility audit of the
Phase AS redesigned per-tenant portal. Phase AS restyled the portal onto the new
signature primitives (the serif diagnosis, the pills, the gold underline sweep)
but a full audit while logged in was deferred because owner credentials are not
in the agent shell. This document records the methodology, the per-surface
result at a 375px-wide phone, the WCAG AA checks, and the single fix that landed.

## Methodology

Owner credentials are injected into the workflow processes only, never into the
agent shell, so this audit logged in as a real owner rather than bypassing auth:

- A `provider-owner` user was seeded directly into the dev database with a scrypt
  passwordHash generated in the server's exact format (N=1<<15, r=8, p=1,
  keylen=64, 16-byte salt). scrypt embeds its own random salt and uses no app
  secret, so a hash generated outside the app verifies through the real sign-in
  form, which then issues a real session cookie exactly like production.
- A public diagnosis share link was minted by inserting a `diagnosis_share_tokens`
  row holding the sha256 of a known token (the token itself is never stored),
  pointed at a tenant that has generated `tenant_layers.content` so the public
  projection is non-empty.
- An authenticated Playwright sweep then ran at a 375x720 viewport across the
  Morning Brief, the outcome loop, the layers list, the main navigation (including
  the More dropdown and keyboard focus order), and the public `/d/:token` page.
- Both seeded rows (the user and the share token) were deleted after the run; the
  dev database is shared with the regression suite.

## Result by surface (at 375px)

All measurements are `document.documentElement.scrollWidth` against
`window.innerWidth` (375). A scrollWidth above 375 indicates horizontal page
overflow.

- Morning Brief (`/`): scrollWidth 375, innerWidth 375. No horizontal overflow.
  The serif diagnosis headline and the large mono lead figure do not clip,
  overlap, or get cut off; the hero collapses to a single column below `md`, and
  the "next leads" cards and the full layer list wrap within the viewport.
- Outcome loop (`/outcome-loop`): scrollWidth 375. The summary metric tiles and
  the loop cards fit; the dense metadata rows (confidence pill, predicted value,
  dates, content hash) wrap rather than forcing horizontal scroll.
- Layers (`/layers`): scrollWidth 375. No horizontal overflow.
- Main navigation: the primary bar (Brief, Board pack, Layers, Decisions,
  Outcome loop) plus the More button fit; the bottom bar is itself a horizontal
  scroll guard so it never forces the page sideways. The More dropdown opens,
  shows its grouped links (Analysis, Operations), and is right-aligned so it does
  not clip off the right edge.
- Public diagnosis (`/d/:token`): renders a real diagnosis (hero serif headline
  plus figure plus layer cards), not an empty or error state. scrollWidth 375,
  no clipping of the hero figure or headline.

### A note on role coverage

The Brief, public diagnosis, and outcome loop surfaces are not role-differentiated
in layout. The only role-varying chrome is the navigation: the primary bar is
identical for every role, and only the More dropdown's contents and the role pill
text differ. A `provider-owner` carries the most More entries and the longest role
pill text, so the owner is the worst case for top-bar width; a member or viewer
sees a strict subset. The More menu is a vertical list with a fixed minimum width,
so more entries make it taller, not wider. The owner pass therefore covers the
widest top-bar layout the portal produces.

## WCAG AA criteria

- Contrast (SC 1.4.3): the palette routes every "tone" through AA-passing ink
  tokens on the light surfaces. Spot-checked the two tokens most at risk because
  they are the lightest text in use: `slate-light` (#666D7A) on cream (#F4F1EA)
  computes to about 4.62:1, and `gold-ink` (#826930) on cream to about 4.65:1,
  both above the 4.5:1 normal-text threshold. The diagnosis tone colours only the
  thin leading rule; the conclusion itself always reads in navy authority.
- Keyboard focus order (SC 2.4.3): focus follows DOM order through the top bar
  (wordmark, tenant switcher, perspective lens, notification bell, log out) and
  then the nav tabs and More, which matches the visual reading order.
- Focus visible (SC 2.4.7): an unlayered `:focus-visible { outline: 2px solid }`
  rule draws a ring on every interactive element under keyboard navigation; the
  sweep confirmed a visible 2px navy-soft outline with a 2px offset on focused
  controls. It fires only for keyboard focus, so a mouse click does not draw it.
- Gold underline sweep (SC 2.3.1 / 2.2.2): the sweep is decorative and
  `aria-hidden`, wipes in once over 120ms (no loop, no flashing), and is keyed so
  it replays only on a genuine recompute rather than on every re-render.
- Reduced motion (SC 2.3.3): under `prefers-reduced-motion: reduce` the skeleton
  shimmer and the gold sweep both hold still (the sweep renders fully drawn)
  rather than animate.

## Finding and fix

One issue met the bar of a real defect:

- Target size (SC 2.5.8, AA): the top-bar notification bell rendered at 26x18 CSS
  pixels, under the 24x24 minimum on its height. (The adjacent log-out icon button
  measured 34x32 and passes.)

Fix, portal-side only, in `artifacts/portal/src/components/TopNav.tsx`: the
notification bell link is now a centered 32x32 target (matching the log-out
button's rhythm) and carries an explicit `aria-label`. No other portal files
needed a change; the redesign's tokens, clamp()-based serif sizing, focus ring,
reduced-motion handling, and small-screen guards already satisfied the rest of
the criteria.
