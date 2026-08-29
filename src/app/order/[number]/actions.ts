'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'

import { findOrderNumber, standingOfOrder } from '@/lib/activation/order'
import { isPossibleOrderNumber, orderPath } from '@/lib/activation/order-number'
import {
  CLAIM_COOKIE,
  CLAIM_COOKIE_MAX_AGE,
  callbackUrl,
  safeDestination,
} from '@/lib/auth/destination'
import { requestMagicLink, shouldUseSecureCookies } from '@/lib/auth/session'
import { readSiteConfig } from '@/lib/env'

/**
 * Signing in from a recognised order number.
 *
 * This is the third place in the product that may CREATE an account, and the
 * three authorisations are worth keeping distinct:
 *
 *   `/login`         never. An address typed into a form is not evidence of
 *                    anything, so it asks with `should_create_user: false`.
 *   `/claim/<code>`  an unspent activation code, which this platform minted and
 *                    delivered against a paid order.
 *   `/t/<id>/use`    a published template offered free. The free launch's, and
 *                    the half of that route that also has to be taken back.
 *   `/order/<number>` this: a purchase on the captain's own list, which is
 *                    exactly what the paid route needed and did not have.
 *
 * The number is re-read here rather than trusted from the page that rendered
 * the form, for the reason the claim action gives: a server action is a POST
 * endpoint reachable directly, so "the page said the number was good" is not a
 * fact this can rely on. A number that is used, revoked or lapsed still gets a
 * sign-in link, because the person holding it may well have an account already
 * and the answer they need is on the other side of signing in. It just does not
 * get an account created for it.
 *
 * The answer is the same either way, for the same reason `/login`'s is: whether
 * a given address has an account is not something a form should teach anybody.
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export type OrderSignInState = {
  readonly status: 'idle' | 'sent' | 'invalid' | 'failed'
  readonly message?: string
}

export async function sendOrderSignInLink(
  number: string,
  _previous: OrderSignInState,
  formData: FormData
): Promise<OrderSignInState> {
  if (!isPossibleOrderNumber(number)) {
    return { status: 'failed', message: 'That is not an order number we recognise.' }
  }

  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    return { status: 'invalid', message: 'Please enter the email address you ordered with.' }
  }

  const lookup = await findOrderNumber(number)
  if (lookup.kind === 'unavailable') {
    return {
      status: 'failed',
      message: 'We could not check that order just now. Please try again in a few minutes.',
    }
  }
  if (lookup.kind === 'unknown') {
    return { status: 'failed', message: 'That is not an order number we recognise.' }
  }

  const mayCreateAccount = standingOfOrder(lookup.order) === 'open'

  const destination = safeDestination(orderPath(number))
  const { siteUrl } = readSiteConfig()

  /*
   * The second carrier, written BEFORE the send for the reason the claim action
   * gives: it is a note about what this browser was in the middle of, and that
   * is true whether or not the mail went out. Losing it costs a purchase, which
   * to the buyer reads as having paid and received nothing
   * (src/lib/auth/destination.ts).
   */
  if (destination !== null) {
    const jar = await cookies()
    jar.set(CLAIM_COOKIE, destination, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureCookies(siteUrl),
      path: '/',
      maxAge: CLAIM_COOKIE_MAX_AGE,
    })
  }

  try {
    const outcome = await requestMagicLink(parsed.data, callbackUrl(siteUrl, destination), {
      createUser: mayCreateAccount,
    })
    if (!outcome.ok) {
      return {
        status: 'failed',
        message: 'The sign-in service is not answering. Please try again in a few minutes.',
      }
    }
  } catch {
    return {
      status: 'failed',
      message: 'The sign-in service is not answering. Please try again in a few minutes.',
    }
  }

  return { status: 'sent' }
}
