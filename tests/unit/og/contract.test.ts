import { describe, expect, it } from 'vitest'

import {
  MIN_TITLE_FONT_SIZE,
  OG_CARD_CONTRAST_PAIRS,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  OG_THUMBNAIL_SCALE,
  OG_THUMBNAIL_WIDTH,
  checkOgCardLegibility,
  contrastRatio,
} from '@/lib/og'

import { IVORY_TOKENS, SEED_THEMES } from './fixtures'

describe('card dimensions', () => {
  it('is the 1200x630 that WhatsApp, iMessage and Instagram all crop from', () => {
    expect(OG_CARD_WIDTH).toBe(1200)
    expect(OG_CARD_HEIGHT).toBe(630)
  })

  it('derives the thumbnail scale from the chat bubble width, not from a guess', () => {
    expect(OG_THUMBNAIL_WIDTH).toBe(120)
    expect(OG_THUMBNAIL_SCALE).toBeCloseTo(0.1, 10)
  })

  it('sets the title floor so it survives the downscale as readable text', () => {
    // The whole point of the floor. At 120px wide the card is rendered at a
    // tenth, so a title below this size arrives in the chat bubble as texture.
    expect(MIN_TITLE_FONT_SIZE * OG_THUMBNAIL_SCALE).toBeGreaterThanOrEqual(9)
  })
})

describe('contrastRatio', () => {
  it('computes the WCAG 2.1 ratio for the extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric, because a pair is a pair', () => {
    expect(contrastRatio('#23201c', '#fdfbf7')).toBeCloseTo(contrastRatio('#fdfbf7', '#23201c'), 10)
  })

  it('accepts the three hex forms the token schema accepts', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 2)
    // An alpha suffix is composited over the background rather than ignored,
    // because ignoring it reports a passing ratio for text that is not there.
    expect(contrastRatio('#00000080', '#ffffff')).toBeLessThan(contrastRatio('#000000', '#ffffff'))
  })

  it('rejects anything that is not a token hex colour', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow(/hex/i)
    expect(() => contrastRatio('var(--color-ink)', '#ffffff')).toThrow(/hex/i)
  })
})

describe('checkOgCardLegibility', () => {
  it('names every pair the card actually renders', () => {
    const slots = OG_CARD_CONTRAST_PAIRS.map((pair) => pair.slot)
    expect(slots).toEqual(['title', 'date', 'kicker', 'venue', 'footer', 'rule'])

    // Text needs AA. The rule is a graphic, so it needs the non-text threshold.
    for (const pair of OG_CARD_CONTRAST_PAIRS) {
      expect(pair.minimum).toBe(pair.slot === 'rule' ? 3 : 4.5)
    }
  })

  it.each(SEED_THEMES)('passes for the %s seed theme', (_name, tokens) => {
    expect(checkOgCardLegibility(tokens)).toEqual([])
  })

  it('fails, with the pair named, when a theme cannot hold its own muted text', () => {
    // inkMuted lifted until it is barely off the ivory background. This is the
    // failure the check exists for, and the fix belongs in the theme.
    const broken = {
      ...IVORY_TOKENS,
      color: { ...IVORY_TOKENS.color, inkMuted: '#eae4da' },
    }

    const failures = checkOgCardLegibility(broken)

    expect(failures.map((failure) => failure.slot)).toEqual(['kicker', 'venue', 'footer'])
    expect(failures[0]).toMatchObject({
      slot: 'kicker',
      foreground: 'inkMuted',
      background: 'bg',
      minimum: 4.5,
    })
    expect(failures[0]?.ratio).toBeLessThan(4.5)
    expect(failures[0]?.message).toMatch(/inkMuted on bg/)
  })

  it('fails when the accent rule sinks into the background', () => {
    const broken = {
      ...IVORY_TOKENS,
      color: { ...IVORY_TOKENS.color, accent: '#fbf8f2' },
    }

    const failures = checkOgCardLegibility(broken)

    expect(failures.map((failure) => failure.slot)).toEqual(['rule'])
    expect(failures[0]?.ratio).toBeLessThan(3)
  })
})
