/**
 * Where a magic link lands, and how a claim survives the round trip through a
 * mailbox.
 *
 * This is the failure the whole activation flow is built around. A buyer clicks
 * the link in their Etsy delivery, is not signed in, asks for a sign-in link,
 * opens their mail, clicks it, and arrives back here holding a session and
 * nothing else. If the claim token was lost on the way, what they see is an
 * empty dashboard, and what that reads as is "I paid and received nothing".
 *
 * So the token is carried twice, by two mechanisms that fail differently:
 *
 *   `?next=` on the callback URL   travels inside the link, so it survives a
 *                                  buyer who asks on their laptop and opens the
 *                                  mail on their phone. It can be lost to a mail
 *                                  provider that rewrites links, and to a
 *                                  deployment whose auth redirect allow list
 *                                  does not include the query string.
 *   the `ip_claim` cookie          set on the device that asked, so it survives
 *                                  everything done to the URL. It cannot cross
 *                                  devices.
 *
 * Between them the only way to lose the claim is to change device AND have the
 * link rewritten. And even then nothing is spent: the claim link in the Etsy
 * message still works, because a code is only spent by a request that creates
 * an event.
 *
 * `?next=` wins when both are present, because it is the link the buyer
 * actually opened and the cookie may be from an older attempt.
 *
 * ## The allow list is the whole of the open redirect defence
 *
 * A `next` parameter is an open redirect unless something refuses to follow it
 * off the site, and "starts with a slash" is not that something: `//evil.test`
 * and `/\evil.test` both start with one and both leave. So this does not try to
 * decide whether an arbitrary string is safe. It matches against the two shapes
 * this product ever produces and rejects everything else, including anything
 * with a host, a scheme, a backslash or a second leading slash.
 */

/** Where a signed-in buyer goes when nothing else was asked for. */
export const DASHBOARD_DESTINATION = '/dashboard'

/** The query parameter the callback reads. */
export const NEXT_PARAM = 'next'

/** The cookie that carries a pending claim across the mailbox. */
export const CLAIM_COOKIE = 'ip_claim'

/**
 * Half an hour. Long enough to go and find a magic link in a mail app, short
 * enough that a shared computer is not still offering to claim somebody's
 * invitation tomorrow.
 */
export const CLAIM_COOKIE_MAX_AGE = 60 * 30

/**
 * The only destinations a magic link may be sent to.
 *
 * `/claim/<code>` is the one that matters. `/dashboard` is here so that the
 * fallback is expressible as a destination rather than as a special case.
 */
const ALLOWED_DESTINATIONS: readonly RegExp[] = [/^\/claim\/[A-Za-z0-9-]{1,80}$/, /^\/dashboard$/]

/** The destination if it is one this product produces, and null otherwise. */
export function safeDestination(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null
  return ALLOWED_DESTINATIONS.some((shape) => shape.test(value)) ? value : null
}

/**
 * The callback URL to hand the auth API, with the destination attached.
 *
 * Built from the site's own origin rather than from a request, because this
 * string is put in an email and a request's host is whatever the request said.
 * The product has no name yet, so the origin comes from `NEXT_PUBLIC_SITE_URL`
 * through `readSiteConfig` and never from a literal.
 */
export function callbackUrl(siteUrl: string, destination: string | null): string {
  const base = `${siteUrl.replace(/\/$/, '')}/auth/callback`
  const safe = safeDestination(destination)
  return safe === null ? base : `${base}?${NEXT_PARAM}=${encodeURIComponent(safe)}`
}

/**
 * Where to send a browser that has just been signed in.
 *
 * Takes both carriers and applies the rule above: the link wins, the cookie is
 * the fallback, and anything neither of them can justify is the dashboard.
 */
export function resolveDestination(
  fromLink: string | null | undefined,
  fromCookie: string | null | undefined
): string {
  return safeDestination(fromLink) ?? safeDestination(fromCookie) ?? DASHBOARD_DESTINATION
}
