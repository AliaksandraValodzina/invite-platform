'use server'

import type { RsvpSubmitResult } from '@/components/blocks'

/**
 * Where a reply will go, and where it does not go yet.
 *
 * The RSVP block takes `submit` as a required prop so that a form with nowhere
 * to send a reply cannot be rendered by accident. This is that prop for the
 * guest page, and it refuses, loudly, because stage 1 builds the read path and
 * stage 2 builds the reply path.
 *
 * It returns a failure rather than `{ ok: true }`. A form that says "thank you"
 * and stores nothing is the worst version of this: the guest believes they have
 * replied, the buyer sees no reply, and nothing anywhere is red. A refusal is
 * visible the first time anyone tries it, which is the point. The preview
 * route's stand in returns success on purpose, because it writes to nothing and
 * says so; a real event page is a different promise.
 *
 * When stage 2 lands, this calls the RSVP API route with the service role, and
 * nothing else about the block or the page moves.
 */
export async function submitRsvp(_formData: FormData): Promise<RsvpSubmitResult> {
  return {
    ok: false,
    message:
      'This invitation is not collecting replies yet. Nothing was sent. Please reply to whoever shared the link with you.',
  }
}
