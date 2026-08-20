import { expect, test } from '@playwright/test'

import type { SeededEvent } from '../../scripts/seed-event'
import {
  GUEST_CLOSED_MESSAGE,
  GUEST_HEADLINE,
  GUEST_TITLE,
  GUEST_VENUE,
  MISSING_SLUG,
  seedGuestEvent,
} from '../support/events'

/**
 * The four serving states, walked in a browser against real rows.
 *
 * `public.event_state_at` returns `unpublished`, `live`, `grace` or `expired`
 * as a function of the clock, and nothing is written when an event crosses one
 * of those boundaries. So a fixture for a state is a pair of timestamps either
 * side of now, and the only way to know the page reads them the way the
 * database does is to put four real rows in front of a real browser.
 *
 * Two assertions here are the ones worth defending.
 *
 * The unpublished and expired pages are checked for what they do NOT say. Both
 * are reachable by anyone holding the link, including after the hosting a buyer
 * paid for has lapsed, and an expiry page dressed in the couple's names and
 * palette would be showing the thing it exists to withhold. The fixture is
 * named unusually so that finding it in the markup can only mean it leaked.
 *
 * The 404 is checked for the designed page AND for the status. Either alone
 * passes against the wrong thing: Next's own error page is still a 404, and a
 * designed page served at 200 tells a crawler the link works.
 */

const STATES = ['unpublished', 'live', 'grace', 'expired'] as const

const seeded = new Map<(typeof STATES)[number], SeededEvent>()

test.beforeAll(async () => {
  for (const state of STATES) {
    seeded.set(state, await seedGuestEvent(state))
  }
})

function slugFor(state: (typeof STATES)[number]): string {
  const event = seeded.get(state)
  if (event === undefined) throw new Error(`no ${state} fixture was seeded`)
  return event.slug
}

test.describe('the guest page', () => {
  test('serves the invitation while hosting is paid up, with replies open', async ({ page }) => {
    const response = await page.goto(`/e/${slugFor('live')}`)
    expect(response?.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GUEST_HEADLINE)

    // Template order, from the committed definition, through the real resolver.
    const ids = await page
      .locator('[data-block-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-block-id')))
    expect(ids).toEqual(['hero', 'event-details', 'countdown', 'venue-map', 'rsvp'])

    // The date is not in the template. It is read off the event row through
    // "source": "event-date", so this is the assertion that the page and the
    // database agree about when the wedding is.
    await expect(page.getByText('Sunday 14 March 2027')).toBeVisible()
    await expect(page.getByText('4:00 pm')).toBeVisible()
    await expect(page.getByText(GUEST_VENUE)).toBeVisible()

    // Replies are open: the form is there, and it is the buyer's copy on it.
    await expect(page.getByRole('button', { name: 'Send our reply' })).toBeVisible()
    await expect(page.getByLabel('Your name')).toBeVisible()
  })

  test('keeps serving after hosting lapses, with replies closed', async ({ page }) => {
    const response = await page.goto(`/e/${slugFor('grace')}`)
    expect(response?.status()).toBe(200)

    // Grace exists so a link already in a group chat does not break mid event.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GUEST_HEADLINE)
    await expect(page.getByText('Sunday 14 March 2027')).toBeVisible()

    // And RSVPs close at hosting expiry, because collecting new guest PII
    // against lapsed hosting is the thing grace must not do.
    await expect(page.getByText(GUEST_CLOSED_MESSAGE)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send our reply' })).toHaveCount(0)
    await expect(page.getByLabel('Your name')).toHaveCount(0)
  })

  test('shows the designed unpublished notice, and none of the event', async ({ page }) => {
    const response = await page.goto(`/e/${slugFor('unpublished')}`)
    expect(response?.status()).toBe(200)

    const notice = page.getByTestId('guest-notice')
    await expect(notice).toHaveAttribute('data-notice', 'unpublished')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This invitation is not ready yet'
    )

    const markup = await page.content()
    expect(markup).not.toContain(GUEST_HEADLINE)
    expect(markup).not.toContain(GUEST_TITLE)
    expect(markup).not.toContain(GUEST_VENUE)
    expect(markup).toContain('name="robots" content="noindex')
  })

  test('shows the designed expiry notice, and none of the event', async ({ page }) => {
    const response = await page.goto(`/e/${slugFor('expired')}`)
    expect(response?.status()).toBe(200)

    await expect(page.getByTestId('guest-notice')).toHaveAttribute('data-notice', 'expired')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This invitation has closed')

    const markup = await page.content()
    expect(markup).not.toContain(GUEST_HEADLINE)
    expect(markup).not.toContain(GUEST_TITLE)
    expect(markup).not.toContain(GUEST_VENUE)
  })

  test('answers a slug that does not exist with the designed 404, at a 404', async ({ page }) => {
    const response = await page.goto(`/e/${MISSING_SLUG}`)

    expect(response?.status()).toBe(404)
    await expect(page.getByTestId('guest-notice')).toHaveAttribute('data-notice', 'not-found')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'That link does not lead anywhere'
    )
  })

  test('shows a designed notice when a published event has nothing to serve', async ({ page }) => {
    // A live event whose only content revision is not the published one. It is
    // a data hazard rather than a contrivance: it is what a half finished
    // publish path leaves behind. src/lib/template/resolve.ts refuses to fall
    // back to the template defaults here, because those are Sarah and Tom, and
    // showing another couple's placeholder names to real guests is worse than a
    // designed apology.
    const broken = await seedGuestEvent('live', { publishContent: false })

    await page.goto(`/e/${broken.slug}`)

    await expect(page.getByTestId('guest-notice')).toHaveAttribute('data-notice', 'unavailable')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This page could not be loaded'
    )

    const markup = await page.content()
    expect(markup).not.toContain(GUEST_HEADLINE)
  })

  test('does not overflow at the narrowest supported width, in any state', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })

    for (const path of [
      `/e/${slugFor('live')}`,
      `/e/${slugFor('grace')}`,
      `/e/${slugFor('unpublished')}`,
      `/e/${slugFor('expired')}`,
      `/e/${MISSING_SLUG}`,
    ]) {
      await page.goto(path)

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth, `${path} scrolls sideways at 320px`).toBeLessThanOrEqual(clientWidth)

      // Not scrolling sideways is not enough on its own: a block could be
      // clipping rather than wrapping.
      const widest = await page
        .locator('[data-block-id], [data-testid="guest-notice"]')
        .evaluateAll((nodes) => Math.max(0, ...nodes.map((node) => node.scrollWidth)))
      expect(widest, `${path} has a section wider than the viewport`).toBeLessThanOrEqual(
        clientWidth
      )
    }
  })

  test('points a chat app at a card for this event, with no card text in the URL', async ({
    page,
  }) => {
    await page.goto(`/e/${slugFor('live')}`)

    const image = await page.locator('meta[property="og:image"]').getAttribute('content')
    expect(image, 'og:image is missing, so a pasted link renders no preview').not.toBeNull()

    const url = new URL(image!)
    // Absolute, or the preview silently never renders.
    expect(url.origin).not.toBe('')
    expect(url.pathname).toBe('/api/og')
    expect(url.searchParams.get('slug')).toBe(slugFor('live'))
    expect(url.searchParams.get('v')).toMatch(/^[0-9a-z]{1,13}$/)
    expect(url.search).not.toContain('Wilhelmina')

    expect(await page.locator('meta[property="og:image:width"]').getAttribute('content')).toBe(
      '1200'
    )
    expect(await page.locator('meta[property="og:image:height"]').getAttribute('content')).toBe(
      '630'
    )
  })

  test('refuses to store a reply, rather than thanking a guest for nothing', async ({ page }) => {
    await page.goto(`/e/${slugFor('live')}`)

    await page.getByLabel('Your name').fill('A Guest')
    await page.getByRole('button', { name: 'Send our reply' }).click()

    // Stage 2 builds the reply path. Until it does, the form has to say so:
    // a success message over a write that never happened is the failure mode
    // that is invisible to everyone until the buyer counts their replies.
    await expect(page.getByText('Nothing was sent')).toBeVisible()
    await expect(
      page.getByText('Thank you. Wilhelmina and Bartholomew have your reply.')
    ).toHaveCount(0)
  })
})
