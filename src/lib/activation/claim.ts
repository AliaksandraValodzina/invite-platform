import 'server-only'

import { z } from 'zod'

import { defaultQuestionRows } from '@/lib/rsvp/questions'
import {
  serviceDelete,
  serviceGet,
  servicePatch,
  servicePost,
  type ServiceResponse,
} from '@/lib/supabase/service'

import { normaliseActivationCode } from './code'
import { hostingExpiresAt } from './hosting'

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
    return { kind: 'unavailable', reason: describe(error) }
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
    return { kind: 'unavailable', reason: describe(error) }
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

/** The placeholder an event is created with, before the buyer has filled it in. */
export const NEW_EVENT_TITLE = 'Your invitation'

/**
 * The placeholder date, and why it is deliberately a placeholder.
 *
 * `starts_at_local` and `time_zone` are NOT NULL and nobody knows the real
 * answer at the moment a code is spent, so something has to go in. Six months
 * out at four in the afternoon reads as a stand-in rather than as a date
 * somebody chose, and the event is created unpublished, so no guest can see it
 * before the buyer has replaced it. A neutral zone for the same reason: a
 * guessed one would be silently wrong by hours, and an obviously neutral one is
 * a question the editor's own control asks out loud.
 *
 * `Etc/UTC` and not `UTC`, and the difference is not cosmetic. Two gates have to
 * be cleared and they disagree: `pg_timezone_names` has both, and this app's
 * `isSupportedTimeZone` requires an `Area/Location` name because the countdown
 * resolves through `Intl`. Bare `UTC` inserts happily and then leaves the
 * buyer's own page serving a "could not be loaded" notice, because the schedule
 * never resolves. `tests/unit/activation/claim-defaults.test.ts` holds this to
 * both gates.
 */
export const NEW_EVENT_DAYS_AHEAD = 180
export const NEW_EVENT_HOUR = 16
export const NEW_EVENT_TIME_ZONE = 'Etc/UTC'

const DAY_MS = 86_400_000

/** `2027-03-14T16:00:00`, which is the shape `events.starts_at_local` holds. */
export function placeholderStart(now: Date = new Date()): string {
  const day = new Date(now.getTime() + NEW_EVENT_DAYS_AHEAD * DAY_MS)
  const pad = (part: number) => String(part).padStart(2, '0')
  return (
    `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}` +
    `T${pad(NEW_EVENT_HOUR)}:00:00`
  )
}

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

  const version = await templateDefinitionVersion(code.templateId)
  if (version === null) {
    return { kind: 'unavailable', reason: 'the template this code names could not be read' }
  }

  let created: string
  try {
    const event = await createEvent(code, buyerId, version, now)
    if ('reason' in event) return { kind: 'unavailable', reason: event.reason }
    created = event.eventId
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

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
    return { kind: 'unavailable', reason: describe(error) }
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

async function templateDefinitionVersion(templateId: string): Promise<number | null> {
  let response: ServiceResponse
  try {
    response = await serviceGet(
      `templates?${new URLSearchParams({
        id: `eq.${templateId}`,
        select: 'id,definition_version',
        limit: '1',
      }).toString()}`,
      { revalidate: false }
    )
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = z.object({ definition_version: z.number() }).safeParse(response.json[0])
  return parsed.success ? parsed.data.definition_version : null
}

/**
 * The event, its question set and its first content revision.
 *
 * Three writes and no transaction, so the failure of any one of them takes the
 * others back rather than leaving a half-made invitation somebody has paid for.
 * The code has not been spent at this point, so the buyer's link still works and
 * a second click makes a whole one.
 *
 * The question rows come from `defaultQuestionRows`, which is the same list
 * `scripts/seed-event.ts` uses. `scripts/seed-event.ts` says why in its own
 * words: the first thing that would drift between two copies of that list is a
 * `pii_class`, which decides what the retention sweep erases.
 *
 * `grace_ends_at` is not sent. `events_before_write` defaults it to hosting
 * expiry plus thirty days, and a second sum here would be a second answer to
 * when a page stops serving.
 */
async function createEvent(
  code: ActivationCode,
  buyerId: string,
  definitionVersion: number,
  now: Date
): Promise<{ readonly eventId: string } | { readonly reason: string }> {
  const minted = await servicePost('rpc/mint_event_slug', { p_title: NEW_EVENT_TITLE })
  if (!minted.ok || typeof minted.json !== 'string') {
    return { reason: `a link for the invitation could not be minted (${minted.status})` }
  }

  const created = await servicePost(
    'events',
    {
      owner_id: buyerId,
      template_id: code.templateId,
      template_definition_version: definitionVersion,
      slug: minted.json,
      title: NEW_EVENT_TITLE,
      // Draft, always. An invitation carrying a placeholder date and the
      // template's example names is not something to put in front of a guest,
      // and publishing is the buyer's own decision either way.
      status: 'draft',
      tier: code.tier,
      starts_at_local: placeholderStart(now),
      ends_at_local: null,
      time_zone: NEW_EVENT_TIME_ZONE,
      hosting_expires_at: hostingExpiresAt(now, code.hostingMonths).toISOString(),
    },
    { prefer: 'return=representation' }
  )

  if (!created.ok || !Array.isArray(created.json) || created.json.length === 0) {
    return { reason: `the invitation could not be created (${created.detail})` }
  }

  const parsed = z.object({ id: z.string() }).safeParse(created.json[0])
  if (!parsed.success) return { reason: 'the invitation was created but could not be read back' }

  const eventId = parsed.data.id

  const questions = await servicePost('rsvp_questions', defaultQuestionRows(eventId, buyerId), {
    prefer: 'return=minimal',
  })
  if (!questions.ok) {
    await discardEvent(eventId)
    return { reason: `the reply form could not be created (${questions.detail})` }
  }

  /*
   * Revision 1, published and empty. Empty is right: content is overrides, and a
   * buyer who has changed nothing has overridden nothing. Published is what
   * makes the event servable the moment they press publish, because a published
   * event with no published revision is a designed "unavailable" notice rather
   * than a page (src/lib/supabase/events.ts).
   */
  const content = await servicePost(
    'event_content',
    {
      owner_id: buyerId,
      event_id: eventId,
      revision: 1,
      is_published: true,
      content_version: 1,
      content: { version: 1, blocks: {} },
      theme: { version: 1, tokens: {} },
    },
    { prefer: 'return=minimal' }
  )
  if (!content.ok) {
    await discardEvent(eventId)
    return { reason: `the invitation's content could not be created (${content.detail})` }
  }

  return { eventId }
}

/**
 * Takes back an event this request created and could not pay for.
 *
 * Failure is swallowed, and that is the right way round: the caller is already
 * on its way to telling somebody their claim did not work, and an exception
 * here would replace that sentence with a stack trace. What is left behind is a
 * draft event with no reply, owned by the buyer, which their dashboard shows as
 * an unpublished invitation rather than as damage.
 */
async function discardEvent(eventId: string): Promise<void> {
  try {
    await serviceDelete(`events?id=eq.${encodeURIComponent(eventId)}`, {
      prefer: 'return=minimal',
    })
  } catch {
    /* see above */
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
