import { describe, expect, it } from 'vitest'

import { sniff, UPLOAD_KIND_SPECS } from '@/lib/uploads'

import {
  bareMp3Bytes,
  gifBytes,
  heicBytes,
  htmlBytes,
  imageBytes,
  m4aBytes,
  mp3Bytes,
  svgBytes,
} from './fixtures'

/**
 * What a file is, decided from its own bytes.
 *
 * The assertions worth reading are the refusals. A sniffer that recognises the
 * six formats it should is easy; one that also refuses the shapes that arrive
 * dressed as those six is the point, because the answer here becomes the
 * `Content-Type` the asset route later hands a browser from the platform's own
 * hostname.
 */

describe('what the sniffer recognises', () => {
  it('reads each image format from its leading bytes', async () => {
    for (const format of ['jpeg', 'png', 'webp', 'avif'] as const) {
      const result = sniff(await imageBytes(format, 64, 64))
      expect(result.ok, `${format} was not recognised`).toBe(true)
      if (result.ok) expect(result.format.name).toBe(format)
    }
  })

  it('reads an MP3 whether or not it opens with an ID3 tag', () => {
    for (const bytes of [mp3Bytes(), bareMp3Bytes()]) {
      const result = sniff(bytes)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.format.contentType).toBe('audio/mpeg')
    }
  })

  it('reads an M4A from its container brand', () => {
    const result = sniff(m4aBytes())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.contentType).toBe('audio/mp4')
  })
})

describe('what it refuses', () => {
  it('refuses an SVG, and says why, because it is a document that can carry script', () => {
    const result = sniff(svgBytes())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/SVG/)
  })

  it('refuses HTML dressed as an upload', () => {
    expect(sniff(htmlBytes()).ok).toBe(false)
  })

  it('refuses a GIF and a HEIC with messages naming what they are', () => {
    const gif = sniff(gifBytes())
    expect(gif.ok).toBe(false)
    if (!gif.ok) expect(gif.reason).toMatch(/GIF/)

    const heic = sniff(heicBytes())
    expect(heic.ok).toBe(false)
    if (!heic.ok) expect(heic.reason).toMatch(/HEIC/)
  })

  it('refuses an empty file rather than reading past the end of it', () => {
    expect(sniff(new Uint8Array(0)).ok).toBe(false)
    expect(sniff(new Uint8Array([0xff])).ok).toBe(false)
  })
})

describe('the two absences that are easy to get backwards', () => {
  /*
   * An AVIF's compatible brand list routinely carries `mif1`, which is also how
   * a HEIC identifies itself. A refusal pass that ran before detection rejected
   * good AVIF files with a message about iPhones, which is the bug this test
   * was written for.
   */
  it('does not mistake an AVIF for a HEIC', async () => {
    const result = sniff(await imageBytes('avif', 64, 64))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.name).toBe('avif')
  })

  it('does not mistake a JPEG for an MPEG audio frame', async () => {
    // Both open with 0xFF. Only one of them is a photograph.
    const result = sniff(await imageBytes('jpeg', 64, 64))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.family).toBe('image')
  })
})

describe('the kinds and the formats agree', () => {
  it('accepts no audio format for a picture, and no picture format for the music', () => {
    expect(UPLOAD_KIND_SPECS.image.accepts).not.toContain('mp3')
    expect(UPLOAD_KIND_SPECS.envelope.accepts).not.toContain('m4a')
    expect(UPLOAD_KIND_SPECS.audio.accepts).toEqual(['mp3', 'm4a'])
  })

  it('offers no kind a format the sniffer cannot produce', () => {
    const known = ['jpeg', 'png', 'webp', 'avif', 'mp3', 'm4a']
    for (const spec of Object.values(UPLOAD_KIND_SPECS)) {
      for (const accepted of spec.accepts) {
        expect(known, `${spec.kind} accepts ${accepted}, which nothing can sniff`).toContain(
          accepted
        )
      }
    }
  })
})
