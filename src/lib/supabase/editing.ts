import 'server-only'

import { z } from 'zod'

import {
  RSVP_MAX_PROMPT_LENGTH,
  isRsvpPiiClass,
  isRsvpQuestionType,
  type RsvpQuestion,
  type RsvpQuestionOption,
} from '@/lib/rsvp/questions'
import { pictureFromUpload, type PictureContent } from '@/lib/uploads/picture'

import { buyerGet, buyerRequest, type BuyerResponse, type BuyerSession } from './buyer'

/**
 * Everything the editor reads and writes, as the buyer.
 *
 * Same rule as `./buyer.ts`, one step further: the dashboard reads a buyer's own
 * rows through their own token so that row level security is the check, and the
 * editor writes them the same way. `owner_id = (select auth.uid())` is forced on
 * `events`, `event_content` and `rsvp_questions`, so the worst a bug in this
 * file can do is fail. It cannot write into somebody else's wedding.
 *
 * The service role appears nowhere on this path, and its absence is the point.
 * A guest page has no user, so every check on that path is code we wrote; a
 * buyer editing their own invitation has a user, so the check is a policy in the
 * database.
 *
 * ## Three homes, three saves
 *
 * A buyer's invitation is not one document, and the editor does not pretend it
 * is. The date and the time zone are columns on `events`, because the countdown
 * has one source of truth and a block config that carried a date would be a
 * second answer to "when is the wedding". The words are `event_content.content`,
 * an override document keyed by block id. The questions are rows in
 * `rsvp_questions`, because each carries the `pii_class` the retention sweep
 * reads. Each saves on its own, so a failure in one does not half apply another.
 */

// The event, as the editor needs it -----------------------------------------

const editableRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  starts_at_local: z.string(),
  ends_at_local: z.string().nullable(),
  time_zone: z.string(),
  serving_state: z.enum(['unpublished', 'live', 'grace', 'expired']),
  templates: z.object({ definition: z.unknown(), theme: z.unknown() }).nullable(),
  event_content: z.array(z.object({ revision: z.number(), content: z.unknown() })),
  rsvp_questions: z.array(z.unknown()),
})

const questionRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  prompt: z.string(),
  position: z.number(),
  required: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  pii_class: z.string(),
})

export type EditableEvent = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
  readonly state: 'unpublished' | 'live' | 'grace' | 'expired'
  /** templates.definition, unvalidated. The format pipeline is what reads it. */
  readonly definition: unknown
  /** event_content.content of the published revision, or null if there is none. */
  readonly content: unknown
  readonly revision: number
  readonly questions: readonly RsvpQuestion[]
}

const EDITABLE_SELECT = [
  'id',
  'slug',
  'title',
  'starts_at_local',
  'ends_at_local',
  'time_zone',
  'serving_state',
  'templates(definition,theme)',
  'event_content(revision,content)',
  'rsvp_questions(id,type,prompt,position,required,options,pii_class)',
].join(',')

/**
 * One event to edit, or null.
 *
 * Null covers both "no such event" and "not yours", and they are the same answer
 * on purpose: whether a given id exists is not something this should teach
 * anybody. The published revision is what is loaded, because that is what a
 * guest is being served and therefore what a buyer is editing.
 */
export async function loadEditableEvent(
  session: BuyerSession,
  eventId: string
): Promise<EditableEvent | null> {
  const response = await buyerGet(
    session,
    'events?' +
      new URLSearchParams({
        id: `eq.${eventId}`,
        select: EDITABLE_SELECT,
        'event_content.is_published': 'is.true',
        'rsvp_questions.retired_at': 'is.null',
        'rsvp_questions.order': 'position.asc',
        limit: '1',
      }).toString()
  )

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = editableRowSchema.safeParse(response.json[0])
  if (!parsed.success) return null

  const row = parsed.data
  // An event naming a template that cannot be read has no structure to edit.
  if (row.templates === null) return null

  const published = row.event_content[0]

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    timeZone: row.time_zone,
    state: row.serving_state,
    definition: row.templates.definition,
    content: published?.content ?? null,
    revision: published?.revision ?? 0,
    questions: readQuestions(row.rsvp_questions),
  }
}

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

// Writing --------------------------------------------------------------------

export type WriteOutcome =
  { readonly ok: true } | { readonly ok: false; readonly message: string; readonly detail: string }

/**
 * Saves the content document as a new published revision.
 *
 * Through `public.save_event_content`, which is a function rather than two
 * requests because unpublishing the old revision and publishing the new one
 * have to land together or not at all. See the migration for the whole
 * argument.
 */
export async function saveEventContent(
  session: BuyerSession,
  eventId: string,
  content: unknown
): Promise<WriteOutcome> {
  const response = await buyerRequest(session, 'POST', 'rpc/save_event_content', {
    body: { p_event_id: eventId, p_content: content },
  })

  return outcome(response, 'Your invitation could not be saved just now.')
}

export type EventDetailsPatch = {
  readonly title: string
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
}

/**
 * Saves the event row's own fields.
 *
 * The slug is deliberately not among them. It is the link guests already have,
 * `events_before_write` refuses to change it once an event has been published,
 * and there is no way to reach the people holding the old one to correct it.
 */
export async function saveEventDetails(
  session: BuyerSession,
  eventId: string,
  patch: EventDetailsPatch
): Promise<WriteOutcome> {
  const response = await buyerRequest(
    session,
    'PATCH',
    `events?id=eq.${encodeURIComponent(eventId)}`,
    {
      body: {
        title: patch.title,
        starts_at_local: patch.startsAtLocal,
        ends_at_local: patch.endsAtLocal,
        time_zone: patch.timeZone,
      },
      prefer: 'return=minimal',
    }
  )

  return outcome(response, 'The event details could not be saved just now.')
}

/**
 * Removes a question from the form.
 *
 * `retired_at`, never a delete, and the database is what makes that true rather
 * than this function remembering: `authenticated` holds no DELETE privilege on
 * `rsvp_questions` at all, and `rsvp_answers` references it ON DELETE RESTRICT.
 * A buyer tidying their form cannot take last month's replies with it.
 */
export async function retireQuestion(
  session: BuyerSession,
  questionId: string,
  at: string
): Promise<WriteOutcome> {
  const response = await buyerRequest(
    session,
    'PATCH',
    `rsvp_questions?id=eq.${encodeURIComponent(questionId)}`,
    { body: { retired_at: at }, prefer: 'return=minimal' }
  )

  return outcome(response, 'That question could not be removed just now.')
}

export async function setQuestionRequired(
  session: BuyerSession,
  questionId: string,
  required: boolean
): Promise<WriteOutcome> {
  const response = await buyerRequest(
    session,
    'PATCH',
    `rsvp_questions?id=eq.${encodeURIComponent(questionId)}`,
    { body: { required }, prefer: 'return=minimal' }
  )

  return outcome(response, 'That question could not be changed just now.')
}

export type NewQuestion = {
  readonly type: string
  readonly prompt: string
  readonly required: boolean
  readonly piiClass: string
  readonly options: readonly RsvpQuestionOption[] | null
  readonly position: number
}

/**
 * Adds questions to the form.
 *
 * Every field of every one of these comes from `DEFAULT_RSVP_QUESTIONS`, and
 * `pii_class` is the reason. A question's class decides what the retention sweep
 * erases, so a question whose words a buyer chose is a question somebody has to
 * classify, and who does that is an open product decision rather than something
 * to invent here. What a buyer picks from is a set we already classified.
 */
export async function addQuestions(
  session: BuyerSession,
  eventId: string,
  questions: readonly NewQuestion[]
): Promise<WriteOutcome> {
  if (questions.length === 0) return { ok: true }

  const response = await buyerRequest(session, 'POST', 'rsvp_questions', {
    body: questions.map((question) => ({
      // owner_id is overwritten from the event by set_owner_from_event, so what
      // is sent here is ignored. A row describes a question; it does not get to
      // say whose it is.
      owner_id: null,
      event_id: eventId,
      type: question.type,
      prompt: question.prompt.slice(0, RSVP_MAX_PROMPT_LENGTH),
      position: question.position,
      required: question.required,
      pii_class: question.piiClass,
      options: question.options,
    })),
    prefer: 'return=minimal',
  })

  return outcome(response, 'Those questions could not be added just now.')
}

// Pictures -------------------------------------------------------------------

/**
 * What an upload becomes in a document, read back as the buyer who made it.
 *
 * The address is never taken from the browser. A form that carried `/a/<key>`
 * would be a form asking us to write an address somebody else's event might own,
 * and the refcount that decides when bytes can be removed
 * (`public.claim_upload_objects`) would then be counting a reference nobody can
 * see. So the form carries an upload id, row level security says whether it is
 * theirs, and the variants on the row are what the content names.
 */
export async function pictureForUpload(
  session: BuyerSession,
  eventId: string,
  uploadId: string
): Promise<PictureContent | null> {
  const response = await buyerGet(
    session,
    'uploads?' +
      new URLSearchParams({
        id: `eq.${uploadId}`,
        event_id: `eq.${eventId}`,
        deleted_at: 'is.null',
        select: 'id,kind,variants',
        limit: '1',
      }).toString()
  )

  if (!response.ok || !Array.isArray(response.json) || response.json.length === 0) return null

  const parsed = z
    .object({ variants: z.array(z.object({ key: z.string(), width: z.number().nullable() })) })
    .safeParse(response.json[0])

  return parsed.success ? pictureFromUpload(parsed.data.variants) : null
}

function outcome(response: BuyerResponse, fallback: string): WriteOutcome {
  if (response.ok) return { ok: true }
  return { ok: false, message: fallback, detail: response.detail }
}
