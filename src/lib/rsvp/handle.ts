import 'server-only'

import { loadRsvpTarget, storeRsvp } from '@/lib/supabase/rsvp'
import { resolveEventPage } from '@/lib/template'

import { RSVP_MAX_PARTY_SIZE } from './questions'
import { callerAddress, checkRateLimit, rateLimitKey } from './rate-limit'
import { parseRsvpSubmission, type SubmissionIssue, type SubmittedField } from './submission'

/**
 * One reply, from the wire to a row. Both doors into the write path call this
 * and neither of them does anything else.
 *
 * There are two doors on purpose. `POST /api/e/[slug]/rsvp` is the contract the
 * plan names and the one a client that is not this app would use. The server
 * action on the guest page is what the form actually calls, because the form is
 * a client component in this app and routing it through a second HTTP hop to
 * our own origin would buy nothing. Putting the rate limit, the honeypot, the
 * validation and the write here rather than in either door is what stops the
 * two from being two different levels of careful.
 *
 * The order of the checks is deliberate:
 *
 *   1. The rate limit, before the database is touched at all.
 *   2. The event, read fresh, so a page cached for up to a minute cannot store
 *      a reply against hosting that lapsed in that minute.
 *   3. The honeypot, before any validation message could tell a script which
 *      of its fields was wrong.
 *   4. Validation, with field-scoped messages.
 *   5. The write, in one transaction, which checks the serving state again.
 */

export type RsvpFailure = {
  readonly ok: false
  readonly message: string
  /** Messages against the fields they belong to, so the form can place them. */
  readonly issues?: readonly SubmissionIssue[]
}

export type RsvpOutcome = { readonly ok: true } | RsvpFailure

const CLOSED =
  'Replies have closed for this invitation. Please contact whoever shared the link with you.'
const MISSING = 'This invitation could not be found. Please check the link you were sent.'
const BROKEN = 'That did not send. Nothing was stored. Please try again in a moment.'
const TOO_MANY = 'That is a lot of replies from one place. Please try again shortly.'
const NOTHING_TO_ASK =
  'This invitation is not collecting replies at the moment. Please contact whoever invited you.'

export type HandleInput = {
  readonly slug: string
  readonly fields: readonly SubmittedField[]
  /** Request headers, for the rate limit and nothing else. Never stored. */
  readonly headers: Headers
}

export async function handleRsvpSubmission(input: HandleInput): Promise<RsvpOutcome> {
  const address = callerAddress(input.headers)
  if (address !== null) {
    const decision = checkRateLimit(rateLimitKey(address, input.slug), Date.now())
    if (!decision.allowed) return { ok: false, message: TOO_MANY }
  }

  const target = await loadRsvpTarget(input.slug)

  if (target.kind === 'not-found') return { ok: false, message: MISSING }
  if (target.kind === 'unavailable') return { ok: false, message: BROKEN }

  /*
   * Grace keeps a link that is already in a group chat working. It does not
   * keep collecting personal information against hosting somebody stopped
   * paying for, which `20260819010600_rsvps.sql` says is not defensible. The
   * database refuses this too; refusing here as well is what turns it into a
   * sentence a guest can read.
   */
  if (target.target.state !== 'live') return { ok: false, message: CLOSED }

  if (target.target.questions.length === 0) {
    return { ok: false, message: NOTHING_TO_ASK }
  }

  const parsed = parseRsvpSubmission({
    fields: input.fields,
    questions: target.target.questions,
    maxPartySize: maxPartySize(target.target.documents),
  })

  if (!parsed.ok) {
    const first = parsed.issues[0]
    return {
      ok: false,
      message: first?.message ?? 'Please check the form and try again.',
      issues: parsed.issues,
    }
  }

  if (parsed.submission === null) {
    /*
     * The honeypot was filled, which a guest cannot do. Nothing is stored and
     * the answer is the same one a real reply gets: telling a form filler which
     * field gave it away is free tuning for whoever wrote it.
     */
    return { ok: true }
  }

  const stored = await storeRsvp(input.slug, parsed.submission)

  if (stored.kind === 'stored') return { ok: true }
  if (stored.kind === 'closed') return { ok: false, message: CLOSED }
  if (stored.kind === 'not-found') return { ok: false, message: MISSING }
  return { ok: false, message: BROKEN }
}

/**
 * The party size ceiling the buyer configured, from the template document
 * rather than from the form.
 *
 * A form that sends its own ceiling is a form that can send a different one.
 * The fallback is the database's own bound, so a document that will not resolve
 * costs a guest a wider select rather than a refused reply: the constraint on
 * `rsvps` is what actually holds.
 */
function maxPartySize(documents: Parameters<typeof resolveEventPage>[0]): number {
  const page = resolveEventPage(documents)
  if (!page.ok) return RSVP_MAX_PARTY_SIZE

  for (const block of page.page.blocks) {
    if (block.type === 'rsvp-form') return block.config.guestCount.max
  }

  return RSVP_MAX_PARTY_SIZE
}
