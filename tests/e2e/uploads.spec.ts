import { expect, test } from '@playwright/test'

import { UPLOAD_KIND_SPECS, UPLOAD_MAX_BYTES } from '@/lib/uploads'
import { signIn } from '../support/auth'
import { GUEST_CONTENT, seedGuestEvent } from '../support/events'
import {
  distinctPhotograph,
  mp3Bytes,
  oversizedJpegBytes,
  photographBytes,
  svgBytes,
  upload,
} from '../support/uploads'

/**
 * Uploads, over HTTP, as a buyer.
 *
 * The unit suite proves the capability's pieces. This proves the thing that
 * matters commercially and legally, which is that the limits hold on the wire
 * against a request that did not come from our own code. A limit enforced only
 * in an interface is a limit that lasts until somebody opens a terminal.
 *
 * The second half is the caching requirement, and it is gated the same way
 * `caching.spec.ts` is gated and for the same reason: the dev server writes
 * different headers from a production build, so asserting them against dev
 * proves the one thing that was never in doubt. Run it with CI=1 against
 * `npm run build && npm start`.
 */

/** One year, the lifetime a content addressed URL has earned. */
const IMMUTABLE_MAX_AGE = 31_536_000

type Fixture = { eventId: string; slug: string; ownerEmail: string }

async function buyerWithEvent(page: import('@playwright/test').Page): Promise<Fixture> {
  const ownerEmail = `uploads-buyer-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}@example.test`
  const event = await seedGuestEvent('live', { ownerEmail })
  await signIn(page, ownerEmail)
  return { eventId: event.eventId, slug: event.slug, ownerEmail }
}

test.describe('the upload endpoint', () => {
  test.beforeEach(({ browserName: _browserName }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium',
      'this endpoint has no layout, and a second run is a second billed minute'
    )
  })

  test('accepts a photograph and stores dramatically less than it accepted', async ({ page }) => {
    const fixture = await buyerWithEvent(page)
    const original = photographBytes()

    const result = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: original,
    })

    expect(result.status, result.message).toBe(201)
    expect(result.originalBytes).toBe(original.byteLength)

    /*
     * The claim the ten megabyte limit rests on, asserted rather than stated:
     * what is stored and served is a fraction of what was accepted. Reading the
     * number back off a real response is the point; the unit test proves the
     * encoder, this proves the endpoint reports what the encoder did.
     */
    expect(result.storedBytes).toBeLessThan(original.byteLength / 2)
    expect(result.variants!.length).toBeGreaterThan(0)

    for (const variant of result.variants!) {
      // A URL, built from the key at response time. Nothing stores one.
      expect(variant.url).toMatch(/^\/a\/[a-f0-9]{24}-w\d+\.webp$/)
    }
  })

  test('takes the music file and the envelope through the same endpoint', async ({ page }) => {
    const fixture = await buyerWithEvent(page)

    const music = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'audio',
      name: 'song.mp3',
      mimeType: 'audio/mpeg',
      bytes: mp3Bytes(),
    })
    expect(music.status, music.message).toBe(201)
    expect(music.variants![0]!.url).toMatch(/\.mp3$/)

    const envelope = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'envelope',
      name: 'envelope.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })
    expect(envelope.status, envelope.message).toBe(201)
    expect(envelope.variants!.map((variant) => variant.label)).toEqual(
      // The envelope's own widths, from the same code path as the photo's.
      UPLOAD_KIND_SPECS.envelope.variants
        .map((variant) => variant.label)
        .filter((label) => envelope.variants!.some((sent) => sent.label === label))
    )
  })

  test('refuses an SVG whatever the request claims it is', async ({ page }) => {
    const fixture = await buyerWithEvent(page)

    const result = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      // The filename and the type both lie. Only the bytes are consulted.
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: svgBytes(),
    })

    expect(result.status).toBe(400)
    expect(result.message).toMatch(/SVG/)
  })

  test('refuses a file over the size limit', async ({ page }) => {
    const fixture = await buyerWithEvent(page)

    const result = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      bytes: oversizedJpegBytes(),
    })

    expect(result.status).toBe(413)
    expect(result.message).toContain(String(UPLOAD_MAX_BYTES / 1_000_000))
  })

  test('refuses music where a picture belongs, and the other way round', async ({ page }) => {
    const fixture = await buyerWithEvent(page)

    const asImage = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'song.mp3',
      mimeType: 'audio/mpeg',
      bytes: mp3Bytes(),
    })
    expect(asImage.status).toBe(400)

    const asAudio = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'audio',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })
    expect(asAudio.status).toBe(400)
  })

  test('enforces the per event cap on the server, not in an interface', async ({ page }) => {
    const fixture = await buyerWithEvent(page)

    const first = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'envelope',
      name: 'envelope.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })
    expect(first.status, first.message).toBe(201)

    /*
     * A different file, so this is the CAP refusing it rather than the dedupe
     * index. One envelope image per event is the captain's number, and this is
     * the assertion that it is a rule rather than a form validation.
     */
    const second = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'envelope',
      name: 'another.mp3',
      mimeType: 'image/jpeg',
      bytes: Buffer.concat([photographBytes(), Buffer.from('different')]),
    })
    expect(second.status).toBe(409)
    expect(second.message).toMatch(/already has/)
  })

  test('costs one object when the same file is uploaded twice', async ({ page }) => {
    const fixture = await buyerWithEvent(page)
    const bytes = photographBytes()

    const first = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes,
    })
    const second = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo-again.jpg',
      mimeType: 'image/jpeg',
      bytes,
    })

    expect(second.status, second.message).toBe(201)
    expect(second.id).toBe(first.id)
    expect(second.variants![0]!.key).toBe(first.variants![0]!.key)
  })

  test('refuses somebody else event, and says the same thing as a missing one', async ({
    page,
    browser,
  }) => {
    const mine = await buyerWithEvent(page)

    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await buyerWithEvent(otherPage)

    const result = await upload(otherPage.request, {
      eventId: mine.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })

    expect(result.status).toBe(404)
    await otherContext.close()
  })

  test('refuses a signed out request', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const fixture = await buyerWithEvent(page)

    const anonymous = await browser.newContext()
    const result = await upload(anonymous.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })

    expect(result.status).toBe(401)
    await anonymous.close()
    await context.close()
  })
})

test.describe('a takedown removes the bytes', () => {
  test.beforeEach(({ browserName: _browserName }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'not a layout test')
  })

  /*
   * `request` rather than `page.request` for every fetch of the asset itself.
   * `page.request` shares the browser's HTTP cache, and the whole point of this
   * capability is that an asset is cached for a year with `immutable`, so a
   * second fetch through the page would be answered out of that cache and would
   * prove nothing about the store. That is not a testing inconvenience: it is
   * the honest limit of a takedown, and it is why the terms page promises to
   * stop serving rather than to unsend.
   */
  test('and the address stops serving, which is the only way an immutable URL can', async ({
    page,
    request,
  }) => {
    const fixture = await buyerWithEvent(page)

    const stored = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      // Its own pixels, so the sweep is not being asked to remove an object
      // another event still references. See distinctPhotograph.
      bytes: await distinctPhotograph(1301),
    })
    expect(stored.status, stored.message).toBe(201)

    const url = stored.variants![0]!.url
    expect((await request.get(url)).status()).toBe(200)

    const removed = await page.request.delete(`/api/uploads/${stored.id}`)
    expect(removed.status()).toBe(200)

    /*
     * Disabling alone is not enough, and that is the honest shape of a takedown
     * here: an immutable cache lifetime means no header and no purge can
     * un-serve an address. The bytes have to go, and the sweep is what removes
     * them. This is the assertion the plan asks for by name, because deleting
     * from the store is the work that gets silently skipped.
     */
    /*
     * The sweep drains a bounded batch, and the queue holds whatever every
     * other test in this file condemned as well, so one call is not guaranteed
     * to reach this asset. Draining until this URL stops serving is the
     * assertion; counting deletions would pass on somebody else's bytes.
     */
    let deleted = 0
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await request.get(url)).status() === 404) break
      const swept = await request.post('/api/uploads/sweep')
      expect(swept.status()).toBe(200)
      const report = (await swept.json()) as { deleted: number; claimed: number }
      deleted += report.deleted
      if (report.claimed === 0) break
    }

    expect(deleted).toBeGreaterThan(0)
    expect((await request.get(url)).status()).toBe(404)
  })
})

/**
 * The caching half.
 *
 * Gated exactly like `caching.spec.ts`: the dev server writes different headers
 * from a production build, and a dev assertion proves the one thing that was
 * never in doubt.
 */
test.describe('an uploaded asset is content addressed and cached for a year', () => {
  test.beforeEach(({ browserName: _browserName }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'headers do not vary by viewport')
    test.skip(
      !process.env.CI,
      'the dev server sets different headers from a production build. Run with CI=1 against ' +
        '`npm run build && npm start`.'
    )
  })

  test('carries the immutable header, an ETag, and answers a revalidation with a 304', async ({
    page,
    request,
  }) => {
    const fixture = await buyerWithEvent(page)
    const stored = await upload(page.request, {
      eventId: fixture.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photographBytes(),
    })
    expect(stored.status, stored.message).toBe(201)

    const url = stored.variants![0]!.url
    const response = await request.get(url)
    expect(response.status()).toBe(200)

    const header = response.headers()['cache-control']
    expect(header, 'an uploaded asset carries no Cache-Control at all').toBeDefined()
    expect(Number(header!.match(/max-age=(\d+)/)?.[1])).toBeGreaterThanOrEqual(IMMUTABLE_MAX_AGE)
    expect(header).toContain('immutable')
    expect(response.headers()['content-type']).toBe('image/webp')
    // The type came from sniffing the bytes. nosniff stops a browser second
    // guessing that and rendering an image as something executable.
    expect(response.headers()['x-content-type-options']).toBe('nosniff')

    const etag = response.headers()['etag']
    expect(etag).toBeDefined()

    const revalidated = await request.get(url, { headers: { 'If-None-Match': etag! } })
    expect(revalidated.status()).toBe(304)
  })

  test('a reload fetches no bytes for it, which is the browser confirming it', async ({ page }) => {
    /*
     * The asset is put on the page by SEEDING it there, not by editing content
     * and waiting. The guest page is cached for up to a minute on purpose and
     * that bound is a privacy control this repo chose (src/lib/serving/cache.ts),
     * so a test that edits and then looks is racing a documented behaviour. The
     * event whose page is measured is created after the upload exists, with the
     * asset already named in its content, so its first render is the right one.
     *
     * Uploading the same photograph to the second event is not a workaround: it
     * is the row that entitles that event to the object, and it costs one
     * object rather than two because keys are content addressed.
     */
    const first = await buyerWithEvent(page)
    const photograph = await distinctPhotograph(1302)

    const stored = await upload(page.request, {
      eventId: first.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photograph,
    })
    expect(stored.status, stored.message).toBe(201)

    const key = stored.variants!.at(-1)!.key
    const content = {
      ...GUEST_CONTENT,
      blocks: {
        ...GUEST_CONTENT.blocks,
        hero: { ...GUEST_CONTENT.blocks.hero, artwork: { src: `/a/${key}` } },
      },
    }

    const shown = await seedGuestEvent('live', { ownerEmail: first.ownerEmail, content })
    const alsoStored = await upload(page.request, {
      eventId: shown.eventId,
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: photograph,
    })
    expect(alsoStored.status, alsoStored.message).toBe(201)
    // One object, two rows: the same bytes produced the same address.
    expect(alsoStored.variants!.at(-1)!.key).toBe(key)

    await page.goto(`/e/${shown.slug}`, { waitUntil: 'load' })

    // The upload is actually on the page. An assertion about caching an asset
    // the page never requested would pass against a page with no images.
    const artwork = page.locator(`[data-hero-artwork] img[src="/a/${key}"]`)
    await expect(artwork).toBeVisible()

    await page.reload({ waitUntil: 'load' })

    const entries = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        transferSize: (entry as PerformanceResourceTiming).transferSize,
      }))
    )

    const asset = entries.filter((entry) => entry.name.includes(`/a/${key}`))
    expect(asset.length, 'the reload requested the asset not at all').toBeGreaterThan(0)

    for (const entry of asset) {
      // Not "the header was right". This is the browser saying it did not open
      // a connection.
      expect(entry.transferSize, `${entry.name} was fetched again on reload`).toBe(0)
    }
  })
})
