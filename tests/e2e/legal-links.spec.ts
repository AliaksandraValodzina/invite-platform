import { expect, test, type Page } from '@playwright/test'

import { openEnvelope } from '../support/envelope'
import { seedGuestEvent } from '../support/events'

/**
 * The privacy statement and the terms, reached the way a person reaches them.
 *
 * Mirthly holds guests' names, contact details and dietary notes, from people
 * who never signed up for anything. Both documents shipped with no link to
 * them, so the only way in was to already know the path, which is no way at all
 * for the people the privacy statement is about.
 *
 * These follow the links rather than reading their `href`, and then assert what
 * the destination says. A footer whose links 404, or whose two links both point
 * at `/privacy`, passes any check that stops at the markup and fails a guest.
 *
 * The pages walked are the ones a stranger can arrive on: the front door, an
 * invitation somebody was sent, and a notice for a link that no longer serves
 * one. The unit half is tests/unit/components/site-footer.test.tsx.
 */

async function followFooter(page: Page, name: 'Privacy' | 'Terms'): Promise<void> {
  const footer = page.getByTestId('site-footer')
  await expect(footer).toBeVisible()

  await footer.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test.describe('the way to the legal pages', () => {
  test('is on the front door, and both links lead somewhere different', async ({ page }) => {
    await page.goto('/')
    await followFooter(page, 'Privacy')
    expect(new URL(page.url()).pathname).toBe('/privacy')

    await page.goto('/')
    await followFooter(page, 'Terms')
    expect(new URL(page.url()).pathname).toBe('/terms')
  })

  test('is under a live invitation, where a guest is asked for their details', async ({ page }) => {
    const event = await seedGuestEvent('live')

    await page.goto(`/e/${event.slug}`)

    // The cover is `fixed inset-0` until it is opened, so it is over the footer
    // exactly as it is over the invitation. A guest reaches both the same way.
    await openEnvelope(page)

    await followFooter(page, 'Privacy')
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })

  test('is under an expired invitation, whose guests have already replied', async ({ page }) => {
    const event = await seedGuestEvent('expired')

    await page.goto(`/e/${event.slug}`)
    await expect(page.getByTestId('guest-notice')).toHaveAttribute('data-notice', 'expired')

    await followFooter(page, 'Terms')
    expect(new URL(page.url()).pathname).toBe('/terms')
  })

  test('is on the 404, which is where a mistyped link lands', async ({ page }) => {
    const response = await page.goto('/e/there-is-no-such-invitation-here')
    expect(response?.status()).toBe(404)

    await followFooter(page, 'Privacy')
    expect(new URL(page.url()).pathname).toBe('/privacy')
  })
})
