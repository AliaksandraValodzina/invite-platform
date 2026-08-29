'use server'

import { redirect } from 'next/navigation'

import {
  isPossibleOrderNumber,
  normaliseOrderNumber,
  orderPath,
} from '@/lib/activation/order-number'
import { findOrderNumber } from '@/lib/activation/order'
import { noteOrderMiss, orderMissesExceeded } from '@/lib/activation/order-throttle'

/**
 * The one field between an Etsy purchase and an invitation.
 *
 * It looks a number up and, if it is on the captain's list, sends the browser
 * to `/order/<number>`, which is the page that actually redeems it. The split
 * is not decoration: that page has to be reachable by URL because it is where a
 * magic link lands, and a form that redeemed in place would have nowhere to
 * come back to after sign-in.
 *
 * Every refusal here is a sentence naming what to do next, which is the
 * standard everywhere in this project. A buyer who has just paid and is being
 * told "no" is the worst possible audience for a code.
 */

export type OrderFormState = {
  readonly status: 'idle' | 'invalid' | 'unknown' | 'throttled' | 'failed'
  readonly message?: string
  /** What they typed, so the field is not emptied under them by a refusal. */
  readonly typed?: string
}

const NOT_A_NUMBER =
  'That does not look like an order number. It is the Order ID Etsy shows on your receipt and in ' +
  'your purchases list, and it is digits only.'

const NOT_ON_THE_LIST =
  'We cannot find that order number. Check it against the Order ID on your Etsy receipt. If it is ' +
  'right, an order placed in the last few hours may not have reached us yet: reply to your Etsy ' +
  'order message and we will open your invitation for you.'

const TOO_MANY =
  'That is a lot of tries in a short time, so we have paused the check for a few minutes. Try ' +
  'again shortly, or reply to your Etsy order message and we will open your invitation for you.'

const NOT_ANSWERING =
  'We could not check that just now. Nothing has been used and nothing has been lost. Please try ' +
  'again in a few minutes.'

export async function findOrder(
  _previous: OrderFormState,
  formData: FormData
): Promise<OrderFormState> {
  const raw = formData.get('order')
  const typed = typeof raw === 'string' ? raw.trim() : ''

  if (!isPossibleOrderNumber(typed)) {
    return { status: 'invalid', message: NOT_A_NUMBER, typed }
  }

  /*
   * The guessing cap, read before the lookup and written to after a miss.
   * Misses rather than attempts, because enumeration is made of misses and a
   * shared address must not spend its budget on the buyers it exists to
   * protect. It fails open with no client address and with no database, because
   * a buyer who has paid must never be refused by the thing that counts guesses
   * (src/lib/activation/order-throttle.ts).
   */
  if ((await orderMissesExceeded()).kind === 'too-many') {
    return { status: 'throttled', message: TOO_MANY, typed }
  }

  const lookup = await findOrderNumber(typed)

  if (lookup.kind === 'unavailable') return { status: 'failed', message: NOT_ANSWERING, typed }
  if (lookup.kind === 'unknown') {
    await noteOrderMiss()
    return { status: 'unknown', message: NOT_ON_THE_LIST, typed }
  }

  /*
   * Nothing is redeemed here. This says only that the number is on the list,
   * and the page it sends them to decides everything else: whether they are
   * signed in, whether the number is spent, and whose invitation it opened.
   */
  redirect(orderPath(normaliseOrderNumber(typed)))
}
