import { NextResponse, type NextRequest } from 'next/server'

import { ACCESS_COOKIE, REFRESH_COOKIE, revokeSession } from '@/lib/auth/session'

/**
 * Signing out.
 *
 * POST only. A GET that ends a session can be triggered by an image tag on any
 * page on the internet, which is a nuisance rather than a breach, but it is a
 * nuisance with no upside.
 *
 * It does both halves: it tells the auth API to revoke the refresh token, and
 * it clears the cookies. Clearing only the cookies would leave a working
 * refresh token in whatever else has a copy, and revoking only at the API would
 * leave the browser asking with a dead one on every request.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value

  if (accessToken !== undefined && accessToken !== '') {
    await revokeSession(accessToken)
  }

  /*
   * A relative Location, for the same reason the callback uses one: an absolute
   * URL built from `request.url` can name a different host from the one the
   * cookies belong to, and clearing cookies on the wrong origin clears nothing.
   */
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: '/login', 'Cache-Control': 'private, no-store' },
  })
  response.cookies.delete(ACCESS_COOKIE)
  response.cookies.delete(REFRESH_COOKIE)
  return response
}
