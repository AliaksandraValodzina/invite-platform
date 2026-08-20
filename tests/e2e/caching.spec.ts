import { expect, test } from '@playwright/test'

import { GUEST_PAGE_REVALIDATE_SECONDS } from '@/lib/serving/cache'
import { seedGuestEvent } from '../support/events'

/**
 * The cache headers, read off the wire.
 *
 * Wrong headers bypass both caches and nothing errors. The page renders
 * correctly every single time, and is simply slow and expensive for everybody
 * who is not the developer looking at it over fibre with a warm browser cache.
 * A missing `Cache-Control` does not mean "no cache", it means the browser
 * applies a heuristic and the CDN in front applies its own default, so the
 * failure is silent by construction. Nothing catches that unless a test is
 * written for it. This is that test.
 *
 * Two things about how it runs.
 *
 * It refuses to run against the dev server. Next's dev server sets different
 * headers from a production build and there is no CDN in the loop locally, so a
 * dev assertion proves the one thing that was never in doubt. CI runs the suite
 * against `next start`, which is the production build, and DEPLOYED_BASE_URL
 * points it at a real deployment, which is the only place the CDN's half of
 * this can be seen at all.
 *
 * The assertion that matters is the last one. A header being present is a
 * claim; `transferSize === 0` on a reload is the browser confirming it did not
 * go to the network. The others are its shadow, and they are here because they
 * say which header was wrong when it goes red.
 */

const DEPLOYED_BASE_URL = process.env.DEPLOYED_BASE_URL
const DEPLOYED_EVENT_SLUG = process.env.DEPLOYED_EVENT_SLUG
const AGAINST_A_DEPLOYMENT = DEPLOYED_BASE_URL !== undefined

/** One year, the lifetime a content addressed URL has earned. */
const IMMUTABLE_MAX_AGE = 31_536_000

let target: string

test.beforeAll(async ({ baseURL }) => {
  if (AGAINST_A_DEPLOYMENT) {
    if (DEPLOYED_EVENT_SLUG === undefined) {
      throw new Error(
        'DEPLOYED_BASE_URL was set without DEPLOYED_EVENT_SLUG. This suite cannot seed into a ' +
          'deployment it does not hold credentials for, so name an event that is already live there.'
      )
    }
    target = `${DEPLOYED_BASE_URL.replace(/\/$/, '')}/e/${DEPLOYED_EVENT_SLUG}`
    return
  }

  const event = await seedGuestEvent('live')
  target = `${baseURL}/e/${event.slug}`
})

test.describe('the guest page cache headers', () => {
  test.beforeEach(({ browserName: _browserName }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'headers do not vary by viewport, and a second run is a second billed minute'
    )
    test.skip(
      !AGAINST_A_DEPLOYMENT && !process.env.CI,
      'the dev server sets different headers from a production build. Run with CI=1 against ' +
        '`npm run build && npm start`, or set DEPLOYED_BASE_URL to a deployed preview.'
    )
  })

  test('the document is edge cacheable, browser revalidated, and never immutable', async ({
    request,
  }) => {
    const response = await request.get(target)
    expect(response.status()).toBe(200)

    const header = response.headers()['cache-control']
    expect(header, 'the guest page carries no Cache-Control at all').toBeDefined()

    const parsed = directives(header!)

    // A shared cache may hold one copy for every guest. Without this the edge
    // cache does nothing and every guest reaches the origin.
    expect(parsed.has('public')).toBe(true)

    // The browser asks every time. That is what bounds how long somebody can be
    // holding a page that says "live, RSVPs open" for an event whose hosting
    // has lapsed.
    expect(parsed.get('max-age')).toBe('0')
    expect(parsed.has('must-revalidate')).toBe(true)

    const sMaxAge = Number(parsed.get('s-maxage'))
    expect(Number.isFinite(sMaxAge), 'no s-maxage, so no edge cache').toBe(true)
    expect(sMaxAge).toBeLessThanOrEqual(GUEST_PAGE_REVALIDATE_SECONDS)

    // `immutable` belongs on content addressed assets, whose bytes decide their
    // own URL. On a document it would pin a live invitation in a guest's
    // browser until they cleared it by hand.
    expect(header).not.toContain('immutable')

    // Without an ETag, "ask every time" costs a whole page every time.
    expect(
      response.headers()['etag'],
      'no ETag, so every revalidation is a full page'
    ).toBeDefined()
  })

  test('a revalidation costs a 304 rather than the page again', async ({ request }) => {
    const first = await request.get(target)
    const etag = first.headers()['etag']
    expect(etag).toBeDefined()

    const second = await request.get(target, { headers: { 'If-None-Match': etag! } })

    expect(second.status()).toBe(304)
  })

  test('every content addressed asset is immutable for a year', async ({ page }) => {
    const assets: { url: string; cacheControl: string | undefined }[] = []

    page.on('response', (response) => {
      if (!isContentAddressed(response.url())) return
      assets.push({ url: response.url(), cacheControl: response.headers()['cache-control'] })
    })

    await page.goto(target, { waitUntil: 'load' })

    // An empty list would pass every assertion below it. This is the guard
    // against a test that proves nothing because it measured nothing.
    expect(assets.length, 'no content addressed assets were served at all').toBeGreaterThan(0)

    for (const asset of assets) {
      const parsed = directives(asset.cacheControl ?? '')
      expect(
        Number(parsed.get('max-age')),
        `${asset.url} is not cached for a year`
      ).toBeGreaterThanOrEqual(IMMUTABLE_MAX_AGE)
      // Without `immutable`, an explicit reload still costs a round trip per
      // asset. On a phone with 300ms of latency that is most of the page's
      // perceived load time, for no bytes.
      expect(parsed.has('immutable'), `${asset.url} is missing immutable`).toBe(true)
    }
  })

  test('a reload fetches no bytes for those assets, which is the browser confirming it', async ({
    page,
  }) => {
    await page.goto(target, { waitUntil: 'load' })
    await page.reload({ waitUntil: 'load' })

    const entries = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        transferSize: (entry as PerformanceResourceTiming).transferSize,
      }))
    )

    const cached = entries.filter((entry) => isContentAddressedName(entry.name))
    expect(cached.length, 'the reload requested no content addressed assets').toBeGreaterThan(0)

    for (const entry of cached) {
      // Not "the header was right". This is the browser saying it did not open
      // a connection.
      expect(entry.transferSize, `${entry.name} was fetched again on reload`).toBe(0)
    }
  })
})

/**
 * What counts as content addressed today.
 *
 * Everything under `/_next/static/` carries a build hash in its filename, so an
 * edit produces a different URL and there is never anything to invalidate. That
 * is the same property buyer uploads will have when they arrive, and when they
 * do they join this assertion rather than getting one of their own.
 */
function isContentAddressed(url: string): boolean {
  return isContentAddressedName(url)
}

function isContentAddressedName(name: string): boolean {
  return name.includes('/_next/static/')
}

function directives(header: string): Map<string, string | null> {
  return new Map(
    header
      .split(',')
      .filter((part) => part.trim() !== '')
      .map((part) => {
        const [name, value] = part.trim().split('=')
        return [name!.toLowerCase(), value ?? null]
      })
  )
}
