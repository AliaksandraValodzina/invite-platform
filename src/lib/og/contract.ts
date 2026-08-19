/**
 * What the share card is contracted to do, expressed as numbers a test can read.
 *
 * The card is the first impression of the product. It is pasted into WhatsApp,
 * iMessage and Instagram DMs, and in every one of those it first appears as a
 * thumbnail roughly 120px wide inside a chat bubble. That is a tenth of the
 * card, so the design constraint is not "does it look good at 1200x630", it is
 * "what is still readable after a 10x downscale".
 *
 * Two consequences, and both are enforced rather than hoped for:
 *
 *   1. Exactly one element has to survive the thumbnail: the title. Its size
 *      floor is derived from the thumbnail scale below, never chosen by eye.
 *      Everything else on the card is for the guest who opens the preview at
 *      full size, and is allowed to become texture at 120px.
 *   2. Every colour pair the card renders is a pair of token ROLES with a
 *      minimum contrast. When a theme cannot meet it the fix goes into that
 *      theme, not into the card, so this file only reports.
 */

import type { ColourRole, ThemeTokens } from '@/lib/template'

/** The size every chat app crops its preview from. */
export const OG_CARD_WIDTH = 1200
export const OG_CARD_HEIGHT = 630

/** Roughly what a link preview occupies in a chat bubble on a phone. */
export const OG_THUMBNAIL_WIDTH = 120
export const OG_THUMBNAIL_SCALE = OG_THUMBNAIL_WIDTH / OG_CARD_WIDTH

/**
 * Below about 9 rendered pixels a downscaled line of text stops being words and
 * becomes a grey band. This is the number the title floor is derived from, and
 * the Playwright suite proves it by measuring a real downscaled render rather
 * than trusting the arithmetic.
 */
export const MIN_LEGIBLE_THUMBNAIL_PX = 9

/** The title never renders smaller than this. It truncates instead. */
export const MIN_TITLE_FONT_SIZE = Math.ceil(MIN_LEGIBLE_THUMBNAIL_PX / OG_THUMBNAIL_SCALE)

export type OgSlotName = 'kicker' | 'title' | 'rule' | 'date' | 'venue' | 'footer'

export type OgContrastPair = {
  readonly slot: OgSlotName
  readonly foreground: ColourRole
  readonly background: ColourRole
  /** WCAG 2.1: 4.5 for text, 3 for a graphic. */
  readonly minimum: number
}

/**
 * Every ink the card puts on the page, as a role pair.
 *
 * The card renders these and only these, so a theme that clears this list has a
 * legible card by construction. Note what is not here: `ink` on `accent` and
 * `accent` on `ink` are both around 1.8:1 in every direction the design scout
 * measured, so the card never fills a shape with `accent` and writes on it.
 */
export const OG_CARD_CONTRAST_PAIRS: readonly OgContrastPair[] = [
  { slot: 'title', foreground: 'ink', background: 'bg', minimum: 4.5 },
  { slot: 'date', foreground: 'ink', background: 'bg', minimum: 4.5 },
  { slot: 'kicker', foreground: 'inkMuted', background: 'bg', minimum: 4.5 },
  { slot: 'venue', foreground: 'inkMuted', background: 'bg', minimum: 4.5 },
  { slot: 'footer', foreground: 'inkMuted', background: 'bg', minimum: 4.5 },
  { slot: 'rule', foreground: 'accent', background: 'bg', minimum: 3 },
]

export type OgLegibilityFailure = OgContrastPair & {
  readonly ratio: number
  readonly message: string
}

/**
 * Reports the pairs a theme cannot render legibly on the card.
 *
 * It reports rather than repairs. Swapping a role at render time would hide a
 * broken palette behind a card that looks fine, and the same palette is about
 * to be used on the guest page where nothing is watching. The seed themes are
 * checked by the unit suite, so a theme that fails this fails the pull request.
 */
export function checkOgCardLegibility(tokens: ThemeTokens): OgLegibilityFailure[] {
  const failures: OgLegibilityFailure[] = []

  for (const pair of OG_CARD_CONTRAST_PAIRS) {
    const ratio = contrastRatio(tokens.color[pair.foreground], tokens.color[pair.background])
    if (ratio >= pair.minimum) continue

    failures.push({
      ...pair,
      ratio,
      message:
        `the ${pair.slot} slot renders ${pair.foreground} on ${pair.background} at ` +
        `${ratio.toFixed(2)}:1, and needs ${pair.minimum}:1`,
    })
  }

  return failures
}

type Rgb = { r: number; g: number; b: number; a: number }

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function parseHex(value: string): Rgb {
  if (!HEX.test(value)) {
    throw new TypeError(`expected a token hex colour such as #1b1b1f, got "${value}"`)
  }

  const digits = value.slice(1)
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  }
}

/** Composites a possibly translucent colour over an opaque one. */
function over(top: Rgb, bottom: Rgb): Rgb {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  }
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * WCAG 2.1 contrast ratio between two token colours.
 *
 * Alpha is composited rather than ignored. The token schema allows `#rrggbbaa`,
 * and a translucent ink reported at its opaque ratio is a passing number for
 * text a guest cannot read. The bottom colour is composited over white, which
 * is what a translucent page background sits on.
 */
export function contrastRatio(foreground: string, background: string): number {
  const white: Rgb = { r: 255, g: 255, b: 255, a: 1 }
  const bottom = over(parseHex(background), white)
  const top = over(parseHex(foreground), bottom)

  const a = relativeLuminance(top)
  const b = relativeLuminance(bottom)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)

  return (lighter + 0.05) / (darker + 0.05)
}
