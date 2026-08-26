import 'server-only'

import { z } from 'zod'

import { defaultQuestionRows } from '@/lib/rsvp/questions'
import {
  serviceDelete,
  serviceGet,
  servicePost,
  type ServiceResponse,
} from '@/lib/supabase/service'

import { hostingExpiresAt } from './hosting'

/**
 * Making a buyer's own copy of a template, whichever door they came through.
 *
 * Two doors reach here and they are not the same product decision:
 *
 *   `/claim/<code>`        a paid activation, single use, spent by exactly one
 *                          buyer (./claim.ts)
 *   `/t/<templateId>/use`  the open copy link of the free launch, held by
 *                          anybody (./copy.ts)
 *
 * What they have in common is everything below: a draft event, its question
 * set, and content revision 1. This is one module rather than two because the
 * first thing that would drift between two copies of it is `defaultQuestionRows`,
 * and a question's `pii_class` is what the retention sweep reads to decide what
 * to erase. `scripts/seed-event.ts` says the same thing about the same list.
 *
 * The service role, because a buyer does not own the template they are copying:
 * the seller does, and `templates` has one policy that says so. The event rows
 * are written with the service role for the same reason the claim path does it
 * (see ./claim.ts), and `owner_id` is the buyer's own subject in every one of
 * them, so what comes out is a row their own token can read and nothing else's.
 */

/** The placeholder an event is created with, before the buyer has filled it in. */
export const NEW_EVENT_TITLE = 'Your invitation'

/**
 * The placeholder date, and why it is deliberately a placeholder.
 *
 * `starts_at_local` and `time_zone` are NOT NULL and nobody knows the real
 * answer at the moment an event is minted, so something has to go in. Six
 * months out at four in the afternoon reads as a stand-in rather than as a date
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

export type MintInput = {
  /** The subject of the buyer's own access token. Becomes `events.owner_id`. */
  readonly ownerId: string
  readonly templateId: string
  /** `events.tier`. A paid claim carries the code's; a free copy carries `basic`. */
  readonly tier: string
  /** How long this event's hosting is paid up for, in whole months. */
  readonly hostingMonths: number
}

export type MintOutcome =
  | { readonly kind: 'minted'; readonly eventId: string }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * The event, its question set and its first content revision.
 *
 * Three writes and no transaction, so the failure of any one of them takes the
 * others back rather than leaving a half-made invitation. Neither caller has
 * spent anything at this point, so a second press makes a whole one.
 *
 * `grace_ends_at` is not sent. `events_before_write` defaults it to hosting
 * expiry plus thirty days, and a second sum here would be a second answer to
 * when a page stops serving.
 */
export async function mintEvent(input: MintInput, now: Date = new Date()): Promise<MintOutcome> {
  const version = await templateDefinitionVersion(input.templateId)
  if (version === null) {
    return { kind: 'failed', reason: 'the template this link names could not be read' }
  }

  try {
    return await write(input, version, now)
  } catch (error) {
    return { kind: 'failed', reason: describeError(error) }
  }
}

async function write(input: MintInput, definitionVersion: number, now: Date): Promise<MintOutcome> {
  const minted = await servicePost('rpc/mint_event_slug', { p_title: NEW_EVENT_TITLE })
  if (!minted.ok || typeof minted.json !== 'string') {
    return {
      kind: 'failed',
      reason: `a link for the invitation could not be minted (${minted.status})`,
    }
  }

  const created = await servicePost(
    'events',
    {
      owner_id: input.ownerId,
      template_id: input.templateId,
      template_definition_version: definitionVersion,
      slug: minted.json,
      title: NEW_EVENT_TITLE,
      // Draft, always. An invitation carrying a placeholder date and the
      // template's example names is not something to put in front of a guest,
      // and publishing is the buyer's own decision either way. It is also what
      // keeps an unlimited supply of copies free: the one published invitation
      // per account is the limit, and a draft is not one.
      status: 'draft',
      tier: input.tier,
      starts_at_local: placeholderStart(now),
      ends_at_local: null,
      time_zone: NEW_EVENT_TIME_ZONE,
      hosting_expires_at: hostingExpiresAt(now, input.hostingMonths).toISOString(),
    },
    { prefer: 'return=representation' }
  )

  if (!created.ok || !Array.isArray(created.json) || created.json.length === 0) {
    return { kind: 'failed', reason: `the invitation could not be created (${created.detail})` }
  }

  const parsed = z.object({ id: z.string() }).safeParse(created.json[0])
  if (!parsed.success) {
    return { kind: 'failed', reason: 'the invitation was created but could not be read back' }
  }

  const eventId = parsed.data.id

  /*
   * The question set. The rows come from `defaultQuestionRows`, which is the
   * same list `scripts/seed-event.ts` uses. That script says why in its own
   * words: the first thing that would drift between two copies of the list is a
   * `pii_class`, which decides what the retention sweep erases.
   */
  const questions = await servicePost(
    'rsvp_questions',
    defaultQuestionRows(eventId, input.ownerId),
    {
      prefer: 'return=minimal',
    }
  )
  if (!questions.ok) {
    await discardEvent(eventId)
    return { kind: 'failed', reason: `the reply form could not be created (${questions.detail})` }
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
      owner_id: input.ownerId,
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
    return {
      kind: 'failed',
      reason: `the invitation's content could not be created (${content.detail})`,
    }
  }

  return { kind: 'minted', eventId }
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
 * Takes back an event this request created and could not finish paying for.
 *
 * Failure is swallowed, and that is the right way round: the caller is already
 * on its way to telling somebody their invitation did not open, and an
 * exception here would replace that sentence with a stack trace. What is left
 * behind is a draft event with no reply, owned by the buyer, which their
 * dashboard shows as an unpublished invitation rather than as damage.
 */
export async function discardEvent(eventId: string): Promise<void> {
  try {
    await serviceDelete(`events?id=eq.${encodeURIComponent(eventId)}`, {
      prefer: 'return=minimal',
    })
  } catch {
    /* see above */
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
