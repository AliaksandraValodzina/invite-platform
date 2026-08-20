import { NextResponse, type NextRequest } from 'next/server'

import {
  ACCESS_COOKIE,
  cookieOptions,
  REFRESH_COOKIE,
  shouldUseSecureCookies,
  verifyMagicLink,
} from '@/lib/auth/session'
import { readSiteConfig } from '@/lib/env'

/**
 * A relative Location, and it has to be relative.
 *
 * `NextResponse.redirect` needs an absolute URL, and the only absolute URL
 * available here is built from `request.url`, which Next normalises: a request
 * to `http://127.0.0.1:3000` comes back as `http://localhost:3000`. Those are
 * different origins to a cookie jar, so redirecting through one after setting
 * cookies on the other lands a signed-in browser on the sign-in page. Measured,
 * not guessed: it is what the browser suite caught the first time it ran.
 *
 * RFC 7231 has allowed a relative `Location` since 2014 and every browser
 * resolves it against the request, which is exactly the host the cookies were
 * set for.
 */
function seeOther(location: string, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store', ...headers },
  })
}

/**
 * Where a magic link lands.
 *
 * The link carries a one-use hash, this exchanges it for a session, and the
 * session goes into two HTTP-only cookies. It is a route handler and not a page
 * because setting a cookie is something only a route handler or a server action
 * may do, and because the answer is a redirect rather than a screen.
 *
 * The token comes in the query string, which means it is in the browser's
 * history and possibly in a proxy log. That is why it is one use and short
 * lived, and why this redirects immediately: the URL a buyer is left looking at
 * is `/dashboard`, not the one with the token in it.
 *
 * It also accepts `token`, because that is the parameter Supabase's default
 * magic link template sends when it has not been pointed here. Both names mean
 * the same hash.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { siteUrl } = readSiteConfig()
  const tokenHash =
    request.nextUrl.searchParams.get('token_hash') ?? request.nextUrl.searchParams.get('token')

  if (tokenHash === null || tokenHash === '') {
    return seeOther('/login?problem=link')
  }

  const verified = await verifyMagicLink(tokenHash)

  if (!verified.ok) {
    /*
     * Expired, already used, or from another deployment. All three are the same
     * thing to the person holding it, and the fix is the same: ask for another
     * one. The reason is not put in the URL, because it would be a message
     * about somebody's account posted to their browser history.
     */
    return seeOther('/login?problem=expired')
  }

  const response = seeOther('/dashboard')
  const secure = shouldUseSecureCookies(siteUrl)

  response.cookies.set(ACCESS_COOKIE, verified.tokens.accessToken, cookieOptions(secure))
  response.cookies.set(REFRESH_COOKIE, verified.tokens.refreshToken, cookieOptions(secure))

  return response
}
