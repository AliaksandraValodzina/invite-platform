/**
 * What an image upload becomes on a page.
 *
 * This is the join between the two halves of "a buyer can put their own picture
 * on their invitation". `POST /api/uploads` takes the bytes, re-encodes them
 * and hands back a set of stored variants; a picture field in the template
 * format is what a block draws. Neither half should know the other's shape, and
 * without something in the middle each caller would invent its own conversion
 * and they would disagree about which variant is the fallback.
 *
 * One function for every picture in the format, because the format has one
 * picture shape: `decorativePicture` and `contentPicture` in
 * src/lib/template/primitives.ts differ only by whether alt text comes with
 * them, and alt is the buyer's words rather than anything an upload knows. So
 * this returns `{ src, widths }` and a caller adds alt where the field has one.
 *
 * It lives under `uploads` rather than under `template` on purpose. The
 * template format is a document format and knows nothing about object stores,
 * content addressing or variant labels; uploads already knows all three. So the
 * dependency points this way, this module imports nothing from the format, and
 * `tests/unit/uploads/picture.test.ts` parses what it returns with
 * `envelopeConfigSchema` so the two cannot drift apart silently. That is the
 * same arrangement `kinds.ts` has with the migration that carries the same
 * numbers.
 *
 * It returns keys as `/a/<key>` and never a URL. A stored document outlives the
 * deployment that wrote it, so a hostname baked into one is a hostname that
 * becomes wrong; `resolveAssetSrc` applies the deployment's own at render time.
 * See the top of `./host.ts` for why that matters more than it looks.
 */

import { ASSET_PATH_PREFIX } from './address'

/**
 * A variant as the upload capability records it: `stored.variants` from
 * `ingestUpload`, and the `variants` array `POST /api/uploads` returns.
 *
 * Structural rather than imported so this module does not drag the ingest path,
 * and therefore sharp, into anything that only wants to name a picture.
 */
export type StoredVariant = {
  readonly key: string
  /** Null for a kind stored as it arrived, which is audio and never this one. */
  readonly width?: number | null
}

/** Exactly the shape a picture field in the template format holds, minus alt. */
export type PictureContent = {
  readonly src: string
  readonly widths?: readonly { readonly src: string; readonly width: number }[]
}

/**
 * The content for a buyer's uploaded picture, or null if there is nothing
 * renderable in what was passed.
 *
 * Null rather than a throw because the caller is a request path and the answer
 * "this upload has no width, so it is not a picture" is a refusal to write
 * content, not a crash. It is unreachable for a stored `envelope` upload, which
 * always has its two re-encoded widths, and reachable the moment somebody
 * hands this an audio variant.
 *
 * The smallest width becomes `src`, which is the one decision here worth
 * stating: `src` is what a browser too old to read `srcset` fetches, and that
 * browser is on the slowest phone in the room. Everything else is offered
 * through `widths` and the browser picks.
 */
export function pictureFromUpload(variants: readonly StoredVariant[]): PictureContent | null {
  const candidates = variants
    .flatMap((variant) =>
      typeof variant.width === 'number' && variant.width > 0
        ? [{ src: `${ASSET_PATH_PREFIX}${variant.key}`, width: variant.width }]
        : []
    )
    .sort((left, right) => left.width - right.width)

  const smallest = candidates[0]
  if (smallest === undefined) return null

  // One width needs no candidate list: a `srcset` offering the browser the file
  // it already has in `src` is bytes in the document that decide nothing.
  if (candidates.length === 1) return { src: smallest.src }

  return { src: smallest.src, widths: candidates }
}
