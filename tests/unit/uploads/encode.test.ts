import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { encodeUpload, UPLOAD_FORMATS, UPLOAD_KIND_SPECS } from '@/lib/uploads'

import {
  imageBytes,
  locatedPhotographBytes,
  mp3Bytes,
  phonePhotographBytes,
  photographBytes,
  rotatedPhotographBytes,
  widePhotographBytes,
} from './fixtures'

/**
 * Re-encoding, measured rather than described.
 *
 * The whole justification for accepting a ten megabyte photograph is that what
 * gets stored and served is a fraction of it. That is a claim about bytes, so
 * these assertions are about bytes: a real photograph in, a ratio out, with the
 * numbers printed so the figure in the pull request is one somebody can
 * reproduce rather than one they have to believe.
 */

function total(variants: readonly { bytes: Uint8Array }[]): number {
  return variants.reduce((sum, variant) => sum + variant.bytes.byteLength, 0)
}

describe('a real photograph, before and after', () => {
  it('stores dramatically less than it accepted', async () => {
    const original = photographBytes()
    const encoded = await encodeUpload('image', original, UPLOAD_FORMATS.jpeg)

    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const after = total(encoded.variants)
    const ratio = after / original.byteLength

    console.log(
      `photograph 1500x2100: ${original.byteLength} bytes in, ${after} bytes out across ` +
        `${encoded.variants.length} widths (${(ratio * 100).toFixed(1)}%): ` +
        encoded.variants.map((v) => `${v.label} ${v.bytes.byteLength}`).join(', ')
    )

    /*
     * The number that decides what a guest downloads is one width, not the set:
     * a page draws one derivative and the rest exist so a small screen can draw
     * a smaller one. So this is the assertion that matters, and the total below
     * it is the storage bill rather than the transfer.
     */
    const phoneWidth = encoded.variants.find((variant) => variant.label === 'w960')
    expect(phoneWidth).toBeDefined()
    expect(phoneWidth!.bytes.byteLength).toBeLessThan(original.byteLength * 0.4)

    expect(after).toBeLessThan(original.byteLength * 0.5)
  })

  it('does the same to a file the size a phone actually produces', async () => {
    const original = await phonePhotographBytes()
    const encoded = await encodeUpload('image', original, UPLOAD_FORMATS.jpeg)

    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const after = total(encoded.variants)
    console.log(
      `phone photo 4032x3024: ${original.byteLength} bytes in, ${after} bytes out ` +
        `(${((after / original.byteLength) * 100).toFixed(1)}%)`
    )

    /*
     * This is the case the cost arithmetic is about: without re-encoding, one
     * of these on a page is more than the whole realistic per-load budget for
     * every image on it.
     */
    expect(original.byteLength).toBeGreaterThan(1_000_000)
    expect(after).toBeLessThan(original.byteLength * 0.2)
  })
})

describe('what comes out', () => {
  it('is WebP at the kind widths, largest last', async () => {
    const encoded = await encodeUpload('image', await widePhotographBytes(), UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(encoded.variants.map((variant) => variant.label)).toEqual(['w480', 'w960', 'w1600'])
    for (const variant of encoded.variants) {
      expect(variant.contentType).toBe('image/webp')
      expect(variant.key.endsWith('.webp')).toBe(true)
    }
  })

  it('gives the envelope its own two widths, from the same code path', async () => {
    const encoded = await encodeUpload('envelope', await widePhotographBytes(), UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(encoded.variants.map((variant) => variant.label)).toEqual(
      UPLOAD_KIND_SPECS.envelope.variants.map((variant) => variant.label)
    )
  })

  it('never enlarges, so a small image produces one derivative rather than three', async () => {
    const small = await imageBytes('png', 320, 240)
    const encoded = await encodeUpload('image', small, UPLOAD_FORMATS.png)

    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(encoded.variants).toHaveLength(1)
    expect(encoded.variants[0]!.width).toBe(320)
  })

  it('stops at the widths a source can actually fill', async () => {
    /*
     * The committed photograph is 1500 wide, so the 1600 width is not
     * generated: it would be the same pixels in a larger file. This is the
     * common case rather than an edge one, because most buyers upload
     * something narrower than the largest width the page can draw.
     */
    const encoded = await encodeUpload('image', photographBytes(), UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(encoded.variants.map((variant) => variant.label)).toEqual(['w480', 'w960'])
  })

  it('takes every format the kind accepts', async () => {
    for (const format of ['jpeg', 'png', 'webp', 'avif'] as const) {
      const encoded = await encodeUpload(
        'image',
        await imageBytes(format, 1000, 700),
        UPLOAD_FORMATS[format]
      )
      expect(encoded.ok, `${format} did not re-encode`).toBe(true)
    }
  })
})

describe('what it does to the pixels and the metadata', () => {
  it('applies the orientation flag rather than leaving a portrait photo sideways', async () => {
    const encoded = await encodeUpload('image', await rotatedPhotographBytes(), UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    /*
     * The source is 1200 by 900 with orientation 6, which means "turn this
     * upright". Applied, the displayed image is 900 by 1200: taller than it is
     * wide. Skipping the rotate leaves it landscape, which is the bug a guest
     * sees rather than a test.
     */
    const largest = encoded.variants.at(-1)!
    expect(largest.height!).toBeGreaterThan(largest.width!)
  })

  it('drops the metadata, which is a privacy decision as much as a size one', async () => {
    const encoded = await encodeUpload('image', await locatedPhotographBytes(), UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const metadata = await sharp(encoded.variants[0]!.bytes).metadata()
    // A phone photograph carries the coordinates of wherever it was taken, and
    // a wedding invitation is not a good place to publish somebody's address.
    expect(metadata.exif).toBeUndefined()
  })
})

describe('what it refuses', () => {
  it('refuses bytes that sniffed as an image and then will not decode', async () => {
    const truncated = photographBytes().slice(0, 200)
    const encoded = await encodeUpload('image', truncated, UPLOAD_FORMATS.jpeg)
    expect(encoded.ok).toBe(false)
  })

  it('never throws, because a bad file is a sentence to a buyer and not a 500', async () => {
    await expect(
      encodeUpload('image', new Uint8Array([1, 2, 3]), UPLOAD_FORMATS.jpeg)
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('audio', () => {
  it('is stored as it arrived, because v1 has no transcoding pipeline', async () => {
    const original = mp3Bytes()
    const encoded = await encodeUpload('audio', original, UPLOAD_FORMATS.mp3)

    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    expect(encoded.variants).toHaveLength(1)
    expect(encoded.variants[0]!.bytes).toEqual(original)
    expect(encoded.variants[0]!.contentType).toBe('audio/mpeg')
    // Still content addressed, so it still earns the immutable cache lifetime.
    expect(encoded.variants[0]!.key).toMatch(/^[a-f0-9]{24}-src\.mp3$/)
  })
})
