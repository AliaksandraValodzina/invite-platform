import 'server-only'

import { z } from 'zod'

import { serviceGet, servicePatch, servicePost, type ServiceResponse } from '@/lib/supabase/service'

import { normaliseActivationCode } from './code'
import { describeError, discardEvent, mintEvent } from './mint'

/**
 * Spending a claim link: an Etsy order becomes an event the buyer owns.
 *
 * The service role, because the buyer is not the code's owner and has no policy
 * that would let them see it. `20260819010700_activation_codes.sql` says so in
 * as many words: "Redemption itself is a service-role operation in an API
 * route. A buyer redeeming a code is not the code's owner and has no policy
 * that would let them see it, which is what stops `select * from
 * activation_codes` from being a way to collect other people's unredeemed
 * codes."
 *
 * Nothing here changes the schema, and nothing here needed to. A code was
 * already a bearer token; putting it in a URL is a decision about where the
 * string is carried.
 *
 * This is the PAID route and it is not the only one any more. The free launch
 * opened `/t/<templateId>/use`, which mints a copy for anybody who signs in
 * (./copy.ts). The two share `./mint.ts` and nothing else: what is in this file
 * is the code, the standing of a code, and the compare and set that spends one,
 * none of which the open link has or should ever grow. See docs/activation.md.
 *
 * ## The code is never hashed in TypeScript
 *
 * `public.hash_activation_code` is the only implementation of "what is this
 * code, normalised and hashed". The app asks the database rather than keeping a
 * second copy, because the two copies would disagree about some character
 * nobody thought about, and the symptom would be a buyer whose paid code is not
 * found. It costs one extra round trip on a path that runs once per purchase.
 *
 * ## Two clicks are one event
 *
 * A double tap on a phone sends two requests, and neither of them may show
 * somebody a spent-code error about the thing they just paid for. Three
 * mechanisms, in the order they fire:
 *
 *   1. The row is read first. A code that is already redeemed resolves to the
 *      event it created, and nothing is written at all. This is the common case:
 *      the second click a minute later, or a week later.
 *   2. The claim is a compare and set. `?id=eq.<id>&status=eq.issued` under
 *      `Prefer: return=representation` returns the row to exactly one caller,
 *      because Postgres re-evaluates the filter after taking the row lock. The
 *      loser gets an empty array rather than an error.
 *   3. The loser takes its own event back and resolves to the winner's. That is
 *      the only DELETE in this application, and it can only ever reach a row
 *      this request created seconds earlier and no reply can have reached.
 *
 * The event is created before the code is spent, and not the other way round,
 * because `activation_codes_redemption_is_complete` requires a redeemed row to
 * name its event. That ordering is what makes step 3 necessary and it is the
 * cheaper half of the trade: an event nobody can reach is recoverable, and a
 * code marked spent with no event is not.
 */

// Reading a code -------------------------------------------------------------

export type ActivationCode = {
  readonly id: string
  readonly status: 'issued' | 'redeemed' | 'revoked'
  readonly templateId: string
  readonly tier: string
  readonly hostingMonths: number
  readonly expiresAt: string | null
  readonly redeemedBy: string | null
  readonly redeemedEventId: string | null
}

const codeRowSchema = z.object({
  id: z.string(),
  status: z.enum(['issued', 'redeemed', 'revoked']),
  template_id: z.string(),
  tier: z.string(),
  hosting_months: z.number(),
  expires_at: z.string().nullable(),
  redeemed_by: z.string().nullable(),
  redeemed_event_id: z.string().nullable(),
})

const CODE_SELECT =
  'id,status,template_id,tier,hosting_months,expires_at,redeemed_by,redeemed_event_id'

export type CodeLookup =
  | { readonly kind: 'found'; readonly code: ActivationCode }
  /** No row with that hash. Also what a made-up link gets. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * The code behind a claim link, or why there is none.
 *
 * `revalidate: false` on both requests, and it is not a detail. A cached copy of
 * "this code is still unredeemed" is a copy that says a code can be spent twice.
 */
export async function findActivationCode(plaintext: string): Promise<CodeLookup> {
  const normalised = normaliseActivationCode(plaintext)
  if (normalised === '') return { kind: 'unknown' }

  let hashed: ServiceResponse
  try {
    hashed = await servicePost('rpc/hash_activation_code', { p_code: normalised })
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) }
  }

  if (!hashed.ok || typeof hashed.json !== 'string') {
    return { kind: 'unavailable', reason: `the database answered ${hashed.status}` }
  }

  let response: ServiceResponse
  try {
    response = await serviceGet(
      `activation_codes?${new URLSearchParams({
        code_hash: `eq.${hashed.json}`,
        select: CODE_SELECT,
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

  const parsed = codeRowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'the activation code row was not the shape expected' }
  }

  return { kind: 'found', code: readCode(parsed.data) }
}

function readCode(row: z.infer<typeof codeRowSchema>): ActivationCode {
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
 * What a code can still do, without a buyer in the picture.
 *
 * The claim page needs this before anybody has signed in, so that it can decide
 * whether asking for an email address is going to create an account. Only an
 * `open` code may, and that is the whole of the rule: holding an unspent code is
 * the authorisation to become a customer, which is why sign-in itself refuses to
 * (`should_create_user: false` in `src/lib/auth/session.ts`).
 */
export type CodeStanding = 'open' | 'spent' | 'revoked' | 'lapsed'

export function standingOf(code: ActivationCode, now: Date = new Date()): CodeStanding {
  if (code.status === 'revoked') return 'revoked'
  if (code.status === 'redeemed') return 'spent'
  if (code.expiresAt !== null && new Date(code.expiresAt).getTime() <= now.getTime()) {
    return 'lapsed'
  }
  return 'open'
}

// Spending a code ------------------------------------------------------------

export type ClaimResult =
  /** The event this request created. The buyer goes straight into its editor. */
  | { readonly kind: 'created'; readonly eventId: string }
  /**
   * The code was already spent. `mine` is the difference between "here is your
   * invitation" and "this link belongs to another account", and it is the only
   * thing this ever says about who else holds a code.
   */
  | { readonly kind: 'spent'; readonly eventId: string; readonly mine: boolean }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'lapsed' }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Spends a code for a signed-in buyer, or says why it could not be spent.
 *
 * `buyerId` is the subject of the buyer's own access token, read by
 * `currentBuyer`. It is used as `events.owner_id` and as
 * `activation_codes.redeemed_by`, and it is the only thing in this function
 * that decides whose invitation this becomes.
 */
export async function claimForBuyer(
  code: ActivationCode,
  buyerId: string,
  now: Date = new Date()
): Promise<ClaimResult> {
  const standing = standingOf(code, now)

  if (standing === 'revoked') return { kind: 'revoked' }
  if (standing === 'lapsed') return { kind: 'lapsed' }
  if (standing === 'spent') return alreadySpent(code, buyerId)

  /*
   * The event, its question set and its first content revision, minted by the
   * module the open copy link shares (./mint.ts). What stays here is what is
   * about the CODE: the compare and set below, and taking the event back when
   * this request turns out not to own it.
   */
  const event = await mintEvent(
    {
      ownerId: buyerId,
      templateId: code.templateId,
      tier: code.tier,
      hostingMonths: code.hostingMonths,
    },
    now
  )
  if (event.kind === 'failed') return { kind: 'unavailable', reason: event.reason }
  const created = event.eventId

  let claimed: ServiceResponse
  try {
    claimed = await servicePatch(
      `activation_codes?id=eq.${encodeURIComponent(code.id)}&status=eq.issued`,
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
   * this request does not own the code, so the event it made has to go back:
   * leaving it would give the buyer two invitations and one paid activation,
   * and the one they can reach would be the one nobody paid for.
   */
  await discardEvent(created)

  if (!claimed.ok) {
    return { kind: 'unavailable', reason: `the database answered ${claimed.status}` }
  }

  const reread = await rereadCode(code.id)
  if (reread === null) {
    return { kind: 'unavailable', reason: 'the activation code could not be read back' }
  }

  if (reread.status === 'redeemed') return alreadySpent(reread, buyerId)
  if (reread.status === 'revoked') return { kind: 'revoked' }
  return { kind: 'unavailable', reason: 'the activation code could not be claimed' }
}

function alreadySpent(code: ActivationCode, buyerId: string): ClaimResult {
  if (code.redeemedEventId === null) {
    // The constraint makes this unreachable; saying so beats rendering nothing.
    return { kind: 'unavailable', reason: 'the code is spent but names no invitation' }
  }
  return { kind: 'spent', eventId: code.redeemedEventId, mine: code.redeemedBy === buyerId }
}

async function rereadCode(id: string): Promise<ActivationCode | null> {
  let response: ServiceResponse
  try {
    response = await serviceGet(
      `activation_codes?${new URLSearchParams({
        id: `eq.${id}`,
        select: CODE_SELECT,
        limit: '1',
      }).toString()}`,
      { revalidate: false }
    )
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = codeRowSchema.safeParse(response.json[0])
  return parsed.success ? readCode(parsed.data) : null
}
