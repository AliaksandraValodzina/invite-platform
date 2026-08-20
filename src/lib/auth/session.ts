/**
 * The buyer's session: a magic link out, two cookies back.
 *
 * There is no password anywhere in this product. A buyer arrives once from an
 * Etsy order, comes back three times over a year, and would reset a password
 * every single time. A link to the address that received the order is both the
 * thing they can always do and the thing an attacker cannot do without the
 * mailbox.
 *
 * What is stored, and why in these two cookies:
 *
 *   the access token   short lived, an hour by default. HTTP only, so no script
 *                      on the page can read it, which matters more here than
 *                      usual because this token can read guests' personal
 *                      information.
 *   the refresh token  longer lived, and the only thing that can mint a new
 *                      access token. Same protections, and it is the reason
 *                      signing out has to reach the auth API rather than only
 *                      clearing cookies.
 *
 * `sameSite: lax` rather than `strict`: the magic link arrives from a mail
 * client, which is a cross site navigation, and `strict` would drop the cookies
 * on exactly the request that just created them.
 *
 * Nothing here is `server-only`, because `src/proxy.ts` imports it and the proxy
 * is neither a server component nor a route handler. It reaches no database and
 * holds no service role key: the strongest thing it can do is exchange a
 * refresh token the browser already had.
 */

import { readAuthConfig } from './config'

export const ACCESS_COOKIE = 'ip_access'
export const REFRESH_COOKIE = 'ip_refresh'

/**
 * How early a token counts as expired.
 *
 * A token that expires while a request is in flight fails at the database
 * rather than here, and the failure looks like an empty dashboard rather than
 * an expired session. Thirty seconds is longer than any request this app makes.
 */
export const EXPIRY_SKEW_SECONDS = 30

export type SessionTokens = {
  readonly accessToken: string
  readonly refreshToken: string
  /** Seconds since the epoch, from the token itself. */
  readonly expiresAt: number
}

export type SessionUser = {
  readonly id: string
  readonly email: string | null
}

export type CookieOptions = {
  readonly httpOnly: true
  readonly sameSite: 'lax'
  readonly secure: boolean
  readonly path: '/'
  readonly maxAge: number
}

/** A year. The refresh token decides the real lifetime; this only bounds the jar. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: COOKIE_MAX_AGE }
}

/**
 * True when the cookies should be marked secure.
 *
 * Read from the site's own origin rather than from `NODE_ENV`, because the
 * thing that decides whether a cookie can be sent over http is the scheme the
 * app is served on, and a production build served over http locally would
 * silently drop every cookie.
 */
export function shouldUseSecureCookies(siteUrl: string): boolean {
  try {
    return new URL(siteUrl).protocol === 'https:'
  } catch {
    return false
  }
}

export type AuthCall =
  | { readonly ok: true; readonly tokens: SessionTokens; readonly user: SessionUser }
  | { readonly ok: false; readonly reason: string }

/**
 * Asks the auth API to send a magic link.
 *
 * `should_create_user: false` is the load bearing option. An account is created
 * when a code is redeemed, not when somebody types an address into a login
 * form, and without this an unknown address would silently become an account
 * with nothing in it. It also means the answer to "is this address a customer"
 * is the same either way, which is the answer a login form should give.
 */
export async function requestMagicLink(
  email: string,
  redirectTo: string
): Promise<{ readonly ok: boolean; readonly reason?: string }> {
  const config = readAuthConfig()

  const response = await fetch(`${config.url}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      should_create_user: false,
      email_redirect_to: redirectTo,
    }),
    cache: 'no-store',
  })

  if (response.ok) return { ok: true }

  return { ok: false, reason: `the sign-in service answered ${response.status}` }
}

/** Exchanges the hash in a magic link for a session. */
export async function verifyMagicLink(tokenHash: string): Promise<AuthCall> {
  return authCall('verify', { type: 'magiclink', token_hash: tokenHash })
}

/** Exchanges a refresh token for a new pair. */
export async function refreshSession(refreshToken: string): Promise<AuthCall> {
  return authCall('token?grant_type=refresh_token', { refresh_token: refreshToken })
}

/** Ends the session at the auth API, so the refresh token stops working. */
export async function revokeSession(accessToken: string): Promise<void> {
  const config = readAuthConfig()
  try {
    await fetch(`${config.url}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })
  } catch {
    /*
     * Signing out clears the cookies whatever happens here. A browser that
     * keeps a session because the auth API was unreachable is the worse of the
     * two failures, and the refresh token in a cleared cookie is a token
     * nobody holds.
     */
  }
}

async function authCall(path: string, body: unknown): Promise<AuthCall> {
  const config = readAuthConfig()

  let response: Response
  try {
    response = await fetch(`${config.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, reason: 'the sign-in service could not be reached' }
  }

  if (!response.ok) {
    return { ok: false, reason: `the sign-in service answered ${response.status}` }
  }

  return readSessionBody(await response.text())
}

/** Parses an auth response body into tokens and a user, or says why not. */
export function readSessionBody(text: string): AuthCall {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'the sign-in service sent something that was not a session' }
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'the sign-in service sent something that was not a session' }
  }

  const record = body as Record<string, unknown>
  const accessToken = record.access_token
  const refreshToken = record.refresh_token
  const user = record.user

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return { ok: false, reason: 'the sign-in service sent no tokens' }
  }

  const expiresAt = tokenExpiry(accessToken)
  if (expiresAt === null) {
    return { ok: false, reason: 'the access token carries no expiry' }
  }

  const id = typeof user === 'object' && user !== null ? (user as { id?: unknown }).id : undefined
  const email =
    typeof user === 'object' && user !== null ? (user as { email?: unknown }).email : undefined

  if (typeof id !== 'string') {
    return { ok: false, reason: 'the sign-in service named no user' }
  }

  return {
    ok: true,
    tokens: { accessToken, refreshToken, expiresAt },
    user: { id, email: typeof email === 'string' ? email : null },
  }
}

/**
 * The `exp` claim, read without verifying the signature, and that is on purpose.
 *
 * Nothing here trusts this number for a decision about access. It answers one
 * question, "is it worth sending this token", and the database is what actually
 * checks the signature on every request. Verifying it here would mean holding a
 * signing key in the app, which is a much larger thing to be careful with than
 * a timestamp that can only ever cost one wasted refresh.
 */
export function tokenExpiry(accessToken: string): number | null {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(
      Buffer.from((parts[1] as string).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
      )
    ) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

export function isExpired(expiresAt: number, nowMs: number = Date.now()): boolean {
  return expiresAt - EXPIRY_SKEW_SECONDS <= Math.floor(nowMs / 1000)
}

/**
 * The user id in an access token, or null.
 *
 * Same caveat as `tokenExpiry`, and it matters more here, so it is worth saying
 * twice: this is not an authorisation decision. What a request may read is
 * decided by row level security in the database, against a signature this app
 * never checks. This is only how a page knows whose name to put at the top.
 */
export function tokenSubject(accessToken: string): string | null {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(
      Buffer.from((parts[1] as string).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
      )
    ) as { sub?: unknown; email?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}
