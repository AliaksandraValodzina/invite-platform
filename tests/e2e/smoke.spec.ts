import { expect, test } from '@playwright/test'

/**
 * The gate test. It has to go red if the app fails to render, so it reads real
 * values out of the page rather than asserting that elements merely exist.
 *
 * It used to read the site URL the home page printed. That debug list is gone
 * now the domain is bought, and the config contract it stood in for is asserted
 * directly in tests/unit/env.test.ts. What is left here is what a stranger
 * typing the domain actually gets: a 200, the product's name in the heading,
 * and the same name in the tab and the share preview.
 */
test.describe('home page', () => {
  test('renders the app shell under the product name', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)

    // Read the heading text, do not just assert it is visible.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mirthly')

    // The browser tab and the chat preview are separate tags and both are the
    // first impression of the product, so both are read rather than assumed.
    await expect(page).toHaveTitle('Mirthly')

    const ogTitle = await page.locator('meta[property="og:title"]').first().getAttribute('content')
    expect(ogTitle).toBe('Mirthly')

    const ogSiteName = await page
      .locator('meta[property="og:site_name"]')
      .first()
      .getAttribute('content')
    expect(ogSiteName).toBe('Mirthly')

    // The working title must not survive anywhere in what is served.
    expect(await page.content()).not.toContain('Invite Platform')
  })

  test('a buyer page carries the name through the title template', async ({ page }) => {
    await page.goto('/login')

    await expect(page).toHaveTitle('Sign in - Mirthly')
  })

  test('has no horizontal overflow at the narrowest supported width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})
