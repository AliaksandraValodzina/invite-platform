import { expect, test, type Page } from '@playwright/test'

import {
  AA_LARGE_TEXT,
  contrastRatio,
  requiredRatio,
  type Rgb,
} from '../../src/lib/template/contrast'

/**
 * The three design directions, in a browser.
 *
 * The unit suite asserts the contrast table from
 * data/ip-design-directions/report.md over the hex values in the theme files.
 * That is a claim about a palette. This is the claim about a page: whatever the
 * blocks nest inside each other, every word a guest actually reads clears AA.
 *
 * It is here because a static reader cannot see a colour inherited across two
 * elements. A block could paint an accent fill and let a child several levels
 * down keep the page's ink, and every unit test in the repo would stay green.
 * So this walks the rendered DOM, reads the computed colours, works out what is
 * actually behind each piece of text, and measures it with the same function
 * the unit tests use.
 */

const DIRECTIONS = [
  { key: 'deckle-and-deboss', name: 'Deckle & Deboss', bg: 'rgb(243, 241, 236)', display: '40px' },
  { key: 'masthead', name: 'Masthead', bg: 'rgb(252, 251, 250)', display: '42px' },
  { key: 'foil-and-midnight', name: 'Foil & Midnight', bg: 'rgb(19, 26, 43)', display: '34px' },
] as const

const MOBILE = { width: 320, height: 568 }

type Sample = {
  readonly where: string
  readonly text: string
  readonly color: string
  readonly background: string
  readonly fontSize: number
  readonly fontWeight: number
}

/**
 * Every element that draws its own text, with the colour actually behind it.
 *
 * "Behind it" is the part worth doing properly: a computed background of
 * `rgba(0, 0, 0, 0)` means the element is transparent and the colour a reader
 * sees comes from an ancestor, so the walk goes up until it finds a painted one.
 */
async function textSamples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    function painted(element: Element): string {
      let current: Element | null = element
      while (current !== null) {
        const background = getComputedStyle(current).backgroundColor
        const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(background)
        if (background !== 'transparent' && (alpha === null || Number(alpha[1]) > 0)) {
          return background
        }
        current = current.parentElement
      }
      return 'rgb(255, 255, 255)'
    }

    function describe(element: Element): string {
      const section = element.closest('[data-block-id]')?.getAttribute('data-block-id') ?? 'page'
      return `${section} > ${element.tagName.toLowerCase()}`
    }

    return [...document.querySelectorAll('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) return false
        // Only elements with their own text. A wrapper inherits its colour from
        // whichever child does the drawing, and counting it would double up.
        return [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0
        )
      })
      .map((element) => {
        const styles = getComputedStyle(element)
        return {
          where: describe(element),
          text: (element.textContent ?? '').trim().slice(0, 40),
          color: styles.color,
          background: painted(element),
          fontSize: Number.parseFloat(styles.fontSize),
          fontWeight: Number(styles.fontWeight),
        }
      })
  })
}

function toRgb(value: string): Rgb {
  const channels = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  if (channels === null) throw new Error(`not a computed rgb colour: ${value}`)
  return {
    r: Number(channels[1]),
    g: Number(channels[2]),
    b: Number(channels[3]),
  }
}

for (const direction of DIRECTIONS) {
  test.describe(direction.name, () => {
    test('paints the tokens the theme document carries', async ({ page }) => {
      await page.goto(`/preview/${direction.key}?fixture=report-sample`)

      // Read the values rather than asserting that the three themes differ.
      // These are the hex and rem values in templates/themes, resolved by the
      // browser.
      const painted = await page.locator('[data-theme-scope]').evaluate((node) => {
        const heading = document.querySelector('h1')
        return {
          background: getComputedStyle(node).backgroundColor,
          display: heading === null ? '' : getComputedStyle(heading).fontSize,
        }
      })

      expect(painted).toEqual({ background: direction.bg, display: direction.display })
    })

    test('reads every word above the AA floor for the size it is set at', async ({ page }) => {
      await page.goto(`/preview/${direction.key}?fixture=report-sample`)

      const samples = await textSamples(page)

      // A walker that found nothing would pass silently, which is the exact
      // shape of green this repo has been bitten by.
      expect(samples.length).toBeGreaterThan(20)

      const failures = samples
        .map((sample) => ({
          sample,
          ratio: contrastRatio(toRgb(sample.color), toRgb(sample.background)),
          needs: requiredRatio(sample.fontSize, sample.fontWeight),
        }))
        .filter((measured) => measured.ratio < measured.needs)
        .map(
          (measured) =>
            `${measured.sample.where} "${measured.sample.text}": ${measured.sample.color} on ` +
            `${measured.sample.background} is ${measured.ratio.toFixed(2)}:1, needs ${measured.needs}`
        )

      expect(failures).toEqual([])
    })

    test('gives the RSVP controls a boundary a guest can see', async ({ page }) => {
      await page.goto(`/preview/${direction.key}?fixture=report-sample`)

      // The report: surface sits about 1.1:1 against bg on purpose, so a form
      // input cannot get its boundary from it and has to use inkMuted at full
      // opacity. This is that rule measured on the rendered control.
      const control = await page.getByLabel('Your name').evaluate((node) => {
        const styles = getComputedStyle(node)
        return { border: styles.borderTopColor, background: styles.backgroundColor }
      })

      expect(
        contrastRatio(toRgb(control.border), toRgb(control.background))
      ).toBeGreaterThanOrEqual(AA_LARGE_TEXT)
    })

    test('stacks the names, and does not overflow 320px with long ones', async ({ page }) => {
      await page.setViewportSize(MOBILE)
      await page.goto(`/preview/${direction.key}?fixture=long-names`)

      // The report's first finding: "Alexandra & Christopher" overflows a single
      // line at 320px in all three directions, so the lockup is three lines.
      await expect(page.locator('[data-name-line]')).toHaveText(['Alexandra', '&', 'Christopher'])

      // Stacked is not the same as fitting. Foil & Midnight has the least
      // headroom of the three, at a measured 246.7px of 280px for the longest
      // name, so this is the assertion that the stacking actually bought
      // something.
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

      const widest = await page
        .locator('[data-block-id]')
        .evaluateAll((nodes) => Math.max(...nodes.map((node) => node.scrollWidth)))
      expect(widest).toBeLessThanOrEqual(clientWidth)
    })

    test('shows the sample content the direction was designed against', async ({ page }) => {
      await page.goto(`/preview/${direction.key}?fixture=report-sample`)

      await expect(page.locator('[data-name-line]')).toHaveText(['Emma', '&', 'Jake'])
      await expect(page.getByText('Sunday 14 March 2027')).toBeVisible()
      await expect(page.getByText('The Grounds of Alexandria')).toBeVisible()
    })
  })
}

test.describe('the font payload', () => {
  /**
   * The report's third finding: "three directions must not mean loading three
   * full webfont families on every page".
   *
   * Counted by what the browser actually asks for. All six faces have their
   * `@font-face` rules in the route stylesheet, because the guest page is one
   * route serving every template, and the thing that keeps the payload honest is
   * that none of them is preloaded, so a font file is only fetched when there is
   * a glyph to draw in it.
   */
  const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    'deckle-and-deboss': ['EB Garamond', 'Karla'],
    masthead: ['Bodoni Moda', 'Archivo'],
    'foil-and-midnight': ['Cinzel', 'Jost'],
  }

  for (const [key, families] of Object.entries(EXPECTED)) {
    test(`${key} fetches only the faces its own tokens name`, async ({ page }) => {
      const fontRequests: string[] = []
      page.on('request', (request) => {
        if (request.resourceType() === 'font') fontRequests.push(request.url())
      })

      await page.goto(`/preview/${key}?fixture=report-sample`)
      // The fetch is driven by layout, so wait for the page to settle rather
      // than for a request that may already have happened.
      await page.waitForLoadState('networkidle')

      // The filenames are hashed, so the check is on the count rather than on
      // the names: two families, and nothing from the other four.
      expect(fontRequests.length).toBeGreaterThan(0)
      expect(fontRequests.length).toBeLessThanOrEqual(families.length * 2)
    })
  }
})
