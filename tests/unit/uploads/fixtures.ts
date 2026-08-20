import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/**
 * Bytes to upload at things.
 *
 * The images are generated rather than committed, so the suite carries no
 * binary fixtures and a format is exercised as the encoder actually writes it.
 * The one exception is the photograph, which is a file already in this
 * repository: the before-and-after byte counts are only worth reading against
 * real photographic content, because a synthetic gradient compresses like
 * nothing a buyer will ever upload.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * A real photograph, 1500 by 2100, 408 KB of JPEG.
 *
 * It is the unlicensed placeholder that ships under `public/samples/`, used
 * here as a test input and nowhere near a rendered page. Its README is explicit
 * that it must not ship in a template; reading its bytes to prove a re-encoder
 * works is not shipping it.
 */
export function photographBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(
      `${repoRoot}public/samples/unlicensed-placeholder/invitation-card-UNLICENSED-PLACEHOLDER.jpg`
    )
  )
}

/** A plausible photograph off a phone: 4032 wide, and heavier than the caps expect. */
export async function phonePhotographBytes(): Promise<Uint8Array> {
  const output = await sharp(photographBytes())
    .resize({ width: 4032, height: 3024, fit: 'cover' })
    .jpeg({ quality: 92, mozjpeg: false })
    .toBuffer()
  return new Uint8Array(output)
}

/** The same photograph, wide enough that every planned width is generated. */
export async function widePhotographBytes(): Promise<Uint8Array> {
  const output = await sharp(photographBytes()).resize({ width: 2400 }).jpeg().toBuffer()
  return new Uint8Array(output)
}

export async function imageBytes(
  format: 'jpeg' | 'png' | 'webp' | 'avif',
  width = 1200,
  height = 800
): Promise<Uint8Array> {
  const canvas = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } },
  })

  const output =
    format === 'jpeg'
      ? await canvas.jpeg().toBuffer()
      : format === 'png'
        ? await canvas.png().toBuffer()
        : format === 'webp'
          ? await canvas.webp().toBuffer()
          : await canvas.avif().toBuffer()

  return new Uint8Array(output)
}

/**
 * An image with an EXIF orientation flag of 6, which is what a phone held
 * upright writes: the pixels are landscape and the viewer is told to turn them.
 */
export async function rotatedPhotographBytes(): Promise<Uint8Array> {
  const output = await sharp(photographBytes())
    .resize({ width: 1200, height: 900, fit: 'cover' })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  return new Uint8Array(output)
}

/** An image carrying the GPS tags a phone attaches. */
export async function locatedPhotographBytes(): Promise<Uint8Array> {
  const output = await sharp(photographBytes())
    .resize({ width: 900 })
    /*
     * sharp's typings expose IFD0, IFD1, IFD2 and IFD3 rather than a named GPS
     * block, and IFD3 is where a GPS directory lands. What matters for the
     * assertion is only that the output carries an EXIF block at all, and that
     * the encoder drops it.
     */
    .withExif({ IFD0: { Copyright: 'somebody else' }, IFD3: { GPSLatitudeRef: 'S' } })
    .jpeg()
    .toBuffer()
  return new Uint8Array(output)
}

/** An MP3: an ID3v2 tag, then a frame header. */
export function mp3Bytes(): Uint8Array {
  const tag = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a]
  return new Uint8Array([...tag, ...new Array(1024).fill(0)])
}

/** An MP3 with no tag, opening straight on a frame sync. */
export function bareMp3Bytes(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(1024).fill(0)])
}

/** An M4A: an ISO base media box with the audio brand. */
export function m4aBytes(): Uint8Array {
  return new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x20,
    ...ascii('ftyp'),
    ...ascii('M4A '),
    0x00,
    0x00,
    0x02,
    0x00,
    ...ascii('isom'),
    ...ascii('iso2'),
    ...new Array(512).fill(0),
  ])
}

/** A HEIC, as an iPhone writes one. */
export function heicBytes(): Uint8Array {
  return new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    ...ascii('ftyp'),
    ...ascii('heic'),
    0x00,
    0x00,
    0x00,
    0x00,
    ...ascii('mif1'),
    ...new Array(256).fill(0),
  ])
}

export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>fetch("/steal")</script></svg>'
  )
}

export function gifBytes(): Uint8Array {
  return new Uint8Array([...ascii('GIF89a'), ...new Array(64).fill(0)])
}

export function htmlBytes(): Uint8Array {
  return new TextEncoder().encode('<!doctype html><script>alert(1)</script>')
}

function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0))
}
