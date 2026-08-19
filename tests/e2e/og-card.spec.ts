import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { readSiteConfig } from '@/lib/env'
import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  OG_THUMBNAIL_SCALE,
  OG_THUMBNAIL_WIDTH,
  buildOgCardUrl,
  contrastRatio,
  ogCardFooter,
  planOgCard,
  type OgCardParams,
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
 */

const THUMBNAIL_HEIGHT = Math.round(OG_CARD_HEIGHT * OG_THUMBNAIL_SCALE)

/** 8 bit channel noise from PNG encoding. A flat background should be flat. */
const BACKGROUND_TOLERANCE = 6

type CardCase = {
  readonly name: string
  readonly params: OgCardParams
}

const CASES: readonly CardCase[] = [
  {
    name: 'the sample couple, light theme',
    params: {
      title: 'Emma & Jake',
      startsAt: '2027-03-14T16:00:00',
      kicker: 'You are invited',
      venue: 'The Grounds of Alexandria, Sydney',
      slug: 'emma-and-jake-7fq2',
      theme: 'ivory',
    },
  },
  {
    name: 'two long names, dark theme',
    params: {
      title: 'Alexandra Konstantinopoulos & Christopher Featherstonehaugh',
      startsAt: '2027-03-14T16:00:00',
      kicker: 'You are invited',
      venue: 'The Grounds of Alexandria, Sydney',
      slug: 'alexandra-and-christopher-9kd1',
      theme: 'midnight',
    },
  },
  {
    name: 'the two required fields and nothing else',
    params: { title: 'Emma & Jake', startsAt: '2027-03-14T16:00:00' },
  },
]

/**
 * The plan the route will have produced for these parameters. The test uses it
 * to know which band of pixels the title occupies rather than hunting for the
 * text, so a layout change moves the measurement with it.
 */
function planFor(params: OgCardParams): OgCardPlan {
  const { siteUrl } = readSiteConfig()

  return planOgCard(
    {
      title: params.title,
      startsAtLocal: params.startsAt,
      kicker: params.kicker,
      venue: params.venue,
      footer: ogCardFooter(siteUrl, params.slug),
    },
    seedThemeTokens(params.theme ?? 'ivory')
  )
}

/**
 * Read from the seed file rather than through src/lib/og/themes.ts, which
 * imports the same JSON statically. Playwright runs as real ESM and would want
 * an import attribute for that; the seeding path reads bytes anyway.
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
      const plan = planFor(scenario.params)
      const url = buildOgCardUrl(baseURL!, scenario.params)

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

  test('refuses parameters it cannot draw a card from', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/og?title=Emma&startsAt=2027-13-40T16:00:00`)

    expect(response.status()).toBe(400)
    const body = (await response.json()) as { error: string; issues: { path: string }[] }
    expect(body.error).toBe('invalid card parameters')
    expect(body.issues[0]?.path).toBe('startsAt')
  })

  test('is cacheable and not indexable', async ({ request, baseURL }) => {
    const params = CASES[0]!.params
    const response = await request.get(buildOgCardUrl(baseURL!, params))

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('image/png')
    expect(response.headers()['cache-control']).toContain('immutable')
    // The card carries a buyer's names. It belongs in a chat bubble, not in a
    // search result of its own.
    expect(response.headers()['x-robots-tag']).toBe('noindex')
  })
})
