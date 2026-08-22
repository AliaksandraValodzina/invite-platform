'use server'

import type { RsvpSubmitResult } from '@/components/blocks'

/**
 * The reply form on a template preview, which refuses.
 *
 * The form is rendered rather than hidden, because it is a large part of what
 * the template is: an Etsy listing showing a still picture of an invitation is
 * showing half the product. But a preview belongs to nobody, has no event to
 * store a reply against, and must create nothing, so pressing send says so.
 *
 * Refusing beats the two alternatives. Accepting silently would tell somebody
 * their reply had been sent when no such reply exists, which for a wedding is
 * the worst lie this product could tell. Rendering the block's `closedMessage`
 * instead would put "Replies have closed" on a marketing page, which is a
 * different untruth and a worse advertisement.
 */
export async function templatePreviewRsvpSubmit(_formData: FormData): Promise<RsvpSubmitResult> {
  return {
    ok: false,
    message:
      'This is a preview of a template, so there is nobody to send a reply to. Nothing was saved.',
  }
}
