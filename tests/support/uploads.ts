import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { APIRequestContext } from '@playwright/test'
import sharp from 'sharp'

/**
 * Driving the upload capability from a browser test.
 *
 * Everything here goes over HTTP, through the running app, as a signed-in
 * buyer. That is deliberate and it is the difference between this suite and the
 * unit tests: the limits are only worth something if they hold on the wire,
 * against a request that did not come from our own code.
 *
 * Putting an uploaded asset ONTO a page is not done here. There are two ways to
 * do that and both live elsewhere. A spec whose subject is the page seeds the
 * event with the asset already named, because `seedGuestEvent` takes content
 * for exactly that and a page that is right on its FIRST render is not racing
 * the guest page cache. A spec whose subject is the buyer doing it drives the
 * editor, which is `tests/e2e/editing.spec.ts`.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** A real photograph, 1500 by 2100, about 400 KB. */
export function photographBytes(): Buffer {
  return readFileSync(
    `${repoRoot}public/samples/unlicensed-placeholder/invitation-card-UNLICENSED-PLACEHOLDER.jpg`
  )
}

export type UploadedVariant = {
  label: string
  key: string
  url: string
  bytes: number
  width: number | null
}

export type UploadResponse = {
  status: number
  ok: boolean
  message?: string
  id?: string
  originalBytes?: number
  storedBytes?: number
  variants?: UploadedVariant[]
}

export async function upload(
  request: APIRequestContext,
  options: {
    eventId: string
    kind: string
    name: string
    mimeType: string
    bytes: Buffer
  }
): Promise<UploadResponse> {
  const response = await request.post('/api/uploads', {
    multipart: {
      kind: options.kind,
      eventId: options.eventId,
      file: { name: options.name, mimeType: options.mimeType, buffer: options.bytes },
    },
  })

  const body = (await response.json()) as Record<string, unknown>
  return { status: response.status(), ok: response.ok(), ...body } as UploadResponse
}

/** An SVG, which is refused because it is a document that can carry script. */
export function svgBytes(): Buffer {
  return Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>fetch("/steal")</script></svg>'
  )
}

/** An MP3: an ID3 tag and enough zeroes to be a file. */
export function mp3Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a]),
    Buffer.alloc(4096),
  ])
}

/**
 * A photograph whose DERIVATIVES nobody else in the suite produces.
 *
 * Appending bytes to a JPEG is not enough, and finding that out was worth the
 * trip: trailing data after the end-of-image marker changes the original's hash
 * and not one pixel, so the re-encoder produces byte-identical derivatives at
 * the same content addresses. That is the capability working exactly as
 * designed, and it means a test about REMOVING bytes has to own its pixels or
 * it is asking the sweep to delete an object another event is standing on.
 *
 * A different width is the cheapest way to differ in pixels while still being a
 * real photograph.
 */
export async function distinctPhotograph(width: number): Promise<Buffer> {
  return sharp(photographBytes()).resize({ width }).jpeg({ quality: 88 }).toBuffer()
}

/** Over the ten megabyte limit, and shaped like a real JPEG so sniffing is not what refuses it. */
export function oversizedJpegBytes(): Buffer {
  const photo = photographBytes()
  return Buffer.concat([photo, Buffer.alloc(10_000_001 - photo.byteLength)])
}
