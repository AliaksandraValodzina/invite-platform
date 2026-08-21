/**
 * Re-encoding on ingest: cap what is stored and served, not what is offered.
 *
 * A photograph straight off a phone is three to eight megabytes of 4032 pixel
 * JPEG with the camera's metadata still attached. Refusing it is a support
 * ticket. Accepting it and putting the original on a guest page is the failure
 * the cost arithmetic in the plan is about: it is the difference between a
 * typical event moving 0.4 GB and moving 3 GB, and the guest paying for it is
 * on a phone on somebody else's wifi.
 *
 * So every image is decoded and written out again here, at the widths the page
 * actually draws, as WebP. What comes back is dramatically smaller than what
 * went in, and `tests/unit/uploads/encode.test.ts` asserts the ratio against
 * real photographic bytes rather than against a synthetic gradient, which
 * compresses like nothing a buyer will ever upload.
 *
 * Three details that are load bearing rather than incidental.
 *
 * **Orientation is applied, then metadata is dropped.** `rotate()` with no
 * argument bakes the EXIF orientation flag into the pixels; sharp then writes
 * no metadata at all unless asked. Doing it in the other order, or skipping the
 * rotate, is how a portrait photo arrives sideways on the page. Dropping the
 * rest of the metadata is a privacy decision as much as a size one: a phone
 * photo carries the GPS coordinates of wherever it was taken, and a wedding
 * invitation is not a good place to publish somebody's home address.
 *
 * **Nothing is ever enlarged.** A buyer who uploads a 600 pixel image gets one
 * 600 pixel derivative, not three, and the two larger widths are not generated.
 * Upscaling costs bytes to add blur.
 *
 * **WebP only, with no original-format fallback**, which is a deliberate
 * departure from the plan's section 5.1. The fallback was for browsers without
 * WebP; the last of those is Safari 13, which is iOS 13, which no phone opening
 * an invitation in 2026 is running. Generating it would spend a third of the
 * per event storage budget on files nobody requests. If a real device ever
 * turns up that needs one, it arrives as another entry in the kind's variant
 * plan and every existing address keeps working, because addresses are derived
 * from bytes rather than from a scheme.
 *
 * Audio is not transcoded. An ffmpeg pipeline is real work and buys little at
 * this size, so the bytes are stored as they arrived and the cap is what bounds
 * them.
 */

import sharp, { type Sharp } from 'sharp'

import { contentAddress } from './address'
import type { UploadFormat } from './formats'
import { UPLOAD_KIND_SPECS, type UploadKind } from './kinds'

/** Quality that holds up on a phone screen at 2x without visible artefacts. */
export const WEBP_QUALITY = 78

/**
 * The most pixels an image may decode to.
 *
 * A 40 megapixel photograph is a real camera; a 40,000 by 40,000 PNG that
 * compresses to 90 KB is a decompression bomb aimed at the function's memory.
 * sharp has a default limit of its own and this one is explicit so the number
 * is reviewable.
 */
export const MAX_INPUT_PIXELS = 80_000_000

export type EncodedVariant = {
  readonly label: string
  /** Content address of these exact bytes. */
  readonly key: string
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly width: number | null
  readonly height: number | null
}

export type EncodeOutcome =
  | {
      readonly ok: true
      /** Dimensions of what was uploaded, for the record and for a "before" number. */
      readonly sourceWidth: number | null
      readonly sourceHeight: number | null
      readonly variants: readonly EncodedVariant[]
    }
  | { readonly ok: false; readonly reason: string }

/**
 * Everything a guest will be served from one uploaded file.
 *
 * Never throws for a bad input. A file that sniffed as a JPEG and then will not
 * decode is a buyer's problem to be told about in a sentence, not a 500.
 */
export async function encodeUpload(
  kind: UploadKind,
  bytes: Uint8Array,
  format: UploadFormat
): Promise<EncodeOutcome> {
  const spec = UPLOAD_KIND_SPECS[kind]

  if (spec.encode === 'none') {
    const plan = spec.variants[0]!
    return {
      ok: true,
      sourceWidth: null,
      sourceHeight: null,
      variants: [
        {
          label: plan.label,
          key: contentAddress(bytes, { label: plan.label, extension: format.extension }),
          contentType: format.contentType,
          bytes,
          width: null,
          height: null,
        },
      ],
    }
  }

  let source: Sharp
  let width: number | undefined
  let height: number | undefined
  try {
    source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate()
    const metadata = await source.metadata()
    /*
     * After `rotate()`, sharp still reports the stored dimensions rather than
     * the displayed ones, so an image with an orientation flag of 6 or 8 has
     * its width and height the wrong way round here. Swapping them matters
     * because the width plan below is compared against it: without this, a
     * portrait photo off a phone is treated as landscape and the "do not
     * enlarge" check drops widths it should have kept.
     */
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5
    width = rotated ? metadata.height : metadata.width
    height = rotated ? metadata.width : metadata.height
  } catch {
    return {
      ok: false,
      reason: 'that image could not be read. It may be truncated or only partly uploaded.',
    }
  }

  const widths = plannedWidths(spec.variants, width)
  if (widths.length === 0) {
    return { ok: false, reason: 'that image has no width this can render.' }
  }

  const variants: EncodedVariant[] = []
  for (const plan of widths) {
    try {
      const output = await source
        .clone()
        .resize({ width: plan.width, withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true })

      const data = new Uint8Array(output.data)
      variants.push({
        label: plan.label,
        key: contentAddress(data, { label: plan.label, extension: 'webp' }),
        contentType: 'image/webp',
        bytes: data,
        width: output.info.width,
        height: output.info.height,
      })
    } catch {
      return { ok: false, reason: 'that image could not be re-encoded.' }
    }
  }

  return {
    ok: true,
    sourceWidth: width ?? null,
    sourceHeight: height ?? null,
    variants,
  }
}

/**
 * The widths worth generating for a source this wide.
 *
 * Every plan at or below the source width, plus the smallest one when the
 * source is narrower than all of them, so a small image still produces exactly
 * one derivative rather than none. Nothing is enlarged, so that one comes out
 * at the source's own width.
 */
function plannedWidths(
  plans: readonly { readonly label: string; readonly width?: number }[],
  sourceWidth: number | undefined
): { readonly label: string; readonly width: number }[] {
  const sized = plans.flatMap((plan) =>
    plan.width === undefined ? [] : [{ label: plan.label, width: plan.width }]
  )
  if (sourceWidth === undefined) return sized

  const fitting = sized.filter((plan) => plan.width <= sourceWidth)
  return fitting.length > 0 ? fitting : sized.slice(0, 1)
}
