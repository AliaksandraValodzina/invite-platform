import { NextResponse, type NextRequest } from 'next/server'

import { GUEST_PAGE_CACHE_CONTROL } from '@/lib/serving/cache'

/**
 * The one thing that sets the guest page's cache header.
 *
 * It is here rather than on the response Next builds because a header is a
 * property of the deployment, not of a component: Next writes its own
 * `Cache-Control` for a rendered page, and `next.config.ts` headers are
 * documented as being overwritten for pages in production. This runs on the way
 * out and is the last word, which is also what makes it worth a test that reads
 * the wire (tests/e2e/caching.spec.ts) rather than a test that reads this file.
 *
 * Why the header says what it says is in src/lib/serving/cache.ts. The short
 * version is that it bounds how long a guest can be shown the wrong serving
 * state, which is a privacy control rather than a speed one.
 *
 * It matches `/e/*` and nothing else. Everything else on this origin either
 * wants Next's own defaults or, in the case of `/_next/static`, already has the
 * immutable lifetime that a content addressed URL has earned.
 */

export const config = { matcher: '/e/:slug*' }

export function proxy(_request: NextRequest): NextResponse {
  const response = NextResponse.next()
  response.headers.set('Cache-Control', GUEST_PAGE_CACHE_CONTROL)
  return response
}
