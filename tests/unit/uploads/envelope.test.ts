/**
 * The join between an uploaded envelope and the page that draws it.
 *
 * `envelopeImageFromUpload` is the one place that knows both shapes, so this is
 * where the two halves are held together. The assertion that earns this file is
 * the third describe: what the producer returns is parsed by the format's own
 * `envelopeConfigSchema`. Without it the two could drift apart, each half would
 * still pass its own tests, and the failure would show up as a buyer's envelope
 * silently rejected on a guest page.
 */

import { describe, expect, it } from 'vitest'

import { envelopeConfigSchema } from '@/lib/template'
import { UPLOAD_KIND_SPECS, envelopeImageFromUpload, isAssetKey } from '@/lib/uploads'

/** Keys shaped the way `contentAddress` makes them: 24 hex, a label, an extension. */
const SMALL = { key: 'aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp', width: 800 }
const LARGE = { key: 'bbbbbbbbbbbbbbbbbbbbbbbb-w1600.webp', width: 1600 }

describe('what an envelope upload becomes', () => {
  const content = envelopeImageFromUpload([LARGE, SMALL])

  it('names every stored width, so nothing is stored and never served', () => {
    expect(content?.widths).toEqual([
      { src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp', width: 800 },
      { src: '/a/bbbbbbbbbbbbbbbbbbbbbbbb-w1600.webp', width: 1600 },
    ])
  })

  it('falls back to the smallest, which is what an old phone fetches', () => {
    // Not the largest. A browser that ignores srcset is the browser least able
    // to afford 1600px, so the wrong choice here costs the slowest device most.
    expect(content?.src).toBe('/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp')
  })

  it('names keys and never a hostname, so the vendor stays swappable by DNS', () => {
    const named = [content?.src, ...(content?.widths ?? []).map((width) => width.src)]
    for (const src of named) {
      expect(src?.startsWith('/a/')).toBe(true)
      expect(isAssetKey(src?.slice('/a/'.length) ?? '')).toBe(true)
    }
  })

  it('offers no candidate list when there is only one file to offer', () => {
    expect(envelopeImageFromUpload([SMALL])).toEqual({
      src: '/a/aaaaaaaaaaaaaaaaaaaaaaaa-w800.webp',
    })
  })

  it('refuses rather than throws when nothing in it has a width', () => {
    // Reachable the moment somebody hands this the audio kind, whose one
    // variant is stored as it arrived and has no width at all.
    expect(envelopeImageFromUpload([{ key: 'cccccccccccccccccccccccc.mp3', width: null }])).toBe(
      null
    )
    expect(envelopeImageFromUpload([])).toBe(null)
  })
})

describe('the widths the capability actually produces', () => {
  /*
   * Read off the kind spec rather than written here, so adding a third envelope
   * width to `kinds.ts` fails this file until the content shape can carry it.
   * The format caps `widths` at four; the spec is the thing that decides how
   * many there are.
   */
  const planned = UPLOAD_KIND_SPECS.envelope.variants

  it('all fit in one content document', () => {
    const content = envelopeImageFromUpload(
      planned.map((variant, index) => ({
        key: `${'0'.repeat(23)}${index}-${variant.label}.webp`,
        width: variant.width ?? null,
      }))
    )

    expect(content?.widths).toHaveLength(planned.length)
    expect(envelopeConfigSchema.safeParse({ image: content }).success).toBe(true)
  })
})

describe('the format accepts it', () => {
  it('parses as the envelope image the cover draws', () => {
    const parsed = envelopeConfigSchema.safeParse({
      image: envelopeImageFromUpload([LARGE, SMALL]),
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.image?.widths?.[1]?.width).toBe(1600)
  })

  it('still parses in its one width form', () => {
    expect(
      envelopeConfigSchema.safeParse({ image: envelopeImageFromUpload([LARGE]) }).success
    ).toBe(true)
  })
})
