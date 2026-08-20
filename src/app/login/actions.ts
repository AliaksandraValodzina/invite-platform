'use server'

import { z } from 'zod'

import { readSiteConfig } from '@/lib/env'
import { requestMagicLink } from '@/lib/auth/session'

/**
 * Asking for a sign-in link.
 *
 * The answer is the same whether or not the address is a customer, and that is
 * the decision this file is really about. A form that says "no account with
 * that email" is a form anybody can use to find out which of their guesses is a
 * buyer, and a buyer's email address is the one they gave Etsy. So the page
 * always says "if that address has an account, a link is on its way", and
 * `should_create_user: false` in the auth call is what makes that true without
 * quietly creating an account for a stranger.
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export type LoginState = {
  readonly status: 'idle' | 'sent' | 'invalid' | 'failed'
  readonly message?: string
}

export async function sendSignInLink(
  _previous: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get('email'))

  if (!parsed.success) {
    return { status: 'invalid', message: 'Please enter the email address you ordered with.' }
  }

  const { siteUrl } = readSiteConfig()

  try {
    const outcome = await requestMagicLink(parsed.data, `${siteUrl}/auth/callback`)
    if (!outcome.ok) {
      /*
       * A rate limit, a mail provider outage, or a misconfigured deployment.
       * None of them is the person's fault and none of them should read as "no
       * account", so this is its own state rather than folded into the answer
       * above.
       */
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
