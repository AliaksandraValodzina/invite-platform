# The Open Graph share card

The card is the 1200x630 image that appears when a buyer pastes their event link
into WhatsApp, iMessage or an Instagram DM. It is the product's first
impression, and it is generated per event from theme tokens plus the event's own
fields. Code is in `src/lib/og/`, served from `src/app/api/og/route.tsx`.

## The constraint that decided the design

A link preview is first seen as a thumbnail roughly **120px wide** in a chat
bubble. That is a tenth of the card, so "does it look good at 1200x630" is the
wrong question. Downscaling averages a stroke together with the background
around it, so type that is too small does not arrive blurry, it arrives as a
flat grey band.

Two things follow, and both are enforced rather than trusted:

- **Exactly one element has to survive the thumbnail: the title.** Its floor is
  derived, not chosen: `MIN_LEGIBLE_THUMBNAIL_PX / OG_THUMBNAIL_SCALE`, which is
  90px today. Everything else is for the guest who opens the preview at full
  size and is allowed to become texture at 120px.
- **A title too long for the floor truncates, it does not shrink.** A title that
  has lost its last word still reads as an invitation. A title rendered as a
  grey smear does not.

`tests/e2e/og-card.spec.ts` fetches the real PNG, draws it into a canvas at a
tenth of its size, reads the pixels back and asserts the title band still clears
4.5:1 against the background and still has the extent of words. That test has
been shown to go red when the floor is lowered.

## What comes from the theme and what comes from the card

The rule is that a block consumes tokens and nothing else. The card follows it,
with one boundary worth stating plainly because it is the first thing a reviewer
will look for.

| From the theme                                         | From the card       |
| ------------------------------------------------------ | ------------------- |
| every colour, via `ink`, `inkMuted`, `accent` and `bg` | the type sizes      |
| both font stacks (`font.heading`, `font.body`)         | the slot order      |
| every weight and letter spacing, from `typeScale`      | the 1200x630 canvas |
| the rule's corner radius, from `radius.sm`             | the thumbnail floor |
| all vertical padding and gaps, from `space`            |                     |

The type sizes are card geometry rather than styling. The card is a fixed
artifact that has to survive a 10x downscale, and a rem scale designed for a
320px phone cannot answer that question. Those sizes are identical for every
theme, so no theme can be given a different card by changing them.

There is one place where a theme gives way: if a theme's spacing tokens would
squeeze the title below two lines at the floor, the gaps compress and the plan
reports `gapsCompressed`. The title wins because the title is the only thing
that has to survive the thumbnail. Neither seed theme needs this today, and a
unit test asserts that.

## Slots

Six, stacked down a centred column, all optional except the title, the rule and
the date.

```
kicker      hero eyebrow, uppercase, caption tracking, inkMuted
title       events.title, 90px to 132px, at most two lines, ink
rule        168x12 accent bar, radius from the theme
date        events.starts_at_local, formatted, ink
venue       map block venue name, inkMuted
footer      the share URL, inkMuted
```

## Colour pairs

`OG_CARD_CONTRAST_PAIRS` names every ink the card puts on the page as a pair of
token roles with a WCAG minimum. `checkOgCardLegibility` reports the pairs a
theme cannot meet, and the unit suite runs it over every seed theme, so a theme
that would render an illegible card fails the pull request.

It reports rather than repairs. Swapping a role at render time would hide a
broken palette behind a card that looks fine, while the same palette is about to
be used on the guest page where nothing is watching.

Note what is not in the list: `ink` on `accent` and `accent` on `ink` are both
around 1.8:1 in all three design directions the scout report measured, so the
card never fills a shape with `accent` and writes on it.

## Lines are planned, not wrapped

Satori wraps text itself, and the plan's line count is an estimate made without
font metrics, so the two can disagree. When they did, during development, the
extra line pushed the block past its slot and the clip removed a line from the
middle of the title: the card dropped one of the two names on the invitation and
still looked perfectly composed.

So the plan decides the lines and the renderer draws each one as a non wrapping
row. A line the estimate gets wrong now hangs over the edge of its slot and is
clipped there, and the pixel test asserts clearance on all four sides of the
title, so it goes red instead of silently rearranging somebody's name.

The width estimate itself is a table of per character advances in
`src/lib/og/text.ts`, calibrated against a real render and biased high on
purpose. **When a display face is registered, rerun the Playwright suite: it is
the calibration harness.**

## Time

`events.starts_at_local` is a wall clock, not an instant, so the card reads its
components and formats them. Nothing calls `new Date(string)`, which would parse
it in the server's zone. There is no time zone abbreviation on the card, because
printing one means resolving the wall clock to an instant, and the two hours a
year where that is ambiguous are exactly the hours somebody schedules a ceremony
for.

## The Phase 0.7 seam

The route takes its fields as query parameters because there is no event read
path yet. When phases 0.4 to 0.6 land, the handler resolves a slug through the
service role and passes the same fields to the same `planOgCard`. Nothing about
the layout, the tokens or the tests changes.

Two consequences until then:

- Anyone can ask the route for a card carrying their own text. Parameters are
  length capped and the response is `X-Robots-Tag: noindex`, but the real fix is
  the lookup.
- The response is immutably cacheable because every input is in the URL, so
  there is no stale card to invalidate when a buyer edits their title.

`buildEventShareMetadata` already produces the tags the guest page will need:
absolute `og:image` with declared width, height and alt, and
`summary_large_image` for Twitter and X. A relative `og:image` renders no
preview at all, which is why the absolute URL is asserted.

## Fonts

The card currently renders in the face `next/og` bundles, because the captain
has not chosen between the three design directions in
`data/ip-design-directions/report.md`. Satori needs real font data and will not
resolve a CSS font stack on its own, so registering the chosen display and body
faces is a follow up. The layout does not change when it happens: only the
advance table needs recalibrating, and the Playwright suite is what checks it.
