'use server'

import { headers } from 'next/headers'

import type { RsvpSubmitResult } from '@/components/blocks'
import { handleRsvpSubmission } from '@/lib/rsvp/handle'
import { fieldsFromFormData } from '@/lib/rsvp/submission'

/**
 * Where a reply goes.
 *
 * Stage 1 left a refusal here on purpose, so that a form with nowhere to send a
 * reply could not quietly say "thank you" and store nothing. This is the same
 * seam with the refusal replaced: it reads the form, and everything else
 * happens in `handleRsvpSubmission`, which `POST /api/e/[slug]/rsvp` also
 * calls. Neither door does anything the other does not.
 *
 * It takes the slug as its first argument and the page binds it, so the slug a
 * reply is stored against is the slug the page was rendered for and not a value
 * that travelled through a form a guest can edit.
 *
 * The headers go no further than the rate limit, which hashes the address and
 * holds it in memory for ten minutes. `20260819010600_rsvps.sql` is explicit
 * that no address, user agent or fingerprint is written down anywhere, and this
 * path keeps that true.
 */
export async function submitRsvp(slug: string, formData: FormData): Promise<RsvpSubmitResult> {
  const outcome = await handleRsvpSubmission({
    slug,
    fields: fieldsFromFormData(formData),
    headers: await headers(),
  })

  if (outcome.ok) return { ok: true }

  return {
    ok: false,
    message: outcome.message,
    ...(outcome.issues === undefined ? {} : { issues: outcome.issues }),
  }
}
