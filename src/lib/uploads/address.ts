/**
 * Content addressing, and the cache lifetime it earns.
 *
 * These two decisions only work together, which is why they live in one file.
 *
 * **An object's key is derived from its own bytes.** Not from the upload's id,
 * not from the original's hash plus a suffix: each stored object, original and
 * derivative alike, is named by the sha256 of the exact bytes stored at that
 * address. Three things follow.
 *
 *   - A buyer who re-crops a photo gets different bytes, a different hash and a
 *     different URL. The old URL keeps serving whoever already holds it, which
 *     is what should happen during the seconds when a page has re-rendered but
 *     a guest's browser still holds the old HTML. Cache invalidation is not
 *     solved here, it is deleted as a problem.
 *   - Changing the re-encoder changes the derivative bytes, so it changes the
 *     addresses too. A quality setting can be tuned without a purge and without
 *     a single stale image anywhere.
 *   - Uploading the same file twice costs one object, which happens more often
 *     than it sounds because buyers re-upload after a failed save.
 *
 * **`Cache-Control: public, max-age=31536000, immutable`.** `max-age` alone is
 * not enough and the reason is the part usually missed: without `immutable` a
 * browser still issues a conditional revalidation on an explicit reload and
 * gets back a 304 with no body. The bytes are saved; the round trip is not. On
 * a phone on hotel wifi with 300ms of latency and 25 assets that is 25 round
 * trips of nothing, which is most of the page's perceived load time.
 * `immutable` tells the browser not to ask, and it is only safe to say because
 * of the paragraph above: the answer at a content address can never change, so
 * not asking can never be wrong.
 *
 * `tests/e2e/uploads.spec.ts` reads both off the wire, and reads
 * `transferSize === 0` off a reload, which is the browser confirming it did not
 * open a connection. A header being present is a claim; that is the evidence.
 */

import { createHash } from 'node:crypto'

/** Where assets live, on whichever hostname is serving them. */
export const ASSET_PATH_PREFIX = '/a/'

/** One year, in seconds, which is the longest any cache is allowed to be told. */
export const ASSET_MAX_AGE_SECONDS = 31_536_000

export const ASSET_CACHE_CONTROL = `public, max-age=${ASSET_MAX_AGE_SECONDS}, immutable`

/**
 * Hex characters of sha256 kept in a key.
 *
 * 24 hex characters is 96 bits. A birthday collision needs about 2^48 objects,
 * which is 280 trillion, against a product whose ceiling is tens of millions.
 * The plan's example used 12, which is 48 bits and reaches an even chance at
 * about 16 million objects: reachable inside this product's own lifetime, and
 * the failure mode is one buyer's photograph silently appearing on another
 * buyer's invitation. Twelve more characters is the cheapest insurance in this
 * repo.
 */
export const ADDRESS_LENGTH = 24

/** Matches `upload_objects_key_shape` in 20260821010300_uploads.sql. */
export const ASSET_KEY_PATTERN = new RegExp(
  `^[a-f0-9]{${ADDRESS_LENGTH}}(?:-[a-z0-9]+)?\\.[a-z0-9]{2,5}$`
)

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The key these exact bytes are stored at.
 *
 * The label is decoration for a human reading a network panel: it says which
 * derivative this is without anybody having to look it up. It is part of the
 * key rather than a query parameter because some caches ignore query strings,
 * and two objects that differ only in a query string are one object to them.
 */
export function contentAddress(
  bytes: Uint8Array,
  options: { readonly label?: string; readonly extension: string }
): string {
  const digest = sha256Hex(bytes).slice(0, ADDRESS_LENGTH)
  const label = options.label === undefined ? '' : `-${options.label}`
  return `${digest}${label}.${options.extension}`
}

export function isAssetKey(value: string): boolean {
  return ASSET_KEY_PATTERN.test(value)
}

/**
 * The ETag for an object at a content address.
 *
 * It is the key, because the key is the hash. A strong validator that is
 * literally the content's identity cannot go stale, and it costs nothing to
 * compute at serve time.
 */
export function assetETag(key: string): string {
  return `"${key}"`
}
