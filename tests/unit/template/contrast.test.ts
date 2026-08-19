/**
 * The contrast table from data/ip-design-directions/report.md, executable.
 *
 * The report computed those ratios once, by hand, with the WCAG 2.1 relative
 * luminance formula over every text pair a block can actually produce. A
 * document cannot fail a pull request, so they are recomputed here from the
 * committed theme files. A later tweak to a hex now fails a test instead of
 * silently shipping unreadable type onto somebody's wedding page, which is what
 * the report meant by "changing one silently breaks that table".
 *
 * Three things are asserted, and the second and third matter more than the first:
 *
 *   the floors, for every pair the report lists as passing;
 *   the published ratio, to the two decimal places the report is written to, so
 *   a pair that drifted from 8.16 to 4.6 fails rather than passing a floor;
 *   the pairings that fail in all three directions, which are asserted to be
 *   unreachable rather than merely unused.
 *
 * The formula itself is checked first, against values that are true by
 * definition. A contrast function nobody has watched agree with a known answer
 * is a function that can quietly return 21 for everything.
 */

import { describe, expect, it } from 'vitest'

import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  COLOUR_ROLES,
  contrastRatio,
  contrastRatioTo2dp,
  isLargeText,
  parseHex,
  relativeLuminance,
  requiredRatio,
  themePipeline,
  type ColourRole,
  type ThemeTokens,
} from '@/lib/template'

import {
  ALL_THEMES,
  DECKLE_AND_DEBOSS_THEME,
  FOIL_AND_MIDNIGHT_THEME,
  MASTHEAD_THEME,
  readSeedFile,
} from './seed-files'

describe('the formula', () => {
  it('agrees with the ratios that are true by definition', () => {
    expect(contrastRatioTo2dp('#000000', '#ffffff')).toBe(21)
    expect(contrastRatioTo2dp('#ffffff', '#ffffff')).toBe(1)
    // Symmetric: the ratio is lighter over darker, not foreground over
    // background, so swapping the arguments cannot change the answer.
    expect(contrastRatioTo2dp('#ffffff', '#767676')).toBe(contrastRatioTo2dp('#767676', '#ffffff'))
  })

  it('agrees with the WCAG reference luminances', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    // 0.2126 + 0.7152 + 0.0722 is the whole formula, one channel at a time.
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 10)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 10)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 10)
    // Below the 0.03928 knee, where the transfer function is linear.
    expect(relativeLuminance('#010101')).toBeCloseTo(1 / 255 / 12.92, 12)
  })

  it('expands the three digit form the way CSS does', () => {
    expect(parseHex('#fff')).toEqual(parseHex('#ffffff'))
    expect(parseHex('#1b2')).toEqual({ r: 0x11, g: 0xbb, b: 0x22 })
  })

  it('refuses a colour it cannot compute a ratio for', () => {
    // An eight digit hex is translucent, and a ratio against a translucent
    // colour needs every layer behind it. The token schema rejects the form for
    // the same reason, so this is belt and braces on the same rule.
    expect(() => parseHex('#5b606866')).toThrow()
    expect(() => parseHex('rebeccapurple')).toThrow()
  })

  it('knows what WCAG counts as large text', () => {
    expect(isLargeText(24, 400)).toBe(true)
    expect(isLargeText(23.9, 400)).toBe(false)
    expect(isLargeText(19, 700)).toBe(true)
    expect(isLargeText(19, 600)).toBe(false)
    expect(requiredRatio(16, 400)).toBe(AA_NORMAL_TEXT)
    expect(requiredRatio(40, 400)).toBe(AA_LARGE_TEXT)
  })
})

type Pair = {
  readonly fg: ColourRole
  readonly bg: ColourRole
  readonly ratio: number
  readonly usedFor: string
}

/**
 * The report's table, row for row, in the report's own order. `ratio` is the
 * published number and it is asserted exactly, not as a floor.
 */
const PASSING: Readonly<Record<string, readonly Pair[]>> = {
  'Deckle & Deboss': [
    { fg: 'ink', bg: 'bg', ratio: 14.79, usedFor: 'Body text on page' },
    { fg: 'ink', bg: 'surface', ratio: 16.0, usedFor: 'Body text on card' },
    { fg: 'inkMuted', bg: 'bg', ratio: 5.61, usedFor: 'Captions and labels on page' },
    { fg: 'inkMuted', bg: 'surface', ratio: 6.06, usedFor: 'Captions and labels on card' },
    { fg: 'accent', bg: 'bg', ratio: 8.16, usedFor: 'Accent text and links on page' },
    { fg: 'accent', bg: 'surface', ratio: 8.82, usedFor: 'Accent text and links on card' },
    { fg: 'bg', bg: 'accent', ratio: 8.16, usedFor: 'RSVP button label on accent fill' },
    { fg: 'surface', bg: 'accent', ratio: 8.82, usedFor: 'Button label on accent fill, on a card' },
  ],
  Masthead: [
    { fg: 'ink', bg: 'bg', ratio: 18.27, usedFor: 'Body text on page' },
    { fg: 'ink', bg: 'surface', ratio: 16.02, usedFor: 'Body text on card' },
    { fg: 'inkMuted', bg: 'bg', ratio: 6.67, usedFor: 'Captions and labels on page' },
    { fg: 'inkMuted', bg: 'surface', ratio: 5.85, usedFor: 'Captions and labels on card' },
    { fg: 'accent', bg: 'bg', ratio: 8.7, usedFor: 'Accent text and links on page' },
    { fg: 'accent', bg: 'surface', ratio: 7.63, usedFor: 'Accent text and links on card' },
    { fg: 'bg', bg: 'accent', ratio: 8.7, usedFor: 'RSVP button label on accent fill' },
    { fg: 'surface', bg: 'accent', ratio: 7.63, usedFor: 'Button label on accent fill, on a card' },
  ],
  'Foil & Midnight': [
    { fg: 'ink', bg: 'bg', ratio: 15.1, usedFor: 'Body text on page' },
    { fg: 'ink', bg: 'surface', ratio: 12.9, usedFor: 'Body text on card' },
    { fg: 'inkMuted', bg: 'bg', ratio: 8.01, usedFor: 'Captions and labels on page' },
    { fg: 'inkMuted', bg: 'surface', ratio: 6.84, usedFor: 'Captions and labels on card' },
    { fg: 'accent', bg: 'bg', ratio: 8.73, usedFor: 'Accent text and links on page' },
    { fg: 'accent', bg: 'surface', ratio: 7.46, usedFor: 'Accent text and links on card' },
    { fg: 'bg', bg: 'accent', ratio: 8.73, usedFor: 'RSVP button label on accent fill' },
    { fg: 'surface', bg: 'accent', ratio: 7.46, usedFor: 'Button label on accent fill, on a card' },
  ],
}

/** The report's "worst text pair" line, per direction. */
const WORST: Readonly<Record<string, number>> = {
  'Deckle & Deboss': 5.61,
  Masthead: 5.85,
  'Foil & Midnight': 6.84,
}

const TOKENS: Readonly<Record<string, ThemeTokens>> = {
  'Deckle & Deboss': themePipeline.parse(readSeedFile(DECKLE_AND_DEBOSS_THEME)).tokens,
  Masthead: themePipeline.parse(readSeedFile(MASTHEAD_THEME)).tokens,
  'Foil & Midnight': themePipeline.parse(readSeedFile(FOIL_AND_MIDNIGHT_THEME)).tokens,
}

describe.each(Object.keys(PASSING))('%s', (direction) => {
  const tokens = TOKENS[direction] as ThemeTokens
  const pairs = PASSING[direction] as readonly Pair[]

  it.each(pairs)('$fg on $bg clears AA: $usedFor', (pair) => {
    const ratio = contrastRatioTo2dp(tokens.color[pair.fg], tokens.color[pair.bg])

    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    // The published number, not just the floor. A pair that slid from 8.16 to
    // 4.6 would still clear AA, and it would still be a change to a palette
    // that was signed off against a measured table.
    expect(ratio).toBe(pair.ratio)
  })

  it('has the worst text pair the report says it has', () => {
    // Computed over every pair rather than read off the list above, so a new
    // row that is worse than all of them cannot slip past.
    const worst = Math.min(
      ...pairs.map((pair) => contrastRatioTo2dp(tokens.color[pair.fg], tokens.color[pair.bg]))
    )

    expect(worst).toBe(WORST[direction])
  })

  it('gives a form control a boundary that clears the non text floor', () => {
    // The report: surface is about 1.1:1 against bg on purpose, so a card is not
    // delimited by its fill and "every RSVP form input" cannot get a boundary
    // from it. It has to use inkMuted, at full opacity.
    expect(contrastRatio(tokens.color.inkMuted, tokens.color.bg)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT
    )
    expect(contrastRatio(tokens.color.inkMuted, tokens.color.surface)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT
    )
  })
})

/**
 * The three pairings the report lists as failing in all three directions.
 *
 * These matter more than the passing ones, so they are asserted twice over: the
 * numbers are pinned here, and each one is made unreachable somewhere a block
 * cannot argue with. `themeColoursSchema` refuses a theme whose accentInk is
 * anything but bg or surface, and `findContrastViolations` in
 * tests/unit/components refuses a block that writes the pairing. This file is
 * the evidence that they are worth refusing.
 */
describe('the pairings that fail in all three directions', () => {
  const FAILING = [
    {
      name: 'ink on an accent fill',
      of: (tokens: ThemeTokens) => [tokens.color.ink, tokens.color.accent] as const,
      ratios: { 'Deckle & Deboss': 1.81, Masthead: 2.1, 'Foil & Midnight': 1.73 },
    },
    {
      name: 'accent on an ink fill',
      of: (tokens: ThemeTokens) => [tokens.color.accent, tokens.color.ink] as const,
      ratios: { 'Deckle & Deboss': 1.81, Masthead: 2.1, 'Foil & Midnight': 1.73 },
    },
    {
      name: 'surface against bg',
      of: (tokens: ThemeTokens) => [tokens.color.surface, tokens.color.bg] as const,
      ratios: { 'Deckle & Deboss': 1.08, Masthead: 1.14, 'Foil & Midnight': 1.17 },
    },
  ] as const

  for (const failing of FAILING) {
    it(`${failing.name} is the ratio the report measured, and is below every floor`, () => {
      for (const [direction, tokens] of Object.entries(TOKENS)) {
        const [fg, bg] = failing.of(tokens)
        const ratio = contrastRatioTo2dp(fg, bg)

        expect(ratio).toBe(failing.ratios[direction as keyof typeof failing.ratios])
        // Below 3.0 as well as below 4.5, so it is not even usable as a large
        // text pair or as a non text boundary. There is no size that rescues it.
        expect(ratio).toBeLessThan(AA_LARGE_TEXT)
      }
    })
  }

  it('cannot be produced by a theme, because accentInk is bg or surface', () => {
    // Structural rather than numeric. The block set draws exactly one thing on
    // an accent fill, the RSVP button label, and it draws it in accentInk. This
    // is what stops accentInk being ink.
    for (const [, path] of ALL_THEMES) {
      const { color } = themePipeline.parse(readSeedFile(path)).tokens
      expect([color.bg, color.surface]).toContain(color.accentInk)
      expect(color.accentInk).not.toBe(color.ink)
    }
  })
})

/**
 * Every theme the repo ships, not only the three directions.
 *
 * The direction tests above assert published numbers, which is a claim about
 * three particular palettes. This is the claim about the catalogue: whatever is
 * in templates/themes, the block set can draw its text on it and be read. It is
 * what turns a sixth theme written next year into a pull request that goes red
 * rather than a page nobody can read.
 */
describe('every committed theme', () => {
  /**
   * Foreground and background as the block set actually pairs them. Taken from
   * the table in docs/blocks.md, so a block that starts using a role in a new
   * place is a documentation change and a test change together.
   */
  const DRAWN: readonly { readonly fg: ColourRole; readonly bg: ColourRole }[] = [
    { fg: 'ink', bg: 'bg' },
    { fg: 'ink', bg: 'surface' },
    { fg: 'inkMuted', bg: 'bg' },
    { fg: 'inkMuted', bg: 'surface' },
    { fg: 'accent', bg: 'bg' },
    { fg: 'accent', bg: 'surface' },
    { fg: 'critical', bg: 'bg' },
    { fg: 'critical', bg: 'surface' },
    { fg: 'accentInk', bg: 'accent' },
  ]

  it.each(ALL_THEMES)(
    '%s draws every text pair the block set can produce above AA',
    (_name, path) => {
      const { color } = themePipeline.parse(readSeedFile(path)).tokens

      const failures = DRAWN.filter(
        (pair) => contrastRatioTo2dp(color[pair.fg], color[pair.bg]) < AA_NORMAL_TEXT
      ).map(
        (pair) => `${pair.fg} on ${pair.bg}: ${contrastRatioTo2dp(color[pair.fg], color[pair.bg])}`
      )

      expect(failures).toEqual([])
    }
  )

  it.each(ALL_THEMES)('%s gives a form control boundary that clears 3.0:1', (_name, path) => {
    const { color } = themePipeline.parse(readSeedFile(path)).tokens

    expect(contrastRatio(color.inkMuted, color.bg)).toBeGreaterThanOrEqual(AA_LARGE_TEXT)
    expect(contrastRatio(color.inkMuted, color.surface)).toBeGreaterThanOrEqual(AA_LARGE_TEXT)
  })

  it.each(ALL_THEMES)('%s carries an opaque value for every role', (_name, path) => {
    const { color } = themePipeline.parse(readSeedFile(path)).tokens

    // Not a restatement of the schema: this is what makes every ratio above
    // computable at all. If a role ever became translucent, every number in this
    // file would quietly start describing a colour nobody sees.
    for (const role of COLOUR_ROLES) expect(() => parseHex(color[role])).not.toThrow()
  })
})
