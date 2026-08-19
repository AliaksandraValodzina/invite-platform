'use server'

import type { RsvpSubmitResult } from '@/components/blocks'

/**
 * The preview's stand in for the RSVP endpoint.
 *
 * It writes nothing. Phase 0.4 has no API route and no service role client, and
 * an RSVP insert goes through an API route with the service role, never from a
 * component. What this exists to do is satisfy the block's required `submit`
 * prop, which is required precisely so that a form with nowhere to send a reply
 * cannot be rendered by accident.
 *
 * Phase 0.5 replaces it with the real call. Nothing else about the block moves
 * when it does.
 */
export async function previewRsvpSubmit(_formData: FormData): Promise<RsvpSubmitResult> {
  return { ok: true }
}
