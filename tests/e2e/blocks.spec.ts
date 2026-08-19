import { expect, test, type Page } from '@playwright/test'

/**
 * The block set in a real browser, at the width most guests are holding.
 *
 * 320px is a floor to assert, not a hope, so the overflow check runs against the
 * long name fixture rather than the pretty one. The measurements in
 * data/ip-design-directions/report.md found that "Emma & Jake" fits on one line
 * at 320px in all three design directions and "Alexandra & Christopher" does
 * not, which is exactly the shape of bug a smoke test built from the sample
 * content would sail past.
 *
 * The countdown runs against a fake browser clock rather than the real one.
 * A countdown asserted against `Date.now()` is a test that passes for the wrong
 * reason on the wrong side of a minute boundary.
 */

/** The seeded event: 4pm on 14 March 2027 in Sydney, which is +11 at that date. */
const EVENT_INSTANT = Date.parse('2027-03-14T05:00:00Z')

const MOBILE = { width: 320, height: 568 }

async function countdownUnits(page: Page): Promise<Record<string, string>> {
  const units = page.locator('[data-unit]')
  const entries = await units.evaluateAll((nodes) =>
    nodes.map((node) => [
      node.getAttribute('data-unit') ?? '',
      node.firstElementChild?.textContent ?? '',
    ])
  )
  return Object.fromEntries(entries)
}

test.describe('the guest page blocks', () => {
  test('renders all five blocks, in template order, with the buyer copy', async ({ page }) => {
    await page.goto('/preview/ivory')

    const ids = await page
      .locator('[data-block-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-block-id')))
    expect(ids).toEqual(['hero', 'event-details', 'countdown', 'venue-map', 'rsvp'])

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sarah & Tom')

    // The date is not in the template. It is read off the event row through
    // "source": "event-date", so this is the assertion that the details list and
    // the countdown are looking at the same field.
    await expect(page.getByText('Sunday 14 March 2027')).toBeVisible()
    await expect(page.getByText('4:00 pm')).toBeVisible()

    await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute(
      'href',
      'https://maps.google.com/?q=The+Boathouse+Shelly+Beach+Manly'
    )
  })

  test('does not overflow 320px, even with names long enough to break the lockup', async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/preview/ivory?fixture=long-names')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alexandra & Christopher')

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    // The page not scrolling sideways is not enough on its own: a block could
    // be clipping instead of wrapping. Every section has to fit inside the
    // viewport too.
    const widest = await page
      .locator('[data-block-id]')
      .evaluateAll((nodes) => Math.max(...nodes.map((node) => node.scrollWidth)))
    expect(widest).toBeLessThanOrEqual(clientWidth)
  })

  test('counts down to the instant the local pair resolves to, and keeps ticking', async ({
    page,
  }) => {
    // Five days, two hours and thirty minutes out, plus a deliberate 45 seconds.
    // The seed's countdown shows whole minutes, so a target sitting exactly on a
    // minute boundary would read one lower the moment the page took a second to
    // load. The spare seconds are what makes the assertion about the countdown
    // rather than about how fast the machine running it is.
    const remaining = 5 * 86_400_000 + 2 * 3_600_000 + 30 * 60_000 + 45_000
    await page.clock.install({ time: new Date(EVENT_INSTANT - remaining) })
    await page.goto('/preview/ivory')

    await expect.poll(() => countdownUnits(page)).toEqual({ days: '5', hours: '2', minutes: '30' })

    // A countdown that renders once and stops is the failure a screenshot
    // cannot see.
    await page.clock.fastForward('01:00')
    await expect.poll(() => countdownUnits(page)).toEqual({ days: '5', hours: '2', minutes: '29' })
  })

  test('says what the template wrote once the event has started', async ({ page }) => {
    await page.clock.install({ time: new Date(EVENT_INSTANT + 60_000) })
    await page.goto('/preview/ivory')

    await expect(page.getByTestId('countdown-passed')).toHaveText(
      'Today is the day. See you there.'
    )
    await expect(page.locator('[data-unit]')).toHaveCount(0)
  })
})

test.describe('the RSVP form', () => {
  test('takes a reply and confirms it in the words the template chose', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/preview/ivory')

    await page.getByLabel('Your name').fill('Priya Raman')
    await page.getByLabel("Yes, I'll be there").check()
    await page.getByLabel('How many of you?').selectOption('2')
    await page.getByLabel('Email, so we can send you the details').fill('priya@example.com')
    await page.getByRole('button', { name: 'Send RSVP' }).click()

    await expect(page.getByTestId('rsvp-success')).toHaveText(
      'Thank you. Sarah and Tom have your reply.'
    )
    await expect(page.getByRole('button', { name: 'Send RSVP' })).toHaveCount(0)
  })

  test('does not ask a guest who cannot come how many are coming', async ({ page }) => {
    await page.goto('/preview/ivory')

    await expect(page.getByLabel('How many of you?')).toBeVisible()

    // rsvps_party_size_range and its sibling constraint require a decline to
    // carry a party size of zero, so asking would be asking for a row the
    // database refuses.
    await page.getByLabel("Sorry, I can't make it").check()
    await expect(page.getByLabel('How many of you?')).toHaveCount(0)
  })

  test('serves the closed message during grace, with nothing left to submit', async ({ page }) => {
    await page.goto('/preview/ivory?rsvp=closed')

    await expect(page.getByTestId('rsvp-closed')).toHaveText(
      'RSVPs are closed for this event. Please contact Sarah or Tom directly.'
    )
    await expect(page.getByRole('button', { name: 'Send RSVP' })).toHaveCount(0)
    await expect(page.getByLabel('Your name')).toHaveCount(0)
  })
})

test.describe('one block set, two looks', () => {
  test('paints the same markup in whatever palette the theme document carries', async ({
    page,
  }) => {
    const read = async (theme: string) => {
      await page.goto(`/preview/${theme}`)
      return page.locator('[data-theme-scope]').evaluate((node) => {
        const styles = getComputedStyle(node)
        const heading = document.querySelector('h1')
        return {
          background: styles.backgroundColor,
          ink: styles.color,
          display: heading === null ? '' : getComputedStyle(heading).fontSize,
        }
      })
    }

    // Read the values, do not merely assert that the two differ. These are the
    // hex values in templates/themes, resolved by the browser.
    expect(await read('ivory')).toEqual({
      background: 'rgb(253, 251, 247)',
      ink: 'rgb(35, 32, 28)',
      display: '40px',
    })
    expect(await read('midnight')).toEqual({
      background: 'rgb(13, 15, 26)',
      ink: 'rgb(242, 240, 234)',
      display: '44px',
    })
  })
})
