/**
 * The card layout: slots, not art.
 *
 * Everything on the card is one of six named slots stacked down a centred
 * column, and this module works out where each one goes. It returns pure
 * geometry, which is what lets the layout be tested without rendering anything
 * and lets the Playwright suite know exactly which band of pixels the title
 * occupies when it measures a real downscaled render.
 *
 * Where the numbers come from, since the split matters:
 *
 *   From the THEME    every colour, both font stacks, every weight, every
 *                     letter spacing, the rule's corner radius, and all the
 *                     vertical padding and gaps (the space tokens, read as
 *                     px at the usual 16px rem).
 *   From the CARD     the type sizes and the slot order. The card is a fixed
 *                     1200x630 artifact that has to survive being shrunk to a
 *                     120px thumbnail, and a rem scale designed for a 320px
 *                     phone cannot answer that. These sizes are the same for
 *                     every theme, they are geometry rather than styling, and
 *                     the floor among them is derived in contract.ts rather
 *                     than chosen.
 *
 * The title wins every conflict. If a theme's spacing would squeeze it below
 * two lines at the legible floor, the gaps compress and the plan says so.
 */

import type { ThemeTokens } from '@/lib/template'

import { MIN_TITLE_FONT_SIZE, OG_CARD_HEIGHT, OG_CARD_WIDTH, type OgSlotName } from './contract'
import { formatEventWhen } from './format'
import { truncateToLines, wrapEstimate } from './text'

/** Space and radius tokens are rem. The card renders at the usual root size. */
const REM = 16

/**
 * Title sizes, largest first. The last entry is the thumbnail floor, so running
 * off the end of this ladder means truncating rather than shrinking further.
 */
export const TITLE_SIZES = [132, 126, 120, 114, 108, 102, 96, MIN_TITLE_FONT_SIZE] as const

const TITLE_LINE_HEIGHT = 1.08
const TITLE_MAX_LINES = 2

/** The height the title is guaranteed: two lines at the legible floor. */
export const MIN_TITLE_ZONE = TITLE_MAX_LINES * MIN_TITLE_FONT_SIZE * TITLE_LINE_HEIGHT

const SECONDARY = {
  kicker: { fontSize: 26, lineHeight: 1.3 },
  date: { fontSize: 48, lineHeight: 1.25 },
  venue: { fontSize: 32, lineHeight: 1.3 },
  footer: { fontSize: 24, lineHeight: 1.3 },
} as const

const RULE_WIDTH = 168
const RULE_HEIGHT = 12

/** Mid range advance from the table in text.ts, used to price letter spacing. */
const AVERAGE_ADVANCE = 0.58

export type OgBox = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type OgTextSlot = {
  readonly kind: 'text'
  readonly name: OgSlotName
  readonly box: OgBox
  readonly text: string
  /**
   * The lines to draw, decided here rather than left to the renderer.
   *
   * Satori wraps text itself, and letting it do so means the rendered line
   * count can differ from the planned one. When it does, the extra line pushes
   * the block past the slot and the clip silently removes a line from the
   * middle of somebody's name. Drawing pre-wrapped lines that do not wrap turns
   * that invisible failure into an overhang the pixel tests can see.
   */
  readonly lines: readonly string[]
  readonly fontSize: number
  readonly lineHeight: number
  readonly fontWeight: number
  /** px, already resolved from the token's em value. */
  readonly letterSpacing: number
  readonly fontFamily: string
  readonly color: string
}

export type OgRuleSlot = {
  readonly kind: 'rule'
  readonly name: 'rule'
  readonly box: OgBox
  readonly color: string
  readonly radius: number
}

export type OgSlot = OgTextSlot | OgRuleSlot

export type OgCardEvent = {
  /** events.title */
  readonly title: string
  /** events.starts_at_local, the stored wall clock. */
  readonly startsAtLocal: string
  /** Usually the hero block's eyebrow. */
  readonly kicker?: string | undefined
  /** Usually the map block's venue name. */
  readonly venue?: string | undefined
  /** The share URL, printed so a screenshot of the card still leads somewhere. */
  readonly footer?: string | undefined
}

export type OgCardPlan = {
  readonly width: number
  readonly height: number
  readonly background: string
  readonly safeArea: OgBox
  readonly slots: readonly OgSlot[]
  readonly title: {
    readonly text: string
    readonly lines: readonly string[]
    readonly fontSize: number
    readonly lineHeight: number
    readonly truncated: boolean
  }
  /** True when a theme's spacing had to give way to protect the title. */
  readonly gapsCompressed: boolean
}

type StackItem = {
  readonly name: OgSlotName
  readonly height: number
}

/**
 * The gap above each slot, in space tokens. Read as "what separates these two",
 * which is why the footer's gap is stated once rather than per predecessor.
 */
function gapBetween(previous: OgSlotName, next: OgSlotName, tokens: ThemeTokens): number {
  const space = tokens.space

  if (next === 'footer') return space.lg * REM
  if (previous === 'kicker') return space.md * REM
  if (previous === 'title' && next === 'rule') return space.lg * REM
  if (previous === 'rule' && next === 'date') return space.md * REM
  if (previous === 'date' && next === 'venue') return space.sm * REM

  return space.lg * REM
}

function lineBox(fontSize: number, lineHeight: number): number {
  return Math.round(fontSize * lineHeight)
}

/**
 * Picks the largest title size that fits the column and the zone in at most two
 * lines, and truncates at the floor when nothing fits.
 */
function planTitle(title: string, contentWidth: number, zoneHeight: number, tracking: number) {
  // Letter spacing widens a line by roughly one tracking step per character,
  // and the width estimate does not know about it. Charging it against the
  // column up front is cheaper than estimating it per line, and it errs the
  // safe way: a title wraps one step sooner rather than running off the card.
  // Capped at the column: a theme with negative tracking would otherwise buy
  // back width, and a line that only fits because it is tucked up is a line one
  // font swap away from hanging off the edge.
  const usableWidth = Math.min(contentWidth, contentWidth / (1 + tracking / AVERAGE_ADVANCE))
  // Rounding slack, so a zone that is exactly two lines tall holds two lines.
  const usableHeight = zoneHeight + 0.5

  for (const fontSize of TITLE_SIZES) {
    const lines = wrapEstimate(title, fontSize, usableWidth)
    if (lines.length > TITLE_MAX_LINES) continue
    if (lines.length * fontSize * TITLE_LINE_HEIGHT > usableHeight) continue

    return { text: title, lines, fontSize, lineHeight: TITLE_LINE_HEIGHT, truncated: false }
  }

  const fontSize = MIN_TITLE_FONT_SIZE
  const text = truncateToLines(title, fontSize, usableWidth, TITLE_MAX_LINES)

  return {
    text,
    lines: wrapEstimate(text, fontSize, usableWidth),
    fontSize,
    lineHeight: TITLE_LINE_HEIGHT,
    truncated: true,
  }
}

export function planOgCard(event: OgCardEvent, tokens: ThemeTokens): OgCardPlan {
  const padX = tokens.space.xl * REM
  const contentWidth = OG_CARD_WIDTH - padX * 2

  const when = formatEventWhen(event.startsAtLocal)

  // Every slot except the title has a height that does not depend on the
  // layout, so they are measured first and the title takes what is left.
  const kicker = event.kicker?.trim()
  const venue = event.venue?.trim()
  const footer = event.footer?.trim()

  const stack: StackItem[] = []
  if (kicker !== undefined && kicker !== '') {
    stack.push({
      name: 'kicker',
      height: lineBox(SECONDARY.kicker.fontSize, SECONDARY.kicker.lineHeight),
    })
  }
  stack.push({ name: 'title', height: 0 })
  stack.push({ name: 'rule', height: RULE_HEIGHT })
  stack.push({ name: 'date', height: lineBox(SECONDARY.date.fontSize, SECONDARY.date.lineHeight) })
  if (venue !== undefined && venue !== '') {
    stack.push({
      name: 'venue',
      height: lineBox(SECONDARY.venue.fontSize, SECONDARY.venue.lineHeight),
    })
  }
  if (footer !== undefined && footer !== '') {
    stack.push({
      name: 'footer',
      height: lineBox(SECONDARY.footer.fontSize, SECONDARY.footer.lineHeight),
    })
  }

  const fixedHeight = stack.reduce((total, item) => total + item.height, 0)
  const rawPadY = tokens.space.xl * REM
  const rawGaps = stack
    .slice(1)
    .map((item, index) => gapBetween(stack[index]!.name, item.name, tokens))
  const rawVertical = rawPadY * 2 + rawGaps.reduce((total, gap) => total + gap, 0)

  // The title's floor is not negotiable, so the white space is what gives.
  const verticalBudget = OG_CARD_HEIGHT - fixedHeight - MIN_TITLE_ZONE
  const gapsCompressed = rawVertical > verticalBudget
  const compression = gapsCompressed ? verticalBudget / rawVertical : 1

  const padY = rawPadY * compression
  const gaps = rawGaps.map((gap) => gap * compression)
  const titleZone =
    OG_CARD_HEIGHT - fixedHeight - padY * 2 - gaps.reduce((total, gap) => total + gap, 0)

  const title = planTitle(
    event.title,
    contentWidth,
    titleZone,
    tokens.typeScale.display.tracking ?? 0
  )

  const slots: OgSlot[] = []
  let y = padY

  for (const [index, item] of stack.entries()) {
    if (index > 0) y += gaps[index - 1] ?? 0

    const height = item.name === 'title' ? titleZone : item.height
    const box: OgBox = { x: padX, y, width: contentWidth, height }

    switch (item.name) {
      case 'kicker':
        slots.push(
          textSlot('kicker', box, kicker!.toUpperCase(), SECONDARY.kicker, tokens, {
            role: 'caption',
            family: tokens.font.body,
            color: tokens.color.inkMuted,
          })
        )
        break
      case 'title':
        slots.push({
          kind: 'text',
          name: 'title',
          box,
          text: title.text,
          lines: title.lines,
          fontSize: title.fontSize,
          lineHeight: title.lineHeight,
          fontWeight: tokens.typeScale.display.weight,
          letterSpacing: (tokens.typeScale.display.tracking ?? 0) * title.fontSize,
          fontFamily: tokens.font.heading,
          color: tokens.color.ink,
        })
        break
      case 'rule':
        slots.push({
          kind: 'rule',
          name: 'rule',
          box: {
            x: (OG_CARD_WIDTH - RULE_WIDTH) / 2,
            y,
            width: RULE_WIDTH,
            height: RULE_HEIGHT,
          },
          color: tokens.color.accent,
          radius: Math.min(tokens.radius.sm * REM, RULE_HEIGHT / 2),
        })
        break
      case 'date':
        slots.push(
          textSlot('date', box, when.line, SECONDARY.date, tokens, {
            role: 'title',
            family: tokens.font.body,
            color: tokens.color.ink,
          })
        )
        break
      case 'venue':
        slots.push(
          textSlot('venue', box, venue!, SECONDARY.venue, tokens, {
            role: 'body',
            family: tokens.font.body,
            color: tokens.color.inkMuted,
          })
        )
        break
      case 'footer':
        slots.push(
          textSlot('footer', box, footer!, SECONDARY.footer, tokens, {
            role: 'caption',
            family: tokens.font.body,
            color: tokens.color.inkMuted,
          })
        )
        break
    }

    y += height
  }

  return {
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    background: tokens.color.bg,
    safeArea: { x: padX, y: padY, width: contentWidth, height: OG_CARD_HEIGHT - padY * 2 },
    slots,
    title,
    gapsCompressed,
  }
}

/**
 * Every secondary slot is one line. A second line on any of them is a line the
 * title has lost, so they truncate instead of wrapping.
 */
function textSlot(
  name: OgSlotName,
  box: OgBox,
  text: string,
  size: { fontSize: number; lineHeight: number },
  tokens: ThemeTokens,
  style: { role: 'title' | 'body' | 'caption'; family: string; color: string }
): OgTextSlot {
  const step = tokens.typeScale[style.role]
  const letterSpacing = (step.tracking ?? 0) * size.fontSize
  const available = box.width - letterSpacing * Math.max(text.length - 1, 0)
  const fitted = truncateToLines(text, size.fontSize, Math.max(available, size.fontSize), 1)

  return {
    kind: 'text',
    name,
    box,
    text: fitted,
    lines: [fitted],
    fontSize: size.fontSize,
    lineHeight: size.lineHeight,
    fontWeight: step.weight,
    letterSpacing,
    fontFamily: style.family,
    color: style.color,
  }
}

export function findSlot(plan: OgCardPlan, name: OgSlotName): OgSlot | undefined {
  return plan.slots.find((slot) => slot.name === name)
}
