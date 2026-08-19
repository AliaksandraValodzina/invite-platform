/**
 * WCAG 2.1 contrast, over theme tokens.
 *
 * This exists so that the contrast table in data/ip-design-directions/report.md
 * stops being prose. That table was computed once, by hand, with these formulas
 * over every text pair a block can actually produce. A document cannot fail a
 * pull request, so the numbers are recomputed here and asserted in
 * tests/unit/template/contrast.test.ts. A later tweak to a hex fails a test
 * rather than silently shipping unreadable type onto somebody's wedding page.
 *
 * Colours are hex only, and `hexColourSchema` rejects the eight digit form, so
 * every value reaching these functions is opaque and a ratio is computable
 * without knowing what is behind it. That is the whole reason the alpha form is
 * refused: the report's own rule is that an `inkMuted` border dimmed to 40%
 * alpha drops under 3.0:1, and a token set that cannot express the dimming
 * cannot ship it.
 */

/** Normal text. Anything a guest reads a sentence of. */
export const AA_NORMAL_TEXT = 4.5
/** Large text, and any non text boundary such as a form control outline. */
export const AA_LARGE_TEXT = 3.0
/** The enhanced floor. Reported, never required: AA is the contract. */
export const AAA_NORMAL_TEXT = 7.0

/**
 * WCAG 2.1 counts text as large at 18pt, or 14pt bold. In CSS pixels that is
 * 24px, or 18.66px at weight 700 or above.
 */
export const LARGE_TEXT_PX = 24
export const LARGE_BOLD_TEXT_PX = 18.66
export const BOLD_WEIGHT = 700

export function isLargeText(sizePx: number, weight: number): boolean {
  return sizePx >= LARGE_TEXT_PX || (weight >= BOLD_WEIGHT && sizePx >= LARGE_BOLD_TEXT_PX)
}

/** The floor a pair has to clear, given the type it is set in. */
export function requiredRatio(sizePx: number, weight: number): number {
  return isLargeText(sizePx, weight) ? AA_LARGE_TEXT : AA_NORMAL_TEXT
}

export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

/** Accepts `#rgb` and `#rrggbb`. Throws on anything else, including `#rrggbbaa`. */
export function parseHex(colour: string): Rgb {
  const digits = colour.trim().replace(/^#/, '')

  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new Error(`not an opaque hex colour: ${colour}`)
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

/** The sRGB channel transfer function from WCAG 2.1, verbatim. */
function channelLuminance(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(colour: string | Rgb): number {
  const { r, g, b } = typeof colour === 'string' ? parseHex(colour) : colour
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** (L1 + 0.05) / (L2 + 0.05), lighter over darker. Always >= 1. */
export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Two decimal places, which is the precision the report's table is written to.
 * Rounding here rather than in each assertion is what lets a test compare
 * against the published number instead of against a tolerance nobody chose.
 */
export function contrastRatioTo2dp(foreground: string, background: string): number {
  return Math.round(contrastRatio(foreground, background) * 100) / 100
}
