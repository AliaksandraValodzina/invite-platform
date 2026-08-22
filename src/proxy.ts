import { NextResponse, type NextRequest } from 'next/server'

import {
  ACCESS_COOKIE,
  cookieOptions,
  isExpired,
  refreshSession,
  REFRESH_COOKIE,
  shouldUseSecureCookies,
  tokenExpiry,
} from '@/lib/auth/session'
import { readSiteConfig } from '@/lib/env'
import {
  DASHBOARD_CACHE_CONTROL,
  GUEST_PAGE_CACHE_CONTROL,
  TEMPLATE_PREVIEW_CACHE_CONTROL,
} from '@/lib/serving/cache'

/**
 * The one thing that sets a cache header, and the one thing that keeps a
 * buyer's session fresh. Two jobs, and they are here together for the same
 * reason: this is the only code that runs before a page and can still change
 * the response.
 *
 * **Cache headers.** They are here rather than on the response Next builds
 * because a header is a property of the deployment, not of a component: Next
 * writes its own `Cache-Control` for a rendered page, and `next.config.ts`
 * headers are documented as being overwritten for pages in production. This
 * runs on the way out and is the last word, which is also what makes it worth a
 * test that reads the wire (tests/e2e/caching.spec.ts) rather than a test that
 * reads this file.
 *
 * Why each header says what it says is in src/lib/serving/cache.ts. The short
 * version for `/e/*` is that it bounds how long a guest can be shown the wrong
 * serving state, which is a privacy control rather than a speed one. The short
 * version for `/dashboard/*` is that the page is a list of other people's names
 * and dietary requirements and must never be held by anything between the
 * database and the buyer's screen.
 *
 * **The session.** An access token lasts an hour and a buyer checks their
 * replies for months, so most dashboard and claim visits arrive with an expired
 * one. The
 * exchange has to happen somewhere that can write a cookie, and a server
 * component cannot: Next only allows `cookies().set` in a route handler or a
 * server action. Doing it here costs one request to the auth API on the visits
 * where the token has actually expired, and nothing on the rest.
 *
 * The refreshed token is written onto the REQUEST as well as the response, so
 * the page rendered downstream reads the new one rather than the expired one it
 * arrived with. Without that the first visit after an hour renders signed out
 * and the second renders signed in, which is the kind of bug that gets
 * explained as "just refresh".
 */

export const config = {
  matcher: ['/e/:slug*', '/dashboard/:path*', '/claim/:path*', '/t/:path*'],
}

/**
 * `/claim/*` gets the same treatment as `/dashboard/*`, for both of its jobs.
 *
 * The session, because a buyer who claimed one invitation in March and clicks a
 * second link in September arrives with an hour-old access token and a valid
 * refresh token. Without the exchange here they would be treated as signed out
 * and asked for their email again, which on a paid link reads as the purchase
 * not being recognised.
 *
 * The header, because a claim URL carries a bearer token in its path and its
 * response says whether that token is still worth anything. Neither belongs in
 * a shared cache, and `private, no-store` is the same sentence the dashboard
 * needs for a different reason.
 */
const SESSION_PATHS = ['/dashboard', '/claim']

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname

  if (SESSION_PATHS.some((prefix) => path.startsWith(prefix))) {
    return signedIn(request)
  }

  const response = NextResponse.next()
  /*
   * `/t/*` is a template preview: a design and its example words, belonging to
   * nobody and meant to spread. It is written out here rather than left to
   * Next's own header for one reason, which is that Next's default stale window
   * on a route like this is nearly a year. See TEMPLATE_PREVIEW_CACHE_CONTROL.
   */
  const isTemplatePreview = path === '/t' || path.startsWith('/t/')
  response.headers.set(
    'Cache-Control',
    isTemplatePreview ? TEMPLATE_PREVIEW_CACHE_CONTROL : GUEST_PAGE_CACHE_CONTROL
  )
  return response
}

async function signedIn(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value

  const expiry = accessToken === undefined ? null : tokenExpiry(accessToken)
  const usable = expiry !== null && !isExpired(expiry)

  if (usable) {
    const response = NextResponse.next()
    response.headers.set('Cache-Control', DASHBOARD_CACHE_CONTROL)
    return response
  }

  /*
   * Nothing to exchange: either there was never a session, or the access token
   * has expired and the refresh token is gone. Either way the cookies that
   * remain cannot buy anything, and leaving an expired one in place would give
   * the page below a session it can read a subject out of and nothing else. It
   * would render a signed-in shell over an empty dashboard, which reads as
   * "your replies are gone" rather than as "sign in again".
   */
  if (refreshToken === undefined) {
    return signedOut(request)
  }

  const refreshed = await refreshSession(refreshToken)
  const secure = shouldUseSecureCookies(readSiteConfig().siteUrl)

  if (!refreshed.ok) {
    // The refresh token is spent, revoked or from another deployment.
    return signedOut(request)
  }

  request.cookies.set(ACCESS_COOKIE, refreshed.tokens.accessToken)
  request.cookies.set(REFRESH_COOKIE, refreshed.tokens.refreshToken)

  const response = NextResponse.next({ request: { headers: request.headers } })
  response.headers.set('Cache-Control', DASHBOARD_CACHE_CONTROL)
  response.cookies.set(ACCESS_COOKIE, refreshed.tokens.accessToken, cookieOptions(secure))
  response.cookies.set(REFRESH_COOKIE, refreshed.tokens.refreshToken, cookieOptions(secure))
  return response
}

/**
 * Renders the request as signed out, and tells the browser to forget.
 *
 * Both halves are needed and they happen at different times.
 * `response.cookies.delete` is the browser's copy, which is next time. Rewriting
 * the request's own cookie header is THIS time: without it the page below reads
 * the dead token it arrived with and renders a signed-in shell over nothing,
 * which is a worse answer than the sign-in page.
 */
function signedOut(request: NextRequest): NextResponse {
  const jar = request.cookies
  jar.delete(ACCESS_COOKIE)
  jar.delete(REFRESH_COOKIE)

  const headers = new Headers(request.headers)
  headers.set(
    'cookie',
    jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
  )

  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Cache-Control', DASHBOARD_CACHE_CONTROL)
  response.cookies.delete(ACCESS_COOKIE)
  response.cookies.delete(REFRESH_COOKIE)
  return response
}
