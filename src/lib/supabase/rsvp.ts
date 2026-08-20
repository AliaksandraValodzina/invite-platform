import 'server-only'

import { z } from 'zod'

import {
  isRsvpPiiClass,
  isRsvpQuestionType,
  type RsvpQuestion,
  type RsvpQuestionOption,
} from '@/lib/rsvp/questions'
import type { PreparedSubmission } from '@/lib/rsvp/submission'
import type { StoredEventDocuments } from '@/lib/template'

import { serviceGet, servicePost } from './service'

/**
 * The reply write path: the questions as they are right now, and one call that
 * stores a reply.
 *
 * Both reads here are uncached, and that is the whole difference between this
 * module and `./events.ts`. The guest page is cached for up to a minute on
 * purpose, because that bounds how long somebody can be shown the wrong serving
 * state and 60 seconds is a bound this repo chose and wrote down. A request
 * that is about to store a stranger's name and dietary requirements gets no
 * such allowance: it reads the event and its questions fresh, and
 * `public.submit_rsvp` reads the serving state again inside the transaction
 * that does the write.
 *
 * So there are two clocks in this stage and they are different on purpose. The
 * form a guest sees may be a minute old. The decision to store what they typed
 * never is.
 */

const questionRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  prompt: z.string(),
  position: z.number(),
  required: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  pii_class: z.string(),
})

const targetRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  serving_state: z.enum(['unpublished', 'live', 'grace', 'expired']),
  rsvp_questions: z.array(questionRowSchema),
  templates: z.object({ definition: z.unknown(), theme: z.unknown() }).nullable(),
  event_content: z.array(z.object({ content: z.unknown(), theme: z.unknown() })),
})

export type RsvpTarget = {
  readonly eventId: string
  readonly slug: string
  readonly state: 'unpublished' | 'live' | 'grace' | 'expired'
  readonly questions: readonly RsvpQuestion[]
  /**
   * The same four documents the page rendered from, read again here rather than
   * reused from the cached page read. The write path needs one number out of
   * them, the party size ceiling the buyer configured, and taking that from the
   * form would be taking a bound from the thing it is meant to bound.
   */
  readonly documents: StoredEventDocuments
}

export type RsvpTargetOutcome =
  | { readonly kind: 'found'; readonly target: RsvpTarget }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string }

export function rsvpTargetQuery(slug: string): string {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: [
      'id',
      'slug',
      'serving_state',
      'rsvp_questions(id,type,prompt,position,required,options,pii_class)',
      'templates(definition,theme)',
      'event_content(content,theme)',
    ].join(','),
    'rsvp_questions.retired_at': 'is.null',
    'rsvp_questions.order': 'position.asc',
    'event_content.is_published': 'is.true',
    limit: '1',
  })
  return `events?${params.toString()}`
}

export async function loadRsvpTarget(slug: string): Promise<RsvpTargetOutcome> {
  let response
  try {
    response = await serviceGet(rsvpTargetQuery(slug), { revalidate: false })
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }
  if (!Array.isArray(response.json) || response.json.length === 0) {
    return { kind: 'not-found' }
  }

  const parsed = targetRowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'the event row was not the shape this deploy expects' }
  }

  const questions: RsvpQuestion[] = []
  for (const row of parsed.data.rsvp_questions) {
    if (!isRsvpQuestionType(row.type) || !isRsvpPiiClass(row.pii_class)) continue
    questions.push({
      id: row.id,
      type: row.type,
      prompt: row.prompt,
      position: row.position,
      required: row.required,
      options: row.options === null ? null : (row.options as readonly RsvpQuestionOption[]),
      piiClass: row.pii_class,
    })
  }

  const published = parsed.data.event_content[0]

  return {
    kind: 'found',
    target: {
      eventId: parsed.data.id,
      slug: parsed.data.slug,
      state: parsed.data.serving_state,
      questions: questions.sort((left, right) => left.position - right.position),
      documents: {
        definition: parsed.data.templates?.definition ?? null,
        theme: parsed.data.templates?.theme ?? null,
        content: published?.content ?? null,
        themeOverride: published?.theme ?? null,
      },
    },
  }
}

export type StoreRsvpOutcome =
  | { readonly kind: 'stored'; readonly rsvpId: string; readonly answersStored: number }
  /** The event stopped being live between the page rendering and this call. */
  | { readonly kind: 'closed' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * The SQLSTATEs `public.submit_rsvp` raises. They exist so the route can tell a
 * closed invitation from a broken one without reading an error message, which
 * is a thing that changes.
 */
const SUBMIT_ERRORS = { RS404: 'not-found', RS409: 'closed', RS422: 'rejected' } as const

const storedSchema = z.object({
  rsvp_id: z.string(),
  answers_stored: z.number(),
})

export async function storeRsvp(
  slug: string,
  submission: PreparedSubmission
): Promise<StoreRsvpOutcome> {
  let response
  try {
    response = await servicePost('rpc/submit_rsvp', {
      p_slug: slug,
      p_attendance: submission.attendance,
      p_party_size: submission.partySize,
      p_answers: submission.answers.map((answer) => ({
        question_id: answer.questionId,
        value_text: answer.valueText,
        value_choice: answer.valueChoice === null ? null : [...answer.valueChoice],
        value_number: answer.valueNumber,
      })),
    })
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

  if (!response.ok) {
    const code = errorCode(response.json)
    const known = code === null ? undefined : SUBMIT_ERRORS[code as keyof typeof SUBMIT_ERRORS]
    if (known === 'closed') return { kind: 'closed' }
    if (known === 'not-found') return { kind: 'not-found' }
    if (known === 'rejected') return { kind: 'rejected', reason: response.detail }
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }

  const parsed = storedSchema.safeParse(response.json)
  if (!parsed.success) {
    /*
     * The write may well have happened. Saying so is the honest answer: a guest
     * told "that did not send" who then sends again leaves the buyer two
     * replies, which is a nuisance, and a guest told "thank you" whose reply is
     * not there is the failure this whole path exists to avoid.
     */
    return { kind: 'unavailable', reason: 'the reply was stored but could not be confirmed' }
  }

  return {
    kind: 'stored',
    rsvpId: parsed.data.rsvp_id,
    answersStored: parsed.data.answers_stored,
  }
}

/** PostgREST puts the SQLSTATE in `code` on an error body. */
function errorCode(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const code = (json as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
