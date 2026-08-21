import { NextResponse, type NextRequest } from 'next/server'

import { ASSET_CACHE_CONTROL, assetETag, isAssetKey } from '@/lib/uploads'
import { objectStore } from '@/lib/uploads/store'

/**
 * GET /a/<content address>
 *
 * The asset host, when the platform is its own asset host.
 *
 * In a deployment with R2 behind a hostname the platform owns, a guest never
 * reaches this: `NEXT_PUBLIC_ASSET_HOST` names that hostname, the CDN answers,
 * and a cache hit never touches an origin at all. This route is what serves the
 * same bytes with the same headers when no such hostname is configured, which
 * is every local run, every preview and CI.
 *
 * That is deliberately a real serving path rather than a development stub. The
 * caching requirement is the one whose failure mode is silent: wrong headers
 * bypass both caches, nothing errors, and the page renders correctly every
 * single time while every guest re-downloads everything. The only way to catch
 * that is a test that reads the wire, and a test can only read a wire that
 * exists. `tests/e2e/uploads.spec.ts` reads this one, on a production build,
 * and then reloads and asserts `transferSize === 0`, which is the browser
 * confirming it did not open a connection.
 *
 * `immutable` is safe here and nowhere else in this app, and the reason is one
 * sentence: the key is the sha256 of the bytes at it, so the answer can never
 * change and not asking can never be wrong.
 */

/*
 * Never prerendered and never held in Next's own caches: the bytes come from an
 * object store this process does not own. The long lifetime is a header on the
 * response, which is the layer that actually matters, and it is set below.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string[] }> }
): Promise<NextResponse | Response> {
  const { key: segments } = await context.params
  const key = segments.join('/')

  /*
   * Checked before the store is asked, because a key is the last segment of a
   * URL a stranger controls. The store checks it again at the point it becomes
   * a path; this one is here so a malformed request costs nothing.
   */
  if (!isAssetKey(key)) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  const etag = assetETag(key)

  /*
   * The conditional answer, before the bytes are fetched.
   *
   * With `immutable` a browser should never ask, but a CDN revalidating a cold
   * edge will, and so will a client that ignores the directive. Answering 304
   * from the key alone is correct precisely because the key is the content: if
   * the caller's validator matches, they hold these bytes, and no read of the
   * store can change that.
   */
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': ASSET_CACHE_CONTROL },
    })
  }

  let object
  try {
    object = await objectStore().get(key)
  } catch {
    return new NextResponse(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  /*
   * A 404 here is also what a takedown looks like from the outside. Disabling
   * an asset removes the bytes, because an immutable cache lifetime means there
   * is no header and no purge that can un-serve an address somebody already
   * holds. So this response is not cached: the absence is the one thing about
   * an asset that can change.
   */
  if (object === null) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  return new NextResponse(new Uint8Array(object.bytes) as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.bytes.byteLength),
      'Cache-Control': ASSET_CACHE_CONTROL,
      ETag: etag,
      /*
       * The store decided this type by sniffing the bytes, never by trusting
       * what the uploader claimed. `nosniff` is what stops a browser second
       * guessing that decision and rendering an image as something executable.
       */
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
