import { expect, type Page } from '@playwright/test'

/**
 * Opens the envelope on a guest page.
 *
 * A guest page always starts closed, so every test that reaches past the cover
 * to click something has to do this first, and the failure it prevents is worth
 * naming: a click on an element the cover is over does not fail with "the
 * envelope was closed", it fails with a Playwright timeout about intercepted
 * pointer events, thirty seconds later.
 *
 * The cover is clicked rather than the checkbox, because the whole cover is the
 * target a guest taps, and clicking the thing a guest touches is what proves
 * the label really does span it. `tests/e2e/envelope.spec.ts` is where the
 * opening itself is the subject; this is the affordance every other spec needs.
 */
export async function openEnvelope(page: Page): Promise<void> {
  const cover = page.locator('[data-envelope-cover]')
  await cover.click()
  await expect(cover).toBeHidden()
}
