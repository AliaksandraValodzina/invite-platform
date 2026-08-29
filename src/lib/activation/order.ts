import 'server-only'

import { z } from 'zod'

import { serviceGet, servicePatch, servicePost, type ServiceResponse } from '@/lib/supabase/service'

import { describeError, discardEvent, mintEvent } from './mint'
import { normaliseOrderNumber } from './order-number'

/**
 * Redeeming a typed Etsy order number: a purchase becomes an event the buyer owns.
 *
 * The captain's decision, taken twice: one public link, the buyer types the
 * number from their receipt. Checking that number against Etsy live needs Open
 * API v3 approval which this shop does not have, so it is checked against the
 * list in `public.order_numbers`, loaded from the captain's own dashboard in
 * batches (`scripts/load-orders.ts`). A number that is not on the list is
 * refused. See docs/orders.md.
 *
 * The service role, for the same reason ./claim.ts uses it: the buyer is not
 * the seller who listed the order and has no policy that would let them see the
 * row. That is what stops a signed-in visitor reading which numbers are still
 * unclaimed.
 *
 * ## This is the fourth activation link, and it is not the other three
 *
 * `/t/<id>` renders a template and creates nothing. `/t/<id>/use` mints
 * anybody's copy and belongs to the free launch. `/claim/<code>` spends a code
 * this platform minted. `/order` is the paid self-serve route: the buyer proves
 * a purchase with a fact they already have. It shares `./mint.ts` with the
 * other two that create something, and nothing else.
 *
 * ## The number is never hashed in TypeScript
 *
 * `public.hash_order_number` is the only implementation of "what is this number,
 * normalised and hashed". The app asks the database rather than keeping a second
 * copy, because two copies would eventually disagree about some character
 * nobody thought about and the symptom would be a paid buyer told their order
 * does not exist. ./claim.ts says the same about codes for the same reason.
 *
 * ## Two taps are one invitation
 *
 * Identical to a claim, and it has to be: a buyer who double-taps on a phone
 * sends two requests and neither may show them a used-number refusal about the
 * thing they just bought. The row is read first, the redemption is a compare
 * and set, and the loser takes its own event back. ./claim.ts documents all
 * three at length; this is the same three against a different table.
 *
 * What is NOT idempotent is a second person. A number typed by an account that
 * did not redeem it is refused, and that refusal is the whole reason the list
 * is single use: the first buyer to post their order number publicly would
 * otherwise give the template away.
 */

// Reading a number -----------------------------------------------------------

export type OrderNumber = {
  readonly id: string
  readonly status: 'issued' | 'redeemed' | 'revoked'
  readonly templateId: string
  readonly tier: string
  readonly hostingMonths: number
  readonly expiresAt: string | null
  readonly redeemedBy: string | null
  readonly redeemedEventId: string | null
}

const orderRowSchema = z.object({
  id: z.string(),
  status: z.enum(['issued', 'redeemed', 'revoked']),
  template_id: z.string(),
  tier: z.string(),
  hosting_months: z.number(),
  expires_at: z.string().nullable(),
  redeemed_by: z.string().nullable(),
  redeemed_event_id: z.string().nullable(),
})

const ORDER_SELECT =
  'id,status,template_id,tier,hosting_months,expires_at,redeemed_by,redeemed_event_id'

export type OrderLookup =
  | { readonly kind: 'found'; readonly order: OrderNumber }
  /** Not on the list. What a typo gets, and what a guess gets. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * The row behind a typed number, or why there is none.
 *
 * `revalidate: false` on both requests, and it is not a detail. A cached copy
 * of "this number is still unclaimed" is a copy that says one purchase can open
 * two invitations.
 */
export async function findOrderNumber(typed: string): Promise<OrderLookup> {
  const normalised = normaliseOrderNumber(typed)
  if (normalised === '') return { kind: 'unknown' }

  let hashed: ServiceResponse
  try {
    hashed = await servicePost('rpc/hash_order_number', { p_number: normalised })
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) }
  }

  if (!hashed.ok || typeof hashed.json !== 'string') {
    return { kind: 'unavailable', reason: `the database answered ${hashed.status}` }
  }

  let response: ServiceResponse
  try {
    response = await serviceGet(
      `order_numbers?${new URLSearchParams({
        number_hash: `eq.${hashed.json}`,
        select: ORDER_SELECT,
        limit: '1',
      }).toString()}`,
      { revalidate: false }
    )
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) }
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }
  if (!Array.isArray(response.json) || response.json.length === 0) return { kind: 'unknown' }

  const parsed = orderRowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'the order number row was not the shape expected' }
  }

  return { kind: 'found', order: readOrder(parsed.data) }
}

function readOrder(row: z.infer<typeof orderRowSchema>): OrderNumber {
  return {
    id: row.id,
    status: row.status,
    templateId: row.template_id,
    tier: row.tier,
    hostingMonths: row.hosting_months,
    expiresAt: row.expires_at,
    redeemedBy: row.redeemed_by,
    redeemedEventId: row.redeemed_event_id,
  }
}

/**
 * What a number can still do, without a buyer in the picture.
 *
 * The order page needs this before anybody has signed in, so it can decide
 * whether asking for an email address is going to create an account. Only an
 * `open` number may, and that is the whole of the rule: a purchase on the
 * captain's list is the authorisation to become a customer, which is why
 * sign-in itself refuses to (`should_create_user: false` in
 * `src/lib/auth/session.ts`).
 */
export type OrderStanding = 'open' | 'spent' | 'revoked' | 'lapsed'

export function standingOfOrder(order: OrderNumber, now: Date = new Date()): OrderStanding {
  if (order.status === 'revoked') return 'revoked'
  if (order.status === 'redeemed') return 'spent'
  if (order.expiresAt !== null && new Date(order.expiresAt).getTime() <= now.getTime()) {
    return 'lapsed'
  }
  return 'open'
}

// Redeeming a number ---------------------------------------------------------

export type OrderClaimResult =
  /** The event this request created. The buyer goes straight into its editor. */
  | { readonly kind: 'created'; readonly eventId: string }
  /**
   * The number has already been used. `mine` is the difference between "here is
   * your invitation" and "that order number belongs to another account", and it
   * is the only thing this ever says about who else typed it.
   */
  | { readonly kind: 'spent'; readonly eventId: string; readonly mine: boolean }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'lapsed' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Redeems a listed order number for a signed-in buyer, or says why it could not.
 *
 * `buyerId` is the subject of the buyer's own access token, read by
 * `currentBuyer`. It becomes `events.owner_id` and `order_numbers.redeemed_by`,
 * and it is the only thing here that decides whose invitation this is.
 */
export async function redeemOrderForBuyer(
  order: OrderNumber,
  buyerId: string,
  now: Date = new Date()
): Promise<OrderClaimResult> {
  const standing = standingOfOrder(order, now)

  if (standing === 'revoked') return { kind: 'revoked' }
  if (standing === 'lapsed') return { kind: 'lapsed' }
  if (standing === 'spent') return alreadyUsed(order, buyerId)

  const event = await mintEvent(
    {
      ownerId: buyerId,
      templateId: order.templateId,
      tier: order.tier,
      hostingMonths: order.hostingMonths,
    },
    now
  )
  if (event.kind === 'failed') return { kind: 'unavailable', reason: event.reason }
  const created = event.eventId

  let claimed: ServiceResponse
  try {
    claimed = await servicePatch(
      `order_numbers?id=eq.${encodeURIComponent(order.id)}&status=eq.issued`,
      {
        status: 'redeemed',
        redeemed_by: buyerId,
        redeemed_at: now.toISOString(),
        redeemed_event_id: created,
      },
      { prefer: 'return=representation' }
    )
  } catch (error) {
    await discardEvent(created)
    return { kind: 'unavailable', reason: describeError(error) }
  }

  if (claimed.ok && Array.isArray(claimed.json) && claimed.json.length === 1) {
    return { kind: 'created', eventId: created }
  }

  /*
   * Either another request won the race, or the write was refused. Both mean
   * this request does not own the number, so the event it made has to go back:
   * leaving it would give somebody two invitations and one purchase, and the
   * one they can reach would be the one nobody paid for.
   */
  await discardEvent(created)

  if (!claimed.ok) {
    return { kind: 'unavailable', reason: `the database answered ${claimed.status}` }
  }

  const reread = await rereadOrder(order.id)
  if (reread === null) {
    return { kind: 'unavailable', reason: 'the order number could not be read back' }
  }

  if (reread.status === 'redeemed') return alreadyUsed(reread, buyerId)
  if (reread.status === 'revoked') return { kind: 'revoked' }
  return { kind: 'unavailable', reason: 'the order number could not be redeemed' }
}

function alreadyUsed(order: OrderNumber, buyerId: string): OrderClaimResult {
  if (order.redeemedEventId === null) {
    // The constraint makes this unreachable; saying so beats rendering nothing.
    return { kind: 'unavailable', reason: 'the number is used but names no invitation' }
  }
  return { kind: 'spent', eventId: order.redeemedEventId, mine: order.redeemedBy === buyerId }
}

async function rereadOrder(id: string): Promise<OrderNumber | null> {
  let response: ServiceResponse
  try {
    response = await serviceGet(
      `order_numbers?${new URLSearchParams({
        id: `eq.${id}`,
        select: ORDER_SELECT,
        limit: '1',
      }).toString()}`,
      { revalidate: false }
    )
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = orderRowSchema.safeParse(response.json[0])
  return parsed.success ? readOrder(parsed.data) : null
}
