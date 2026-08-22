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
import { loadTemplateDocuments } from './templates'

/**
 * Everything the editor reads and writes, as the buyer.
 *
 * Same rule as `./buyer.ts`, one step further: the dashboard reads a buyer's own
 * rows through their own token so that row level security is the check, and the
 * editor writes them the same way. `owner_id = (select auth.uid())` is forced on
 * `events`, `event_content` and `rsvp_questions`, so the worst a bug in this
 * file can do is fail. It cannot write into somebody else's wedding.
 *
 * The service role decides nothing on this path, and that is the point. A guest
 * page has no user, so every check on that path is code we wrote; a buyer
 * editing their own invitation has a user, so the check is a policy in the
 * database.
 *
 * There is exactly one exception and it is worth naming rather than hiding: the
 * template's own definition and theme are read with the service role, because a
 * buyer does not own the template they activated and `templates` has no policy
 * that would let them see it. Which event this is, and whether it is theirs, is
 * still row level security. See `loadTemplateDocuments` for the whole argument.
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
  status: z.string(),
  published_at: z.string().nullable(),
  starts_at_local: z.string(),
  ends_at_local: z.string().nullable(),
  time_zone: z.string(),
  serving_state: z.enum(['unpublished', 'live', 'grace', 'expired']),
  template_id: z.string(),
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
  /** `draft` or `published`. What the buyer's publish control acts on. */
  readonly status: string
  /**
   * When this event was FIRST published, or null.
   *
   * It is the one thing that decides whether the slug can still move.
   * `events_before_write` refuses a slug change once this is set, and it keeps
   * the first publication rather than the most recent one, so unpublishing does
   * not hand the link back. See `saveEventDetails`.
   */
  readonly publishedAt: string | null
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
  'status',
  'published_at',
  'starts_at_local',
  'ends_at_local',
  'time_zone',
  'serving_state',
  'template_id',
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

  /*
   * The template comes from a second read, keyed by an id this buyer's own
   * token just returned. An event naming a template that cannot be read has no
   * structure to edit, and null is the same answer as "not yours" on purpose.
   */
  const template = await loadTemplateDocuments(row.template_id)
  if (template === null) return null

  const published = row.event_content[0]

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    timeZone: row.time_zone,
    state: row.serving_state,
    definition: template.definition,
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
  /**
   * A slug to move to, or null to leave it alone.
   *
   * Only ever set for an event that has never been published. See
   * `mintSlugForTitle`.
   */
  readonly slug: string | null
}

/**
 * Saves the event row's own fields.
 *
 * The slug is here and it was not before, so it is worth saying exactly when it
 * moves and when it cannot. `events_before_write` refuses a slug change once
 * `published_at` is set, and keeps `published_at` at the FIRST publication, so
 * unpublishing does not reopen it. Before that moment nobody holds the link:
 * the page serves the designed "not published" notice to anyone who tries it.
 *
 * That is the whole window, and it exists because of activation. A code is
 * spent before the buyer has typed anything, so the event is created under a
 * placeholder title and the slug minted from it says `your-invitation-a1b2c3`.
 * Letting it follow the title until publication is what turns that into
 * `wilhelmina-and-bartholomew-a1b2c3` in the WhatsApp preview, which is the
 * first impression of the product (AGENTS.md). Publishing is what freezes it,
 * and after that nothing moves it, because there is no way to reach the people
 * holding the old link and correct it.
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
        ...(patch.slug === null ? {} : { slug: patch.slug }),
      },
      prefer: 'return=minimal',
    }
  )

  return outcome(response, 'The event details could not be saved just now.')
}

/**
 * A fresh slug for a title, minted by the database.
 *
 * `public.mint_event_slug` is SECURITY DEFINER so its uniqueness check sees
 * every row rather than only this buyer's. Called as a normal user under RLS it
 * would happily mint a slug another owner already holds and fail on the write.
 * That argument is in `20260819010400_events.sql`; this is the caller it was
 * written for.
 */
export async function mintSlugForTitle(
  session: BuyerSession,
  title: string
): Promise<string | null> {
  const response = await buyerRequest(session, 'POST', 'rpc/mint_event_slug', {
    body: { p_title: title },
  })

  return response.ok && typeof response.json === 'string' ? response.json : null
}

/**
 * Publishing, and unpublishing.
 *
 * One column and no second story. `events.status` is publication, expiry is
 * derived from timestamps, and `public.event_state_at` is the only thing that
 * combines them into what a guest gets (docs/serving.md). So this writes
 * `status` and nothing else: `published_at` is filled in by
 * `events_before_write` on the first publication and left alone afterwards,
 * which is what keeps the slug frozen through an unpublish.
 *
 * Unpublishing is a real button and not a hidden one. A buyer who put the wrong
 * date in front of two hundred people needs to be able to take the page down
 * inside a minute, and the alternative to a button is an email to the captain,
 * which is the thing this whole stage exists to remove.
 */
export async function setEventStatus(
  session: BuyerSession,
  eventId: string,
  status: 'draft' | 'published'
): Promise<WriteOutcome> {
  const response = await buyerRequest(
    session,
    'PATCH',
    `events?id=eq.${encodeURIComponent(eventId)}`,
    { body: { status }, prefer: 'return=minimal' }
  )

  return outcome(
    response,
    status === 'published'
      ? 'Your invitation could not be published just now.'
      : 'Your invitation could not be taken down just now.'
  )
}

/**
 * How many people have replied, exactly.
 *
 * `Prefer: count=exact` and `Content-Range`, rather than counting rows in the
 * body, because PostgREST caps a body at `max_rows` and a wedding with more
 * replies than that would be reported as having exactly the cap. This number is
 * shown to a buyer in a sentence about whether to change their venue, so it has
 * to be the real one.
 *
 * `null` means the count could not be established, and every caller treats that
 * as "there may be replies" rather than as zero. Being asked to confirm a change
 * nobody had replied to is a small annoyance; changing a date under twelve
 * people without being asked is the thing the confirmation exists to prevent.
 */
export async function countReplies(session: BuyerSession, eventId: string): Promise<number | null> {
  const response = await buyerRequest(
    session,
    'GET',
    `rsvps?${new URLSearchParams({
      event_id: `eq.${eventId}`,
      select: 'id',
      limit: '1',
    }).toString()}`,
    { prefer: 'count=exact' }
  )

  return response.ok ? response.count : null
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
