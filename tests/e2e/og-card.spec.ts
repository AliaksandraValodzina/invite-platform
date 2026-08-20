import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { seedEvent, type SeededEvent } from '../../scripts/seed-event'
import { readSiteConfig } from '@/lib/env'
import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  OG_THUMBNAIL_SCALE,
  OG_THUMBNAIL_WIDTH,
  buildOgCardUrl,
  contrastRatio,
  ogCardFooter,
  ogCardVersion,
  planOgCard,
  type OgCardPlan,
} from '@/lib/og'
import { themePipeline, type ThemeTokens } from '@/lib/template'

/**
 * The card, measured after being shrunk to the size it is actually first seen at.
 *
 * A share card is judged in a chat bubble at roughly 120px wide, so checking it
 * at 1200x630 checks the wrong thing. These tests fetch the real PNG the route
 * serves, draw it into a canvas at a tenth of its size, read the pixels back and
 * ask whether the title is still text. Downscaling averages a stroke with the
 * background around it, so type that is too small does not get blurry here, it
 * gets a contrast ratio that collapses towards 1:1. That is the number asserted.
 *
 * The full size image is checked for two things. Nothing rendered outside the
 * safe area, and the title's ink clear of all four edges of its own slot. The
 * second is the one that matters: the slot clips, so a line the width estimate
 * got wrong does not overflow, it gets cut off inside the slot where nothing
 * else would notice. These two tests are the harness that keeps the advance
 * table in src/lib/og/text.ts honest, and the one to rerun when a real display
 * face is registered.
 *
 * What moved when the route stopped taking its fields from query parameters:
 * only where the fields come from. Each case is now a real seeded event, and
 * the URL carries its slug and a version digest. Every measurement below is
 * the one it always was.
 */

const THUMBNAIL_HEIGHT = Math.round(OG_CARD_HEIGHT * OG_THUMBNAIL_SCALE)

/** 8 bit channel noise from PNG encoding. A flat background should be flat. */
const BACKGROUND_TOLERANCE = 6

type CardCase = {
  readonly name: string
  readonly title: string
  readonly startsAt: string
  readonly themeKey: string
  /** Buyer content, keyed by block id, exactly as event_content stores it. */
  readonly content: unknown
  /** Left out means the committed classic-invitation definition. */
  readonly definition?: unknown
  readonly kicker?: string
  readonly venue?: string
}

/**
 * A definition with a hero and nothing else, so an event can genuinely have no
 * kicker and no venue. The card's optional slots are read off the resolved
 * blocks now, and a template that carries a map block always has a venue name,
 * because the map schema requires one.
 */
const HERO_ONLY_DEFINITION = {
  version: 2,
  blocks: [{ id: 'hero', type: 'hero', config: { headline: 'Emma & Jake' } }],
}

const CASES: readonly CardCase[] = [
  {
    name: 'the sample couple, light theme',
    title: 'Emma & Jake',
    startsAt: '2027-03-14T16:00:00',
    themeKey: 'ivory',
    kicker: 'You are invited',
    venue: 'The Grounds of Alexandria, Sydney',
    content: {
      version: 1,
      blocks: {
        hero: { eyebrow: 'You are invited', headline: 'Emma & Jake' },
        'venue-map': { venueName: 'The Grounds of Alexandria, Sydney' },
      },
    },
  },
  {
    name: 'two long names, dark theme',
    title: 'Alexandra Konstantinopoulos & Christopher Featherstonehaugh',
    startsAt: '2027-03-14T16:00:00',
    themeKey: 'midnight',
    kicker: 'You are invited',
    venue: 'The Grounds of Alexandria, Sydney',
    content: {
      version: 1,
      blocks: {
        hero: { eyebrow: 'You are invited', headline: 'Alexandra & Christopher' },
        'venue-map': { venueName: 'The Grounds of Alexandria, Sydney' },
      },
    },
  },
  {
    name: 'the two required fields and nothing else',
    title: 'Emma & Jake',
    startsAt: '2027-03-14T16:00:00',
    themeKey: 'ivory',
    definition: HERO_ONLY_DEFINITION,
    content: { version: 1, blocks: {} },
  },
]

const seeded = new Map<string, SeededEvent>()

test.beforeAll(async () => {
  for (const [index, scenario] of CASES.entries()) {
    seeded.set(
      scenario.name,
      await seedEvent({
        title: scenario.title,
        startsAtLocal: scenario.startsAt,
        timeZone: 'Australia/Sydney',
        themeKey: scenario.themeKey,
        state: 'live',
        content: scenario.content,
        ...(scenario.definition === undefined ? {} : { definition: scenario.definition }),
        templateKey: `og-card-${index}-${scenario.themeKey}`,
      })
    )
  }
})

function slugFor(scenario: CardCase): string {
  const event = seeded.get(scenario.name)
  if (event === undefined) throw new Error(`no event was seeded for "${scenario.name}"`)
  return event.slug
}

/**
 * The plan the route will have produced for this event. The test uses it to
 * know which band of pixels the title occupies rather than hunting for the
 * text, so a layout change moves the measurement with it.
 */
function planFor(scenario: CardCase): OgCardPlan {
  const { siteUrl } = readSiteConfig()

  return planOgCard(
    {
      title: scenario.title,
      startsAtLocal: scenario.startsAt,
      kicker: scenario.kicker,
      venue: scenario.venue,
      footer: ogCardFooter(siteUrl, slugFor(scenario)),
    },
    seedThemeTokens(scenario.themeKey)
  )
}

function cardUrlFor(baseUrl: string, scenario: CardCase): string {
  const tokens = seedThemeTokens(scenario.themeKey)
  const version = ogCardVersion(
    {
      title: scenario.title,
      startsAt: scenario.startsAt,
      kicker: scenario.kicker,
      venue: scenario.venue,
    },
    tokens
  )

  return buildOgCardUrl(baseUrl, { slug: slugFor(scenario), v: version })
}

/**
 * Read from the seed file rather than through a module that imports the same
 * JSON statically. Playwright runs as real ESM and would want an import
 * attribute for that; the seeding path reads bytes anyway.
 */
function seedThemeTokens(key: string): ThemeTokens {
  const path = fileURLToPath(new URL(`../../templates/themes/${key}.json`, import.meta.url))
  const outcome = themePipeline.load(JSON.parse(readFileSync(path, 'utf8')))
  if (!outcome.ok) throw new Error(`the ${key} seed theme is invalid: ${outcome.message}`)
  return outcome.document.tokens
}

type Measurement = {
  natural: { width: number; height: number }
  /** RGBA, row major, at OG_THUMBNAIL_WIDTH x THUMBNAIL_HEIGHT. */
  thumbnail: number[]
  /** Largest per channel deviation from the background found outside the safe area. */
  outsideSafeAreaDelta: number
  outsideSafeAreaAt: { x: number; y: number } | null
  /** Bounding box of the ink inside the title slot, in full size coordinates. */
  titleInk: { top: number; bottom: number; left: number; right: number } | null
}

async function measure(
  page: import('@playwright/test').Page,
  url: string,
  plan: OgCardPlan
): Promise<Measurement> {
  const title = plan.slots.find((slot) => slot.name === 'title')!

  return page.evaluate(
    async ({ url, safeArea, titleBox, background, thumbWidth, thumbHeight, tolerance }) => {
      const image = new Image()
      image.src = url
      await image.decode()

      const context = (width: number, height: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx === null) throw new Error('no 2d context')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(image, 0, 0, width, height)
        return ctx
      }

      const full = context(image.naturalWidth, image.naturalHeight)
      const fullPixels = full.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data

      const expected = [
        Number.parseInt(background.slice(1, 3), 16),
        Number.parseInt(background.slice(3, 5), 16),
        Number.parseInt(background.slice(5, 7), 16),
      ]

      const deltaAt = (x: number, y: number) => {
        const offset = (y * image.naturalWidth + x) * 4
        return Math.max(
          Math.abs(fullPixels[offset]! - expected[0]!),
          Math.abs(fullPixels[offset + 1]! - expected[1]!),
          Math.abs(fullPixels[offset + 2]! - expected[2]!)
        )
      }

      let outsideSafeAreaDelta = 0
      let outsideSafeAreaAt: { x: number; y: number } | null = null

      for (let y = 0; y < image.naturalHeight; y += 1) {
        const insideRows = y >= safeArea.y && y < safeArea.y + safeArea.height
        for (let x = 0; x < image.naturalWidth; x += 1) {
          if (insideRows && x >= safeArea.x && x < safeArea.x + safeArea.width) continue

          const delta = deltaAt(x, y)
          if (delta > outsideSafeAreaDelta) {
            outsideSafeAreaDelta = delta
            outsideSafeAreaAt = { x, y }
          }
        }
      }

      let titleInk: { top: number; bottom: number; left: number; right: number } | null = null

      for (let y = titleBox.y; y < titleBox.y + titleBox.height; y += 1) {
        for (let x = titleBox.x; x < titleBox.x + titleBox.width; x += 1) {
          if (deltaAt(x, y) <= tolerance) continue

          titleInk =
            titleInk === null
              ? { top: y, bottom: y, left: x, right: x }
              : {
                  top: Math.min(titleInk.top, y),
                  bottom: Math.max(titleInk.bottom, y),
                  left: Math.min(titleInk.left, x),
                  right: Math.max(titleInk.right, x),
                }
        }
      }

      const thumb = context(thumbWidth, thumbHeight)

      return {
        natural: { width: image.naturalWidth, height: image.naturalHeight },
        thumbnail: [...thumb.getImageData(0, 0, thumbWidth, thumbHeight).data],
        outsideSafeAreaDelta,
        outsideSafeAreaAt,
        titleInk,
      }
    },
    {
      url,
      safeArea: {
        x: Math.floor(plan.safeArea.x),
        y: Math.floor(plan.safeArea.y),
        width: Math.ceil(plan.safeArea.width),
        height: Math.ceil(plan.safeArea.height),
      },
      titleBox: {
        x: Math.floor(title.box.x),
        y: Math.floor(title.box.y),
        width: Math.ceil(title.box.width),
        height: Math.ceil(title.box.height),
      },
      background: plan.background,
      thumbWidth: OG_THUMBNAIL_WIDTH,
      thumbHeight: THUMBNAIL_HEIGHT,
      tolerance: BACKGROUND_TOLERANCE,
    }
  )
}

function hexAt(thumbnail: number[], x: number, y: number): string {
  const offset = (y * OG_THUMBNAIL_WIDTH + x) * 4
  const channel = (value: number) => value.toString(16).padStart(2, '0')
  return `#${channel(thumbnail[offset]!)}${channel(thumbnail[offset + 1]!)}${channel(thumbnail[offset + 2]!)}`
}

test.describe('the Open Graph share card', () => {
  // The card is a fixed 1200x630 image, so the browser viewport cannot change
  // it. Running this file in the 320px project would bill CI for a second
  // identical run.
  test.beforeEach(({ browserName: _browserName }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport independent')
  })

  for (const scenario of CASES) {
    test(`stays legible at thumbnail size: ${scenario.name}`, async ({ page, baseURL }) => {
      const plan = planFor(scenario)
      const url = cardUrlFor(baseURL!, scenario)

      const response = await page.goto('/')
      expect(response?.status()).toBe(200)

      const measurement = await measure(page, url, plan)

      expect(measurement.natural).toEqual({ width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT })

      // Nothing outside the safe area. A title that overflowed its column, or a
      // slot that ran past the padding, shows up here as ink in the margin.
      expect(
        measurement.outsideSafeAreaDelta,
        `ink outside the safe area at ${JSON.stringify(measurement.outsideSafeAreaAt)}`
      ).toBeLessThanOrEqual(BACKGROUND_TOLERANCE)

      // The title slot clips, so a title one line taller than the plan
      // predicted cannot escape its box: it gets cut off inside it. Clearance
      // on all four sides is what proves it was not cut off, and it is the
      // check that keeps the width estimate in src/lib/og/text.ts honest.
      const title = plan.slots.find((slot) => slot.name === 'title')!
      const ink = measurement.titleInk

      expect(ink, 'the title slot rendered nothing at all').not.toBeNull()
      expect(ink!.top, 'the title is cut off at the top of its slot').toBeGreaterThan(
        title.box.y + 1
      )
      expect(ink!.bottom, 'the title is cut off at the bottom of its slot').toBeLessThan(
        title.box.y + title.box.height - 2
      )
      expect(ink!.left, 'the title is cut off on the left').toBeGreaterThan(title.box.x + 1)
      expect(ink!.right, 'the title is cut off on the right').toBeLessThan(
        title.box.x + title.box.width - 2
      )

      const firstRow = Math.floor(title.box.y * OG_THUMBNAIL_SCALE)
      const lastRow = Math.min(
        Math.ceil((title.box.y + title.box.height) * OG_THUMBNAIL_SCALE),
        THUMBNAIL_HEIGHT
      )

      let strongest = 1
      const inkColumns = new Set<number>()
      const inkRows = new Set<number>()

      for (let y = firstRow; y < lastRow; y += 1) {
        for (let x = 0; x < OG_THUMBNAIL_WIDTH; x += 1) {
          const ratio = contrastRatio(hexAt(measurement.thumbnail, x, y), plan.background)
          if (ratio > strongest) strongest = ratio
          if (ratio >= 3) {
            inkColumns.add(x)
            inkRows.add(y)
          }
        }
      }

      // The title still separates from its background after the downscale. Type
      // too small to survive averages into the background and lands near 1:1.
      expect(
        strongest,
        `the title band washed out to ${strongest.toFixed(2)}:1 at ${OG_THUMBNAIL_WIDTH}px`
      ).toBeGreaterThanOrEqual(4.5)

      // And it still has the shape of words. A single surviving dot would clear
      // the contrast check on its own, so the extent is asserted too.
      expect(
        inkColumns.size,
        'the title is not wide enough to read as words'
      ).toBeGreaterThanOrEqual(10)
      expect(inkRows.size, 'the title has lost its cap height').toBeGreaterThanOrEqual(4)
    })
  }

  test('refuses a slug it could not look anything up by', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/og?slug=Not%20A%20Slug`)

    expect(response.status()).toBe(400)
    const body = (await response.json()) as { error: string; issues: { path: string }[] }
    expect(body.error).toBe('invalid card parameters')
    expect(body.issues[0]?.path).toBe('slug')
  })

  test('has no card to draw for an event nobody published', async ({ request, baseURL }) => {
    const missing = await request.get(`${baseURL}/api/og?slug=no-such-invitation-000000`)
    expect(missing.status()).toBe(404)

    // An unpublished event has nothing to share yet, and a card is a chat
    // preview carrying a couple's names. It is not drawn until the page is.
    const draft = await seedEvent({
      title: 'A draft nobody has published',
      startsAtLocal: '2027-03-14T16:00:00',
      timeZone: 'Australia/Sydney',
      themeKey: 'ivory',
      state: 'unpublished',
      templateKey: 'og-card-draft',
    })
    const unpublished = await request.get(`${baseURL}/api/og?slug=${draft.slug}`)

    expect(unpublished.status()).toBe(404)
  })

  test('is immutable only when the URL names one rendering of the card', async ({
    request,
    baseURL,
  }) => {
    const scenario = CASES[0]!

    const versioned = await request.get(cardUrlFor(baseURL!, scenario))
    expect(versioned.status()).toBe(200)
    expect(versioned.headers()['content-type']).toBe('image/png')
    // Safe because the version digest changes the moment anything the card
    // draws changes, so this URL can never mean anything else.
    expect(versioned.headers()['cache-control']).toContain('immutable')
    // The card carries a buyer's names. It belongs in a chat bubble, not in a
    // search result of its own.
    expect(versioned.headers()['x-robots-tag']).toBe('noindex')

    const bare = await request.get(`${baseURL}/api/og?slug=${slugFor(scenario)}`)
    expect(bare.status()).toBe(200)
    // "Whatever this event's card says now" is a different promise, and it gets
    // the page's short lifetime rather than a year.
    expect(bare.headers()['cache-control']).not.toContain('immutable')
  })
})
