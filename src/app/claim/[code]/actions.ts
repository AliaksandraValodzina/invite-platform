'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'

import { findActivationCode, standingOf } from '@/lib/activation/claim'
import { claimPath, isPossibleActivationCode } from '@/lib/activation/code'
import {
  CLAIM_COOKIE,
  CLAIM_COOKIE_MAX_AGE,
  callbackUrl,
  safeDestination,
} from '@/lib/auth/destination'
import { requestMagicLink, shouldUseSecureCookies } from '@/lib/auth/session'
import { readSiteConfig } from '@/lib/env'

/**
 * Signing in from a claim link.
 *
 * It is not the login form, and the difference is one option. `/login` asks the
 * auth API with `should_create_user: false`, because an address typed into a
 * form is not evidence of anything. This asks with it true, because the person
 * asking is holding an unspent activation code, and a paid activation is the
 * only authorisation this product recognises for becoming a customer.
 *
 * That is why the code is re-read here rather than trusted from the page that
 * rendered the form. A server action is a POST endpoint reachable directly, so
 * "the page said the code was good" is not a fact this can rely on. A code that
 * is spent, revoked or lapsed still gets a sign-in link, because the person
 * holding it may well have an account already and the answer they need is on
 * the other side of signing in. It just does not get an account created for it.
 *
 * The answer is the same either way, for the same reason `/login`'s is: whether
 * a given address has an account is not something a form should teach anybody.
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export type ClaimSignInState = {
  readonly status: 'idle' | 'sent' | 'invalid' | 'failed'
  readonly message?: string
}

export async function sendClaimSignInLink(
  code: string,
  _previous: ClaimSignInState,
  formData: FormData
): Promise<ClaimSignInState> {
  if (!isPossibleActivationCode(code)) {
    return { status: 'failed', message: 'That is not a claim link we recognise.' }
  }

  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    return { status: 'invalid', message: 'Please enter the email address you ordered with.' }
  }

  const lookup = await findActivationCode(code)
  if (lookup.kind === 'unavailable') {
    return {
      status: 'failed',
      message: 'We could not check that link just now. Please try again in a few minutes.',
    }
  }
  if (lookup.kind === 'unknown') {
    return { status: 'failed', message: 'That is not a claim link we recognise.' }
  }

  const mayCreateAccount = standingOf(lookup.code) === 'open'

  const destination = safeDestination(claimPath(code))
  const { siteUrl } = readSiteConfig()

  /*
   * The second carrier for the claim, and it is written BEFORE the send rather
   * than after it. `?next=` is inside the link and crosses devices; this is on
   * the device that asked and survives a mail provider rewriting the link.
   * Either one alone leaves a way to arrive signed in with nothing to show for
   * a purchase (src/lib/auth/destination.ts).
   *
   * Before, because it is a note about what this browser was in the middle of,
   * and that is true whether or not the mail went out. A buyer whose send
   * failed here and who then signs in through /login lands on their claim link
   * rather than on an empty dashboard, which is the whole point of holding it.
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
