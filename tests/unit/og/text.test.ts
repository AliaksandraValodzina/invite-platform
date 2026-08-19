import { describe, expect, it } from 'vitest'

import { estimateTextWidth, truncateToLines, wrapEstimate } from '@/lib/og'

describe('estimateTextWidth', () => {
  it('scales with the font size', () => {
    expect(estimateTextWidth('Emma & Jake', 100)).toBeCloseTo(
      estimateTextWidth('Emma & Jake', 50) * 2,
      6
    )
  })

  it('charges capitals more than lower case, which is why a shouted title wraps sooner', () => {
    expect(estimateTextWidth('EMMA', 100)).toBeGreaterThan(estimateTextWidth('emma', 100))
  })

  it('charges a wide letter more than a narrow one', () => {
    expect(estimateTextWidth('mmmm', 100)).toBeGreaterThan(estimateTextWidth('llll', 100))
  })

  it('is close enough to the bundled face to be usable', () => {
    // Measured off a real next/og render of "Emma & Jake" at 120px in the
    // bundled Geist: the glyphs span roughly 750px. The estimate has to be in
    // that neighbourhood and must never come in under it, because under
    // estimating width is what puts a title through the edge of the card.
    const estimated = estimateTextWidth('Emma & Jake', 120)
    expect(estimated).toBeGreaterThanOrEqual(750)
    expect(estimated).toBeLessThan(1050)
  })
})

describe('wrapEstimate', () => {
  it('keeps a short title on one line', () => {
    expect(wrapEstimate('Emma & Jake', 132, 1040)).toEqual(['Emma & Jake'])
  })

  it('breaks on words rather than mid word', () => {
    const lines = wrapEstimate('Alexandra & Christopher', 132, 1040)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line).not.toMatch(/^\s|\s$/)
      expect(estimateTextWidth(line, 132)).toBeLessThanOrEqual(1040)
    }
    expect(lines.join(' ')).toBe('Alexandra & Christopher')
  })

  it('breaks inside a single word that cannot fit, rather than overflowing', () => {
    const lines = wrapEstimate('Featherstonehaughlongestwordimaginable', 132, 400)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(estimateTextWidth(line, 132)).toBeLessThanOrEqual(400)
    }
    expect(lines.join('')).toBe('Featherstonehaughlongestwordimaginable')
  })
})

describe('truncateToLines', () => {
  it('leaves text that already fits completely alone', () => {
    expect(truncateToLines('Emma & Jake', 132, 1040, 2)).toBe('Emma & Jake')
  })

  it('truncates with an ellipsis rather than shrinking past the legible floor', () => {
    const long = 'A'.repeat(160)
    const truncated = truncateToLines(long, 96, 1040, 2)

    expect(truncated.endsWith('…')).toBe(true)
    expect(truncated.length).toBeLessThan(long.length)
    expect(wrapEstimate(truncated, 96, 1040).length).toBeLessThanOrEqual(2)
  })

  it('does not leave a dangling space before the ellipsis', () => {
    const truncated = truncateToLines(
      'Emma and Jake and every single one of their many relatives',
      96,
      1040,
      2
    )
    expect(truncated).not.toMatch(/\s…$/)
  })
})
