import 'server-only'

import { headers } from 'next/headers'

import { servicePost } from '@/lib/supabase/service'

/**
 * What stops an order number being found by a loop.
 *
 * This is the one hole the typed-number design has that the claim link does
 * not. A claim code is a hundred bits and nobody guesses one. An Etsy order
 * number is about ten digits, so the space around a real one is small enough to
 * walk, and every hit is a paid buyer's invitation taken before they arrive.
 * Hashing the column does nothing about it, because the form hashes whatever is
 * typed. Neither does refusing to say whether a number is known: the product
 * has to refuse an unknown number in a sentence naming what to do next, which
 * is an answer either way.
 *
 * So the defence is a cap on how many numbers one client may type and MISS in a
 * window, counted in the database (`public.note_order_number_miss`) rather than
 * in memory, because a serverless function's memory is not shared between the
 * two instances a loop would be spread across.
 *
 * ## Misses, not attempts
 *
 * Enumeration is made of misses: an attacker has to be wrong thousands of times
 * to be right once, and a number they do find is single use and worth exactly
 * one invitation. Counting every attempt instead would spend a shared address's
 * budget on the people this is there to protect, because a wedding venue, an
 * office and a mobile carrier all put many buyers behind one address.
 *
 * ## It fails open, deliberately
 *
 * Three ways, and they are the same decision: a buyer who has paid must not be
 * refused their template by the thing that counts guesses.
 *
 *   - No client address means no throttle.
 *   - A LOOPBACK address means no throttle, because it is the machine the
 *     server is running on rather than anybody's client. A deployment behind a
 *     proxy that forwards `127.0.0.1` has a misconfigured proxy, and every
 *     visitor sharing one bucket would be worse than no bucket at all. It is
 *     also what keeps the browser suite deterministic on a local stack.
 *   - A database that will not answer means no throttle. The lookup right after
 *     it is going to fail anyway, and it will say so in the sentence written
 *     for that.
 *
 * What the cap is worth is bounded and worth saying out loud: it costs an
 * attacker a proxy pool, not a rethink. It is not the reason the design is
 * acceptable. The reason is that a number only opens the ONE invitation that
 * was bought against it, once, and the captain can see which numbers were
 * claimed and when (`scripts/list-orders.ts`).
 */

/**
 * Thirty misses in fifteen minutes.
 *
 * A buyer who has mistyped their number and gone to look at their receipt is
 * nowhere near it, and neither is a household or a small office where several
 * people are opening invitations behind one address. A loop is past it in under
 * a second, and at this rate a single address cannot walk enough of the space
 * around a real order number to matter.
 */
export const ORDER_MISS_LIMIT = 30
export const ORDER_MISS_WINDOW_SECONDS = 900

/** Addresses that identify the server rather than a client. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

/** Whether an address says anything about who is asking. Pure, so it is tested. */
export function isCountableClient(address: string | null): boolean {
  if (address === null) return false
  const trimmed = address.trim().toLowerCase()
  return trimmed !== '' && !LOOPBACK.has(trimmed)
}

/**
 * The client this request came from, or null when nothing usable was sent.
 *
 * `x-forwarded-for` is a list appended to by every proxy, so the FIRST entry is
 * the one the edge saw and the rest are whatever the client sent. Taking the
 * last would let anybody choose their own bucket by sending the header.
 */
export async function clientAddress(): Promise<string | null> {
  const jar = await headers()

  const forwarded = jar.get('x-forwarded-for')
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim()
    if (isCountableClient(first ?? null)) return first as string
  }

  const real = jar.get('x-real-ip')
  return isCountableClient(real) ? (real as string).trim() : null
}

export type ThrottleVerdict =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'too-many' }
  /** No usable address, or no database. Either way the lookup goes ahead. */
  | { readonly kind: 'not-counted' }

/** Whether this client has already missed too often to be asked again. */
export async function orderMissesExceeded(): Promise<ThrottleVerdict> {
  const client = await clientAddress()
  if (client === null) return { kind: 'not-counted' }

  try {
    const counted = await servicePost('rpc/order_number_misses', {
      p_client: client,
      p_window_seconds: ORDER_MISS_WINDOW_SECONDS,
    })

    if (!counted.ok || typeof counted.json !== 'number') return { kind: 'not-counted' }
    return counted.json >= ORDER_MISS_LIMIT ? { kind: 'too-many' } : { kind: 'allowed' }
  } catch {
    return { kind: 'not-counted' }
  }
}

/**
 * Records that this client typed a number that is not on the list.
 *
 * Failure is swallowed: the caller is already on its way to telling somebody
 * their order was not found, and an exception here would replace that sentence
 * with a stack trace.
 */
export async function noteOrderMiss(): Promise<void> {
  const client = await clientAddress()
  if (client === null) return

  try {
    await servicePost('rpc/note_order_number_miss', {
      p_client: client,
      p_window_seconds: ORDER_MISS_WINDOW_SECONDS,
    })
  } catch {
    /* see above */
  }
}
