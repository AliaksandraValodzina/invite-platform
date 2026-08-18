import { expect, test } from '@playwright/test'

/**
 * The gate test. It has to go red if the app fails to render, so it reads real
 * values out of the page rather than asserting that elements merely exist.
 */
test.describe('home page', () => {
  test('renders the app shell and its config values', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)

    // Read the heading text, do not just assert it is visible.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invite Platform')

    // The page must report a usable absolute origin whether or not the variable
    // is configured, which is the "inert when absent" contract in src/lib/env.ts.
    const siteUrl = await page.getByTestId('site-url').innerText()
    expect(() => new URL(siteUrl)).not.toThrow()
    expect(new URL(siteUrl).origin).toBe(siteUrl)

    const source = await page.getByTestId('site-url-source').innerText()
    expect(['environment', 'fallback']).toContain(source)
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
