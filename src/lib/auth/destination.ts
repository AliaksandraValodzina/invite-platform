/**
 * Where a magic link lands, and how a claim survives the round trip through a
 * mailbox.
 *
 * This is the failure the whole activation flow is built around. Somebody opens
 * a link that is going to give them an invitation, is not signed in, asks for a
 * sign-in link, opens their mail, clicks it, and arrives back holding a session
 * and nothing else. If the destination was lost on the way, what they see is an
 * empty dashboard. On a claim link that reads as "I paid and received nothing";
 * on the open copy link it reads as the product not working, and losing
 * somebody at the sign-in step is losing them entirely.
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
 * Between them the only way to lose the destination is to change device AND have
 * the link rewritten. And even then nothing is spent: the claim link in the
 * Etsy message still works, because a code is only spent by a request that
 * creates an event, and the copy link is public and can simply be opened
 * again.
 *
 * `?next=` wins when both are present, because it is the link the buyer
 * actually opened and the cookie may be from an older attempt.
 *
 * ## The allow list is the whole of the open redirect defence
 *
 * A `next` parameter is an open redirect unless something refuses to follow it
 * off the site, and "starts with a slash" is not that something: `//evil.test`
 * and `/\evil.test` both start with one and both leave. So this does not try to
 * decide whether an arbitrary string is safe. It matches against the three shapes
 * this product ever produces and rejects everything else, including anything
 * with a host, a scheme, a backslash or a second leading slash.
 */

/** Where a signed-in buyer goes when nothing else was asked for. */
export const DASHBOARD_DESTINATION = '/dashboard'

/** The query parameter the callback reads. */
export const NEXT_PARAM = 'next'

/**
 * The cookie that carries a pending claim, or a pending copy, across the
 * mailbox.
 *
 * One cookie for both, because it holds a destination rather than a token: it
 * is a note about what this browser was in the middle of, and a browser is only
 * ever in the middle of one thing. Its name is left as it was so that a cookie
 * set before this deploy still resolves after it.
 */
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
 * Two of them are the point of this file, and they are the two ways somebody
 * gets an invitation of their own:
 *
 *   `/claim/<code>`         a paid activation, delivered in an Etsy order
 *                           message and spent once
 *   `/t/<templateId>/use`   the free launch's open copy link, which anybody may
 *                           hold (src/lib/activation/copy.ts)
 *   `/order/<number>`       a paid purchase proved by the order number the buyer
 *                           typed (src/lib/activation/order.ts)
 *
 * Losing one across the mailbox is the same failure with different costs. On
 * the paid links somebody arrives signed in having paid and received nothing.
 * On the free link they arrive signed in at an empty dashboard having pressed
 * "make this mine" on an invitation they can no longer see, which is losing
 * them entirely: nobody presses it a second time.
 *
 * `/dashboard` is here so that the fallback is expressible as a destination
 * rather than as a special case.
 *
 * The order shape is built by `orderPath` in src/lib/activation/order-number.ts,
 * which normalises to uppercase letters and digits and refuses anything outside
 * MIN_ORDER_NUMBER_LENGTH..MAX_ORDER_NUMBER_LENGTH. This pattern says the same
 * thing, and tests/unit/auth/destination.test.ts holds the two together.
 */
const ALLOWED_DESTINATIONS: readonly RegExp[] = [
  /^\/claim\/[A-Za-z0-9-]{1,80}$/,
  /^\/t\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/use$/i,
  /^\/order\/[A-Z0-9]{6,24}$/,
  /^\/dashboard$/,
]

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

  /*
   * The query string is always present, even when there is no destination, and
   * that is load bearing rather than tidy.
   *
   * This URL is handed to the auth API as `redirect_to`, and the email template
   * builds the link the buyer actually clicks by appending the one-use token to
   * it: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}`. A template cannot ask
   * whether the URL it was given already has a query string, so if this
   * sometimes returned a bare path the link would come out as
   * `/auth/callback&token_hash=...` and the callback would find no token. What
   * the buyer sees then is the sign-in page telling them their link did not
   * work, one tap after paying.
   *
   * An empty `next` is not a destination: `safeDestination` rejects the empty
   * string, so `resolveDestination` falls through to the claim cookie exactly
   * as it does when the parameter is absent. See docs/hosting.md for the
   * template this pairs with.
   */
  return `${base}?${NEXT_PARAM}=${safe === null ? '' : encodeURIComponent(safe)}`
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
