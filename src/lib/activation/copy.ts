import 'server-only'

import { findCopyableTemplate } from '@/lib/supabase/templates'

import { mintEvent } from './mint'

/**
 * The open copy link: one link, anybody, their own invitation.
 *
 * The captain's decision of 2026-08-24, in their words: "LET'S MAKE one link
 * for all for now." It comes paired with the decision to release the first
 * template free, and the pairing is the whole argument. `docs/activation.md`
 * used to say an open "use this template" link was wrong here, and the reason
 * it gave was sound: here the invitation IS the purchase, so an open copy link
 * turns one sale into unlimited invitations. Free changes the arithmetic rather
 * than the reasoning. Nothing is being sold, so a free copy costs nothing.
 *
 * ## THIS ROUTE MUST NOT OUTLIVE THE FREE LAUNCH
 *
 * An open copy link plus a price is a free product. This must not still be the
 * active route when the first PAID listing publishes.
 *
 * `ip-decision-order-verification` was the decision that replaces it, and it is
 * now taken and built: the buyer types their Etsy order number at `/order` and
 * it is checked against the captain's own list (src/lib/activation/order.ts,
 * docs/orders.md). So what is left here is a WITHDRAWAL rather than a decision:
 * take this route out, and take the account creation in its sign-in action out
 * with it. `/claim/<code>` and `activation_codes` stay either way, as the route
 * the captain uses when an order has gone wrong.
 *
 * ## What holds the line while it is open
 *
 * One published invitation at a time per account, enforced in the database by
 * `public.events_publish_limit` (20260826010000_one_published_invitation.sql).
 * Copies and drafts are unlimited on purpose, and they are free: an invitation
 * costs hosting only once it is in front of guests. That limit is the only
 * thing between one free template and somebody running a wedding business on
 * this, so it is enforced where a route cannot skip it rather than here.
 */

/**
 * The hosting term a free copy is created with.
 *
 * The same twelve months `scripts/issue-codes.ts` defaults a paid code to,
 * because a free launch invitation is the same product with nothing charged for
 * it, and a shorter term would be a different promise that nobody has made. It
 * is a constant here rather than a column on `templates`: a per-template term is
 * a catalogue decision, and this route is temporary.
 */
export const FREE_COPY_HOSTING_MONTHS = 12

/**
 * `basic`, and not read from anywhere.
 *
 * `events.tier` records which listing an event came from, and a free copy came
 * from no listing at all. `basic` is the column's own default and the honest
 * answer; `premium` would say somebody bought something.
 */
export const FREE_COPY_TIER = 'basic'

export type CopyResult =
  /** The event this request created. The buyer goes straight into its editor. */
  | { readonly kind: 'copied'; readonly eventId: string }
  /** No such template, or one nobody has published. The preview 404s too. */
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Mints a signed-in visitor their own copy of a published template.
 *
 * `buyerId` is the subject of their own access token, read by `currentBuyer`,
 * and it is the only thing here that decides whose invitation this becomes.
 * There is no code to spend and nothing to mark used, which is the entire
 * difference between this and `claimForBuyer`: this is not idempotent and is
 * not meant to be. Pressing the link twice is two copies, because the captain's
 * decision says copies are unlimited and because two people planning two
 * weddings from one design is the product working.
 */
export async function copyTemplateForBuyer(
  templateId: string,
  buyerId: string,
  now: Date = new Date()
): Promise<CopyResult> {
  const template = await findCopyableTemplate(templateId)

  if (template.kind === 'not-found') return { kind: 'not-found' }
  if (template.kind === 'unavailable') {
    return { kind: 'unavailable', reason: template.reason }
  }

  const event = await mintEvent(
    {
      ownerId: buyerId,
      templateId: template.template.id,
      tier: FREE_COPY_TIER,
      hostingMonths: FREE_COPY_HOSTING_MONTHS,
    },
    now
  )

  if (event.kind === 'failed') return { kind: 'unavailable', reason: event.reason }
  return { kind: 'copied', eventId: event.eventId }
}
