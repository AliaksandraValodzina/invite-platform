/**
 * What an Etsy order number is made of, on both sides of the line.
 *
 * The captain loads a batch of them from their own Etsy dashboard; a buyer
 * types one at `/order`. Both need the same idea of what a number looks like,
 * so both import this. It has no imports of its own, which is what lets
 * `scripts/load-orders.ts` and `scripts/list-orders.ts` reach it by file name
 * without a build step, exactly as `./code.ts` does for the claim path.
 *
 * ## This is not a code, and the difference is the whole design
 *
 * An activation code is minted here: twenty characters of Crockford base32, a
 * hundred bits, guessable in exactly the way a password is. An order number is
 * a fact the buyer already has: about ten digits, printed on their receipt,
 * mailed to them by Etsy, and enumerable by anybody with a loop. It is evidence
 * of a purchase only because `public.order_numbers` says which purchases were
 * made.
 *
 * So the shape gate below is tolerant rather than strict. It exists to keep a
 * crawler walking `/order/<anything>` from becoming a query per request and to
 * word a refusal; it is not, and cannot be, a check that a number is real. What
 * stops guessing is the throttle (./order-throttle.ts), and what decides
 * entitlement is the list.
 */

/**
 * The normalised form: what the database hashes, and the only form worth
 * comparing two numbers in.
 *
 * The same rule as `public.hash_order_number`, and written twice on purpose for
 * the reason `normaliseActivationCode` gives: this copy decides whether a typed
 * string is worth a database round trip and how to word a refusal, and the
 * database's copy decides what a number IS.
 * `tests/unit/activation/order-schema-agreement.test.ts` holds the two together.
 */
export function normaliseOrderNumber(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/**
 * The shortest and longest thing this will send to the database.
 *
 * An Etsy order number is ten digits today. The range is wider than that on
 * purpose: a receipt id from a different era, or from whatever Etsy renames it
 * to next, must not be refused by a constant in this repo when it is sitting on
 * the captain's own list. Anything outside the range is a typo or a crawler.
 */
export const MIN_ORDER_NUMBER_LENGTH = 6
export const MAX_ORDER_NUMBER_LENGTH = 24

/** The four characters `order_numbers.number_suffix` keeps in the clear. */
export function orderNumberSuffix(value: string): string {
  return normaliseOrderNumber(value).slice(-4)
}

/**
 * Whether a string is shaped like an order number at all.
 *
 * A cheap gate in front of the database and nothing more. A number that passes
 * this is still almost certainly not on the list, which is the point: the list
 * is the only thing that says a purchase happened.
 */
export function isPossibleOrderNumber(value: string): boolean {
  const normalised = normaliseOrderNumber(value)
  if (normalised.length < MIN_ORDER_NUMBER_LENGTH || normalised.length > MAX_ORDER_NUMBER_LENGTH) {
    return false
  }
  return /^[A-Z0-9]+$/.test(normalised)
}

/** Where a buyer types their order number. One link, and it is public. */
export const ORDER_FORM_PATH = '/order'

/**
 * Where a typed number resolves to, as a path.
 *
 * A path and not a URL, because the product has no final host in this repo:
 * everything absolute is built from `NEXT_PUBLIC_SITE_URL` through
 * `readSiteConfig`, and `orderUrl` below is the only place the two are joined.
 *
 * It carries the number, which means it is a destination a magic link may be
 * sent to, so `safeDestination` in src/lib/auth/destination.ts holds a pattern
 * that must keep matching what this builds.
 * `tests/unit/auth/destination.test.ts` is where the two are held together.
 */
export function orderPath(number: string): string {
  return `${ORDER_FORM_PATH}/${normaliseOrderNumber(number)}`
}

/** The absolute link that goes in the Etsy listing and the order message. */
export function orderFormUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, '')}${ORDER_FORM_PATH}`
}

export function orderUrl(siteUrl: string, number: string): string {
  return `${siteUrl.replace(/\/$/, '')}${orderPath(number)}`
}

/** `••••7901`, which is as much of a number as a listing may print. */
export function maskedOrderNumber(suffix: string): string {
  return `••••${suffix}`
}
