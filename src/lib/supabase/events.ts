import 'server-only'

import { z } from 'zod'

import {
  isRsvpPiiClass,
  isRsvpQuestionType,
  type RsvpQuestion,
  type RsvpQuestionOption,
} from '@/lib/rsvp/questions'
import { eventCacheTag, GUEST_PAGE_REVALIDATE_SECONDS } from '@/lib/serving/cache'
import type { StoredEventDocuments } from '@/lib/template'

import { serviceGet } from './service'

/**
 * The guest read path: one slug in, one renderable event out, or a designed
 * state.
 *
 * Nothing here throws. A guest arriving from a group chat gets a page or a
 * designed notice, never a stack trace, so every failure comes back as an
 * outcome the route can render. That is the same rule `src/lib/template/resolve.ts`
 * follows, and for the same reason.
 *
 * One request, not two. `serving_state` is a computed column added by
 * `20260820010000_event_serving_state.sql`, which calls `public.event_state_at`,
 * so the state and the row are read at one clock and cached with one lifetime.
 * Asking for the state separately would give the page two caches with two
 * expiries and let a page outlive the state it was rendered from.
 *
 * The event's live RSVP questions come back on the same request, as an
 * embedded resource. Same argument as `serving_state`: a second request would
 * be a second clock and a second cache lifetime, and the form a guest fills in
 * has to be the form the write path is about to validate against. Retired
 * questions are filtered out by the query rather than after it, so a retired
 * question never reaches a page at all.
 *
 * `events.template_definition_version` is deliberately not read. The column
 * pins the definition version an event was activated against, but `templates`
 * holds one definition and no history, so there is nothing to select by yet.
 * The format's migration ladder is what keeps an older stored document
 * renderable in the meantime (docs/template-format.md). Honouring the pin needs
 * template definition history, which is not this stage.
 */

export const SERVING_STATES = ['unpublished', 'live', 'grace', 'expired'] as const

export type ServingState = (typeof SERVING_STATES)[number]

/** Matches `events_slug_format` in 20260819010400_events.sql. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isPossibleSlug(value: string): boolean {
  return value.length >= 3 && value.length <= 64 && SLUG_PATTERN.test(value)
}

/** The event fields a page renders, named the way the app names things. */
export type GuestEvent = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
}

/**
 * The option list as PostgREST hands it back: `unknown` until it is checked,
 * because it is jsonb and the database only guarantees its shape through a
 * trigger. Anything that does not parse is dropped rather than rendered, which
 * for a choice question means the option is not offered.
 */
const optionSchema = z.object({ value: z.string(), label: z.string() })

const questionRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  prompt: z.string(),
  position: z.number(),
  required: z.boolean(),
  options: z.array(optionSchema).nullable(),
  pii_class: z.string(),
})

export type GuestPageOutcome =
  /** No row, or a slug that could not be one. Renders the designed 404. */
  | { readonly kind: 'not-found' }
  /**
   * The row exists and cannot be served as a page: the database was
   * unreachable, or a published event has no published content revision. Both
   * are our fault rather than the guest's, and both render a designed notice.
   */
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'found'
      readonly event: GuestEvent
      readonly state: ServingState
      readonly documents: StoredEventDocuments
      /** Published revision number, which the share card uses as a cache key. */
      readonly revision: number
      /** Live questions, in the order the form asks them. */
      readonly questions: readonly RsvpQuestion[]
    }

/**
 * The row shape PostgREST returns. The four document columns stay `unknown`:
 * validating them is the template pipeline's job, and it is the only thing that
 * knows how to migrate an older one.
 */
const rowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  starts_at_local: z.string(),
  ends_at_local: z.string().nullable(),
  time_zone: z.string(),
  serving_state: z.enum(SERVING_STATES),
  templates: z.object({ definition: z.unknown(), theme: z.unknown() }).nullable(),
  event_content: z.array(
    z.object({ revision: z.number(), content: z.unknown(), theme: z.unknown() })
  ),
  rsvp_questions: z.array(z.unknown()),
})

const SELECT = [
  'id',
  'slug',
  'title',
  'starts_at_local',
  'ends_at_local',
  'time_zone',
  'serving_state',
  'templates(definition,theme)',
  'event_content(revision,content,theme)',
  'rsvp_questions(id,type,prompt,position,required,options,pii_class)',
].join(',')

export function guestPageQuery(slug: string): string {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: SELECT,
    // Filtering the embedded resource, not the top level one: an event with no
    // published revision must still come back, so that "published but nothing
    // to serve" is a designed notice rather than a 404 a buyer cannot explain.
    'event_content.is_published': 'is.true',
    // A retired question is not asked again. Filtering here rather than after
    // the read means a retired one never reaches a page even if something
    // downstream forgets.
    'rsvp_questions.retired_at': 'is.null',
    'rsvp_questions.order': 'position.asc',
    limit: '1',
  })
  return `events?${params.toString()}`
}

export async function loadGuestPage(slug: string): Promise<GuestPageOutcome> {
  if (!isPossibleSlug(slug)) return { kind: 'not-found' }

  let response
  try {
    response = await serviceGet(guestPageQuery(slug), {
      revalidate: GUEST_PAGE_REVALIDATE_SECONDS,
      tags: [eventCacheTag(slug)],
    })
  } catch (error) {
    return unavailable(slug, describe(error))
  }

  if (!response.ok) {
    return unavailable(slug, `the database answered ${response.status}`)
  }

  if (!Array.isArray(response.json) || response.json.length === 0) {
    return { kind: 'not-found' }
  }

  const parsed = rowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return unavailable(
      slug,
      `the event row was not the shape this deploy expects: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`
    )
  }

  const row = parsed.data

  if (row.templates === null) {
    return unavailable(slug, 'the event names a template that could not be read')
  }

  const event: GuestEvent = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    timeZone: row.time_zone,
  }

  const questions = readQuestions(row.rsvp_questions)

  const published = row.event_content[0]

  // An unpublished or expired event serves a notice and none of its content, so
  // a missing revision is not a problem for those two. For a page that is meant
  // to be on screen it is: the buyer's words are the page, and the template
  // defaults are somebody else's placeholder names.
  if (published === undefined) {
    if (row.serving_state === 'live' || row.serving_state === 'grace') {
      return unavailable(slug, 'the event is published but has no published content revision')
    }

    return {
      kind: 'found',
      event,
      state: row.serving_state,
      revision: 0,
      questions,
      documents: {
        definition: row.templates.definition,
        theme: row.templates.theme,
        content: null,
        themeOverride: null,
      },
    }
  }

  return {
    kind: 'found',
    event,
    state: row.serving_state,
    revision: published.revision,
    questions,
    documents: {
      definition: row.templates.definition,
      theme: row.templates.theme,
      content: published.content,
      themeOverride: published.theme,
    },
  }
}

/**
 * Turns embedded question rows into the shape the form and the write path use.
 *
 * A row that does not parse is dropped rather than rendered. That is the one
 * place in this file where dropping is right: an unknown question type is a
 * deploy that is older than the database, and asking a guest a question this
 * build cannot store an answer to would collect something and lose it. Dropping
 * is visible, because the question is missing from the form, and it cannot lose
 * an answer that was already given.
 */
function readQuestions(rows: readonly unknown[]): RsvpQuestion[] {
  const questions: RsvpQuestion[] = []

  for (const row of rows) {
    const parsed = questionRowSchema.safeParse(row)
    if (!parsed.success) continue

    const { type, pii_class: piiClass, options } = parsed.data
    if (!isRsvpQuestionType(type) || !isRsvpPiiClass(piiClass)) continue

    questions.push({
      id: parsed.data.id,
      type,
      prompt: parsed.data.prompt,
      position: parsed.data.position,
      required: parsed.data.required,
      options: options === null ? null : (options as readonly RsvpQuestionOption[]),
      piiClass,
    })
  }

  return questions.sort((left, right) => left.position - right.position)
}

/**
 * The reason a guest was shown "this page could not be loaded", written where
 * an operator can find it.
 *
 * The notice itself deliberately says nothing: a guest opening an invitation
 * from a group chat is owed an apology, not a database error. But the reason
 * was being computed and then dropped on the floor, which meant a deployment
 * that could not reach its database looked exactly like one whose event row was
 * the wrong shape, and the only way to tell them apart was to guess. That cost
 * a real afternoon the first time this app was put on a host.
 *
 * The slug is in the line because one broken event and every event broken are
 * different incidents. Nothing else from the row is: a reason is an operational
 * fact and a guest page is full of somebody's personal information.
 */
function unavailable(slug: string, reason: string): GuestPageOutcome {
  console.error(`guest page unavailable: ${slug}: ${reason}`)
  return { kind: 'unavailable', reason }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
