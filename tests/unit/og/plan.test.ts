import { describe, expect, it } from 'vitest'

import {
  MIN_TITLE_FONT_SIZE,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  OG_THUMBNAIL_SCALE,
  estimateTextWidth,
  planOgCard,
  type OgCardPlan,
  type OgSlotName,
  type OgTextSlot,
} from '@/lib/og'

import { IVORY_TOKENS, LONG_TITLE, MAX_TITLE_LENGTH, SAMPLE_EVENT, SEED_THEMES } from './fixtures'

function names(plan: OgCardPlan): OgSlotName[] {
  return plan.slots.map((slot) => slot.name)
}

function textSlot(plan: OgCardPlan, name: OgSlotName): OgTextSlot {
  const slot = plan.slots.find((candidate) => candidate.name === name)
  if (slot === undefined || slot.kind !== 'text') {
    throw new Error(`expected a text slot named ${name}`)
  }
  return slot
}

const TITLE_CORPUS = [
  'Emma & Jake',
  'Emma',
  LONG_TITLE,
  'EMMA & JAKE',
  'THE WEDDING OF ALEXANDRA AND CHRISTOPHER, AT LAST',
  'A'.repeat(MAX_TITLE_LENGTH),
  'Supercalifragilisticexpialidociouslylongsinglewordtitle',
  '结婚典礼 Emma & Jake',
]

describe('planOgCard', () => {
  it('lays the slots out top to bottom', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    expect(names(plan)).toEqual(['kicker', 'title', 'rule', 'date', 'venue', 'footer'])

    const tops = plan.slots.map((slot) => slot.box.y)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
  })

  it('omits the slots the event has nothing to put in', () => {
    const plan = planOgCard(
      { title: SAMPLE_EVENT.title, startsAtLocal: SAMPLE_EVENT.startsAtLocal },
      IVORY_TOKENS
    )

    expect(names(plan)).toEqual(['title', 'rule', 'date'])
  })

  it('never overlaps two slots', () => {
    for (const [, tokens] of SEED_THEMES) {
      for (const title of TITLE_CORPUS) {
        const plan = planOgCard({ ...SAMPLE_EVENT, title }, tokens)

        for (let index = 1; index < plan.slots.length; index += 1) {
          const previous = plan.slots[index - 1]!
          const current = plan.slots[index]!
          expect(previous.box.y + previous.box.height).toBeLessThanOrEqual(current.box.y)
        }
      }
    }
  })

  it('keeps every slot inside the safe area', () => {
    for (const [, tokens] of SEED_THEMES) {
      for (const title of TITLE_CORPUS) {
        const plan = planOgCard({ ...SAMPLE_EVENT, title }, tokens)
        const { safeArea } = plan

        for (const slot of plan.slots) {
          expect(slot.box.x).toBeGreaterThanOrEqual(safeArea.x)
          expect(slot.box.y).toBeGreaterThanOrEqual(safeArea.y)
          expect(slot.box.x + slot.box.width).toBeLessThanOrEqual(safeArea.x + safeArea.width)
          expect(slot.box.y + slot.box.height).toBeLessThanOrEqual(safeArea.y + safeArea.height)
        }
      }
    }
  })

  it('holds the title above the legible floor for every title a buyer can store', () => {
    for (const [name, tokens] of SEED_THEMES) {
      for (const title of TITLE_CORPUS) {
        const plan = planOgCard({ ...SAMPLE_EVENT, title }, tokens)

        expect(
          plan.title.fontSize,
          `${name} shrank "${title.slice(0, 24)}" below the thumbnail floor`
        ).toBeGreaterThanOrEqual(MIN_TITLE_FONT_SIZE)
        expect(plan.title.fontSize * OG_THUMBNAIL_SCALE).toBeGreaterThanOrEqual(9)
      }
    }
  })

  it('spends the space a shorter title leaves on making that title bigger', () => {
    const short = planOgCard({ ...SAMPLE_EVENT, title: 'Emma' }, IVORY_TOKENS)
    const long = planOgCard({ ...SAMPLE_EVENT, title: LONG_TITLE }, IVORY_TOKENS)

    expect(short.title.fontSize).toBeGreaterThan(long.title.fontSize)
  })

  it('truncates rather than shrinking once the floor is reached', () => {
    const plan = planOgCard({ ...SAMPLE_EVENT, title: 'A'.repeat(MAX_TITLE_LENGTH) }, IVORY_TOKENS)

    expect(plan.title.fontSize).toBe(MIN_TITLE_FONT_SIZE)
    expect(plan.title.truncated).toBe(true)
    expect(plan.title.text.endsWith('…')).toBe(true)
    expect(plan.title.lines.length).toBeLessThanOrEqual(2)
  })

  it('does not truncate a title that fits', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    expect(plan.title.truncated).toBe(false)
    expect(plan.title.text).toBe(SAMPLE_EVENT.title)
  })

  it('keeps every title line inside the content width', () => {
    for (const [, tokens] of SEED_THEMES) {
      for (const title of TITLE_CORPUS) {
        const plan = planOgCard({ ...SAMPLE_EVENT, title }, tokens)

        for (const line of plan.title.lines) {
          expect(estimateTextWidth(line, plan.title.fontSize)).toBeLessThanOrEqual(
            plan.safeArea.width
          )
        }
      }
    }
  })

  it('hands the renderer the lines to draw, so nothing re-wraps them', () => {
    // The renderer draws these as non wrapping rows. If a slot did its own
    // wrapping, a line the plan did not expect would push the block past the
    // slot and the clip would remove a line from the middle of a name.
    const plan = planOgCard({ ...SAMPLE_EVENT, title: 'Alexandra & Christopher' }, IVORY_TOKENS)

    expect(textSlot(plan, 'title').lines).toEqual(plan.title.lines)
    expect(plan.title.lines.length).toBe(2)

    for (const name of ['kicker', 'date', 'venue', 'footer'] as const) {
      const slot = textSlot(plan, name)
      expect(slot.lines, `${name} must be a single line`).toEqual([slot.text])
    }
  })

  it('takes every colour, family, weight and radius from the tokens it was given', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    expect(plan.background).toBe(IVORY_TOKENS.color.bg)
    expect(textSlot(plan, 'title').color).toBe(IVORY_TOKENS.color.ink)
    expect(textSlot(plan, 'title').fontFamily).toBe(IVORY_TOKENS.font.heading)
    expect(textSlot(plan, 'title').fontWeight).toBe(IVORY_TOKENS.typeScale.display.weight)
    expect(textSlot(plan, 'date').color).toBe(IVORY_TOKENS.color.ink)
    expect(textSlot(plan, 'date').fontFamily).toBe(IVORY_TOKENS.font.body)
    expect(textSlot(plan, 'kicker').color).toBe(IVORY_TOKENS.color.inkMuted)
    expect(textSlot(plan, 'venue').color).toBe(IVORY_TOKENS.color.inkMuted)
    expect(textSlot(plan, 'footer').color).toBe(IVORY_TOKENS.color.inkMuted)

    const rule = plan.slots.find((slot) => slot.name === 'rule')
    expect(rule?.kind).toBe('rule')
    if (rule?.kind === 'rule') {
      expect(rule.color).toBe(IVORY_TOKENS.color.accent)
      expect(rule.radius).toBe(IVORY_TOKENS.radius.sm * 16)
    }
  })

  it('takes its padding and gaps from the space tokens', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    expect(plan.safeArea.x).toBe(IVORY_TOKENS.space.xl * 16)
    expect(plan.safeArea.width).toBe(OG_CARD_WIDTH - IVORY_TOKENS.space.xl * 16 * 2)
  })

  it('fits both seed themes without having to compress their spacing', () => {
    // The compression below is the safety net, not the normal case. If a theme
    // we ship needs it, the card's fixed heights and that theme's space tokens
    // have drifted apart and one of them should move.
    for (const [name, tokens] of SEED_THEMES) {
      const plan = planOgCard(SAMPLE_EVENT, tokens)

      expect(plan.gapsCompressed, `${name} no longer fits the card`).toBe(false)
    }
  })

  it('gives the title its floor even when a theme spends the card on white space', () => {
    // A theme is allowed generous spacing. It is not allowed to squeeze the one
    // element that has to survive the thumbnail, so the gaps give way first.
    const airy = {
      ...IVORY_TOKENS,
      space: { xs: 2, sm: 3, md: 4, lg: 5, xl: 6 },
    }

    const plan = planOgCard(SAMPLE_EVENT, airy)

    expect(plan.title.fontSize).toBeGreaterThanOrEqual(MIN_TITLE_FONT_SIZE)
    expect(plan.gapsCompressed).toBe(true)
    for (const slot of plan.slots) {
      expect(slot.box.y).toBeGreaterThanOrEqual(0)
      expect(slot.box.y + slot.box.height).toBeLessThanOrEqual(OG_CARD_HEIGHT)
    }
  })

  it('centres the content column', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    for (const slot of plan.slots) {
      const centre = slot.box.x + slot.box.width / 2
      expect(centre).toBeCloseTo(OG_CARD_WIDTH / 2, 6)
    }
  })

  it('prints the date the event stores, not the date the machine is having', () => {
    const plan = planOgCard(SAMPLE_EVENT, IVORY_TOKENS)

    expect(textSlot(plan, 'date').text).toBe('Sunday 14 March 2027 · 4:00 pm')
  })

  it('shortens a long venue rather than letting it wrap into the footer', () => {
    const plan = planOgCard(
      { ...SAMPLE_EVENT, venue: 'The Grounds of Alexandria, '.repeat(6) },
      IVORY_TOKENS
    )

    const venue = textSlot(plan, 'venue')
    expect(venue.text.endsWith('…')).toBe(true)
    expect(estimateTextWidth(venue.text, venue.fontSize)).toBeLessThanOrEqual(plan.safeArea.width)
  })
})
