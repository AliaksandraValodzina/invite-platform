'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'

import { templateCopyPath } from '@/lib/activation/code'
import {
  CLAIM_COOKIE,
  CLAIM_COOKIE_MAX_AGE,
  callbackUrl,
  safeDestination,
} from '@/lib/auth/destination'
import { requestMagicLink, shouldUseSecureCookies } from '@/lib/auth/session'
import { readSiteConfig } from '@/lib/env'
import { findCopyableTemplate, isPossibleTemplateId } from '@/lib/supabase/templates'

/**
 * Signing in from the open copy link, which is the one place this product
 * creates an account for somebody who has bought nothing.
 *
 * `/login` asks the auth API with `should_create_user: false`, because an
 * address typed into a form is not evidence of anything. `/claim/<code>` asks
 * with it true, because the person asking holds a paid activation. This asks
 * with it true as well, and the authorisation is different again: a PUBLISHED
 * TEMPLATE, offered free, is the captain's decision of 2026-08-24 that anybody
 * may have one. That is a real widening of who may become a customer and it is
 * the half of this route that has to be taken back when the first paid listing
 * publishes, not just the copy button. See src/lib/activation/copy.ts.
 *
 * The template is re-read here rather than trusted from the page that rendered
 * the form, for the same reason the claim action re-reads its code: a server
 * action is a POST endpoint reachable directly, so "the page said so" is not a
 * fact this can rely on. A template nobody has published creates no account,
 * because then the id in the URL would be the only thing standing between a
 * stranger and an account and it is not a secret.
 *
 * The answer is the same either way, for the same reason `/login`'s is: whether
 * a given address has an account is not something a form should teach anybody.
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export type CopySignInState = {
  readonly status: 'idle' | 'sent' | 'invalid' | 'failed'
  readonly message?: string
}

export async function sendCopySignInLink(
  templateId: string,
  _previous: CopySignInState,
  formData: FormData
): Promise<CopySignInState> {
  if (!isPossibleTemplateId(templateId)) {
    return { status: 'failed', message: 'That is not an invitation design we recognise.' }
  }

  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    return { status: 'invalid', message: 'Please enter an email address you can open.' }
  }

  const template = await findCopyableTemplate(templateId)
  if (template.kind === 'unavailable') {
    return {
      status: 'failed',
      message: 'We could not reach the invitation just now. Please try again in a few minutes.',
    }
  }
  if (template.kind === 'not-found') {
    return { status: 'failed', message: 'That is not an invitation design we recognise.' }
  }

  const destination = safeDestination(templateCopyPath(templateId))
  const { siteUrl } = readSiteConfig()

  /*
   * The second carrier, written BEFORE the send for the reason the claim action
   * gives: it is a note about what this browser was in the middle of, and that
   * is true whether or not the mail went out. Losing it here does not cost a
   * purchase, it costs the person: somebody who arrives signed in at an empty
   * dashboard after pressing "make this mine" does not press it again.
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
      createUser: true,
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
