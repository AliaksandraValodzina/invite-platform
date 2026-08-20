import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { parseHex } from '../../src/lib/template/contrast'
import { themePipeline, type ThemeTokens } from '../../src/lib/template/theme'

/**
 * The envelope, in a browser.
 *
 * Two claims are worth a browser, and neither can be made anywhere else.
 *
 * The first is that three design directions produce three different envelopes
 * from tokens alone. A unit test can read the source and see that the paper is
 * `--color-surface`; only a browser can say what colour that resolved to in
 * each direction, and that the three answers are not the same answer.
 *
 * The second is the one the whole feature is built around: a guest who cannot
 * open the envelope can still read the invitation and reply. That is asserted
 * here with scripting turned off and with motion reduced, by actually opening
 * the cover and then putting the RSVP form through Playwright's actionability
 * checks. "The form is in the DOM" is not the claim. The claim is that a guest
 * can reach it and type in it.
 *
 * Both projects in playwright.config.ts run this file, so every assertion below
 * is also made at 320px, which is the width the guest pages are contracted to.
 */

const DIRECTIONS = ['deckle-and-deboss', 'masthead', 'foil-and-midnight'] as const

/** The committed theme documents, so the expected values are the tokens themselves. */
function tokensOf(direction: string): ThemeTokens {
  const path = fileURLToPath(new URL(`../../templates/themes/${direction}.json`, import.meta.url))
  return themePipeline.parse(JSON.parse(readFileSync(path, 'utf8'))).tokens
}

function rgb(hex: string): string {
  const { r, g, b } = parseHex(hex)
  return `rgb(${r}, ${g}, ${b})`
}

/** rem to px at the browser default root size, which nothing in this app changes. */
function px(rem: number): string {
  return `${rem * 16}px`
}

/**
 * What the cover is painted with, read off the page rather than off the source.
 *
 * Deliberately the four things a person would name if asked why two envelopes
 * look different: the page it sits on, the paper of the envelope, the corner of
 * that paper, and the seal.
 */
async function envelopeStyles(page: Page) {
  return page.evaluate(() => {
    function styles(selector: string) {
      const element = document.querySelector(selector)
      if (element === null) throw new Error(`no ${selector} on the page`)
      const computed = getComputedStyle(element)
      return {
        background: computed.backgroundColor,
        color: computed.color,
        borderColor: computed.borderTopColor,
        borderRadius: computed.borderTopLeftRadius,
        width: computed.width,
      }
    }

    return {
      cover: styles('[data-envelope-cover]'),
      paper: styles('[data-envelope-drawing]'),
      seal: styles('[data-envelope-seal]'),
    }
  })
}

function closed(direction: string, fixture = 'report-sample'): string {
  return `/preview/${direction}?envelope=closed&fixture=${fixture}`
}

/** The cover is gone once the fade has run. It is 300ms, so this is generous. */
async function expectOpened(page: Page): Promise<void> {
  await expect(page.locator('[data-envelope-cover]')).toBeHidden({ timeout: 5_000 })
}

test.describe('three directions, three envelopes', () => {
  for (const direction of DIRECTIONS) {
    test(`${direction} draws its envelope from its own tokens`, async ({ page }) => {
      await page.goto(closed(direction))

      const tokens = tokensOf(direction)
      const styles = await envelopeStyles(page)

      // Read the values rather than asserting the three differ. These are the
      // hex and rem values in templates/themes/<direction>.json, resolved by a
      // browser, which is what makes this a claim about the rendered envelope
      // rather than about the component's source.
      expect(styles.cover.background).toBe(rgb(tokens.color.bg))
      expect(styles.paper.background).toBe(rgb(tokens.color.surface))
      expect(styles.paper.borderColor).toBe(rgb(tokens.color.inkMuted))
      expect(styles.paper.borderRadius).toBe(px(tokens.radius.md))
      expect(styles.seal.background).toBe(rgb(tokens.color.accent))
      expect(styles.seal.color).toBe(rgb(tokens.color.accentInk))
      expect(styles.seal.width).toBe(px(tokens.space.xl))
    })
  }

  test('and the three are visibly different from each other', async ({ page }) => {
    const signatures: string[] = []

    for (const direction of DIRECTIONS) {
      await page.goto(closed(direction))
      const styles = await envelopeStyles(page)
      signatures.push(
        [
          styles.cover.background,
          styles.paper.background,
          styles.paper.borderRadius,
          styles.seal.background,
          styles.seal.width,
        ].join(' | ')
      )
    }

    // The definition of done says three visibly different envelopes, so this is
    // that sentence and not a proxy for it. Distinct signatures, pairwise.
    expect(new Set(signatures).size).toBe(DIRECTIONS.length)
  })

  test('presses the couple`s initials into the seal', async ({ page }) => {
    await page.goto(closed('deckle-and-deboss'))

    // Emma & Jake, from the report sample the directions were measured against,
    // and never a second stored copy of their names.
    await expect(page.locator('[data-envelope-seal]')).toHaveText('EJ')
    await expect(page.locator('[data-envelope-headline]')).toContainText('Emma')
  })
})

test.describe('the universal envelope', () => {
  for (const direction of DIRECTIONS) {
    test(`works against ${direction} with nothing of its own`, async ({ page }) => {
      await page.goto(closed(direction, 'universal-envelope'))

      const tokens = tokensOf(direction)

      // The fixture clears every field the template's envelope carries, which
      // is the same document a template that never had one produces.
      await expect(page.locator('[data-envelope-note]')).toHaveCount(0)
      await expect(page.locator('[data-envelope-cover]')).toHaveAttribute(
        'data-envelope-drawn-from',
        'tokens'
      )
      await expect(page.locator('[data-envelope-prompt]')).toHaveText('Tap to open')

      // Still this direction's envelope, not a generic grey one.
      const styles = await envelopeStyles(page)
      expect(styles.paper.background).toBe(rgb(tokens.color.surface))
      expect(styles.seal.background).toBe(rgb(tokens.color.accent))

      await page.locator('[data-envelope-cover]').click()
      await expectOpened(page)
      await expect(page.getByRole('button', { name: 'Send RSVP' })).toBeVisible()
    })
  }
})

test.describe('opening it', () => {
  test('reveals the invitation, which was under it the whole time', async ({ page }) => {
    await page.goto(closed('deckle-and-deboss'))

    // Under it, before anything has been clicked. The details a guest came for
    // are already rendered and already laid out; the cover is over them.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Emma')
    await expect(page.getByText('The Grounds of Alexandria')).toBeVisible()

    await page.locator('[data-envelope-cover]').click()
    await expectOpened(page)

    // And now they can be reached, which is the part the cover was in the way
    // of. `trial` runs Playwright's actionability checks without submitting.
    await page.getByLabel('Your name').fill('Priya Raman')
    await expect(page.getByLabel('Your name')).toHaveValue('Priya Raman')
    await page.getByRole('button', { name: 'Send RSVP' }).click({ trial: true })
  })

  test('opens from the keyboard, because the control is a real one', async ({ page }) => {
    await page.goto(closed('deckle-and-deboss'))

    await page.getByTestId('envelope-open').focus()
    await page.keyboard.press('Space')

    await expectOpened(page)
  })

  test('does not overflow the page sideways, at whatever width this project is', async ({
    page,
  }) => {
    await page.goto(closed('foil-and-midnight', 'long-names'))

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    // "Alexandra & Christopher" on a cover is the same overflow risk it is on
    // the hero, and it is stacked here for the same reason.
    await expect(page.locator('[data-envelope-headline] span')).toHaveText([
      'Alexandra',
      '&',
      'Christopher',
    ])
  })

  test('keeps the whole cover reachable when it is taller than the phone', async ({ page }) => {
    await page.goto(closed('foil-and-midnight', 'long-names'))

    // Safe centring: a cover taller than the viewport falls back to aligning at
    // the top and scrolls, instead of centring and hiding its own first line
    // above the scroll origin.
    const reachable = await page.locator('[data-envelope-cover]').evaluate((node) => {
      const note = node.querySelector('[data-envelope-headline]')
      return note === null ? false : note.getBoundingClientRect().top >= 0
    })

    expect(reachable).toBe(true)
  })
})

/**
 * The requirement, stated as the captain stated it: "A guest who cannot open the
 * envelope must still be able to read the invitation and reply."
 *
 * So this block turns scripting off entirely. Nothing of ours runs: no bundle,
 * no hydration, no handler. What is left is a checkbox, a label and a sibling
 * selector, and the assertion is that a guest with that alone can open the
 * cover, read the details and type into the reply form.
 */
test.describe('with JavaScript unavailable', () => {
  test.use({ javaScriptEnabled: false })

  test('the cover still opens, and the reply form still works', async ({ page }) => {
    await page.goto(closed('deckle-and-deboss'))

    await expect(page.locator('[data-envelope-cover]')).toBeVisible()

    await page.locator('[data-envelope-cover]').click()
    await expectOpened(page)

    await page.getByLabel('Your name').fill('Priya Raman')
    await expect(page.getByLabel('Your name')).toHaveValue('Priya Raman')
    await page.getByRole('button', { name: 'Send RSVP' }).click({ trial: true })
  })

  test('and the invitation is readable even if the cover is never touched', async ({ page }) => {
    await page.goto(closed('deckle-and-deboss'))

    // Nothing here opens anything. The page under the cover is complete, in the
    // document, and in the accessibility tree, which is why an envelope that
    // failed to open would still not cost a guest the details.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Emma')
    await expect(page.getByText('The Grounds of Alexandria')).toBeVisible()
    await expect(page.getByLabel('Your name')).toBeAttached()
    await expect(page.getByRole('button', { name: 'Send RSVP' })).toBeAttached()
  })
})

/**
 * Motion reduced, which is the other way a guest can end up unable to watch an
 * animation. The cover does not animate away, it goes, and everything under it
 * is reachable exactly as before.
 */
test.describe('with motion reduced', () => {
  test('the cover has no transition at all, and still opens', async ({ page }) => {
    // Set on the page rather than through `test.use`, because the fixture form
    // of this option did not reach the browser here and a test that silently
    // ran without the emulation would be asserting nothing.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(closed('deckle-and-deboss'))

    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true
    )

    const transition = await page
      .locator('[data-envelope-cover]')
      .evaluate((node) => getComputedStyle(node).transitionProperty)
    expect(transition).toBe('none')

    await page.locator('[data-envelope-cover]').click()
    await expectOpened(page)

    await page.getByRole('button', { name: 'Send RSVP' }).click({ trial: true })
  })
})

test.describe('the preview affordance', () => {
  test('starts the cover opened, so the blocks can be looked at', async ({ page }) => {
    await page.goto('/preview/deckle-and-deboss?fixture=report-sample')

    // The one place the preview and a guest page deliberately disagree. Every
    // other spec in this suite relies on it, so it is asserted rather than
    // assumed.
    await expect(page.locator('[data-envelope-cover]')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Send RSVP' })).toBeVisible()
  })
})
