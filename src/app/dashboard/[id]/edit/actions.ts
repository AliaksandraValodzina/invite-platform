'use server'

import { revalidatePath, updateTag } from 'next/cache'

import {
  buildContentDocument,
  checkContent,
  editableSections,
  overrideFor,
  pictureFields,
  readValue,
  sectionPrefix,
  type EditableSection,
  type JsonRecord,
  type PictureValue,
} from '@/lib/editor'
import { failed, saved, type SaveResult } from '@/lib/editor/result'
import { isSupportedTimeZone, parseWallClock } from '@/lib/event/time'
import { DEFAULT_RSVP_QUESTIONS } from '@/lib/rsvp/questions'
import { eventCacheTag } from '@/lib/serving/cache'
import { currentBuyer } from '@/lib/supabase/buyer'
import {
  addQuestions,
  loadEditableEvent,
  pictureForUpload,
  retireQuestion,
  saveEventContent,
  saveEventDetails,
  setQuestionRequired,
  type EditableEvent,
  type NewQuestion,
} from '@/lib/supabase/editing'
import {
  EMPTY_EVENT_CONTENT,
  eventContentPipeline,
  templateDefinitionPipeline,
  type TemplateDefinition,
} from '@/lib/template'
import type { BuyerSession } from '@/lib/supabase/buyer'

/**
 * Three saves, because a buyer's invitation lives in three places and pretending
 * otherwise would mean one of them being the wrong one.
 *
 *   the details    columns on `events`. The date, the end, the time zone. They
 *                  are the source of truth for the countdown, so a block config
 *                  carrying a date would be a second answer to "when is it".
 *   the invitation `event_content.content`, an override document keyed by block
 *                  id, written as a whole new published revision.
 *   the reply form rows in `rsvp_questions`, each carrying the `pii_class` the
 *                  retention sweep reads.
 *
 * Each is its own action and its own button, so a failure in one cannot half
 * apply another and nobody has to reason about what a partial save left behind.
 *
 * Every one of them starts by reading the buyer's session and the event through
 * that buyer's own token. A server action is reachable by a direct POST, not
 * only through the form on the page, so the check has to be here rather than in
 * the page that rendered the form. It is row level security that answers, which
 * is why the same call that loads the event is also the ownership check.
 */

// The invitation --------------------------------------------------------------

export async function saveInvitation(
  eventId: string,
  _previous: SaveResult,
  formData: FormData
): Promise<SaveResult> {
  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const { buyer, event, definition } = loaded

  const stored = eventContentPipeline.load(event.content ?? EMPTY_EVENT_CONTENT)
  if (!stored.ok) {
    return failed(
      'Your saved content could not be read, so nothing was changed. ' + stored.message,
      [...stored.issues]
    )
  }

  const sections = editableSections(definition, stored.document)

  const pictures = await resolvePictures(buyer, event, sections, formData)
  if ('failure' in pictures) return pictures.failure

  const blocks: Record<string, JsonRecord> = {}
  let envelope: JsonRecord | undefined

  for (const section of sections) {
    const prefix = sectionPrefix(section)
    const value = readValue(section.fields, {
      formData,
      prefix,
      current: section.current,
      pictures: pictures.byName,
    })
    const override = overrideFor(section.base, value)

    if (section.kind === 'envelope') envelope = override
    else blocks[section.id] = override
  }

  const candidate = buildContentDocument(stored.document, { blocks, envelope })
  const checked = checkContent(definition, candidate)

  if (!checked.ok) {
    return failed('Some of that could not be saved, so none of it was.', [...checked.issues])
  }

  const written = await saveEventContent(buyer, eventId, checked.content)
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, event.slug)
  return saved('Saved. Guests see this now.')
}

// The details -----------------------------------------------------------------

export async function saveDetails(
  eventId: string,
  _previous: SaveResult,
  formData: FormData
): Promise<SaveResult> {
  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const title = String(formData.get('title') ?? '').trim()
  if (title === '' || title.length > 160) {
    return failed('The invitation needs a title of up to 160 characters.', [
      { path: 'title', message: 'between 1 and 160 characters' },
    ])
  }

  const timeZone = String(formData.get('timeZone') ?? '').trim()
  if (!isSupportedTimeZone(timeZone)) {
    return failed(`"${timeZone}" is not a time zone this deployment knows.`, [
      { path: 'timeZone', message: 'must be an IANA name such as Australia/Sydney' },
    ])
  }

  const startsAtLocal = wallClockFrom(formData, 'startDate', 'startTime')
  if (startsAtLocal === null) {
    return failed('The invitation needs a date and a start time.', [
      { path: 'startDate', message: 'a real date and time' },
    ])
  }

  const endsAtLocal = wallClockFrom(formData, 'endDate', 'endTime')
  const endWasAsked =
    String(formData.get('endDate') ?? '') !== '' || String(formData.get('endTime') ?? '') !== ''

  if (endWasAsked && endsAtLocal === null) {
    return failed('The end needs both a date and a time, or neither.', [
      { path: 'endDate', message: 'a real date and time, or leave both empty' },
    ])
  }

  if (endsAtLocal !== null && endsAtLocal < startsAtLocal) {
    return failed('The end cannot be before the start.', [
      { path: 'endDate', message: 'must not be before the start' },
    ])
  }

  const written = await saveEventDetails(loaded.buyer, eventId, {
    title,
    startsAtLocal,
    endsAtLocal,
    timeZone,
  })
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, loaded.event.slug)
  return saved('Saved. The countdown and the date now read from this.')
}

// The reply form --------------------------------------------------------------

/**
 * Which of the questions we classified this event asks, and which are required.
 *
 * A buyer chooses from `DEFAULT_RSVP_QUESTIONS` and never writes their own
 * words. That is not a UI simplification, it is the `pii_class` rule: the class
 * on a question decides what the retention sweep erases, and a question whose
 * words a buyer chose is a question somebody has to classify. Who does that is
 * an open product decision, so this builds the part that works without it. See
 * docs/editing.md.
 */
export async function saveQuestions(
  eventId: string,
  _previous: SaveResult,
  formData: FormData
): Promise<SaveResult> {
  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const { buyer, event } = loaded
  const now = new Date().toISOString()

  const live = event.questions
  const keeping = live.filter((question) => formData.get(`ask:${question.id}`) !== null)

  for (const question of live) {
    if (!keeping.includes(question)) {
      const retired = await retireQuestion(buyer, question.id, now)
      if (!retired.ok) {
        return failed(retired.message, [{ path: 'database', message: retired.detail }])
      }
      continue
    }

    const required = formData.get(`required:${question.id}`) !== null
    if (required !== question.required) {
      const changed = await setQuestionRequired(buyer, question.id, required)
      if (!changed.ok) {
        return failed(changed.message, [{ path: 'database', message: changed.detail }])
      }
    }
  }

  /*
   * Positions are numbered after the retirements above, because the unique index
   * on (event_id, position) only counts live questions: removing question two
   * frees position two, and a new question numbered from the old maximum would
   * leave a gap for no reason.
   */
  let position = keeping.reduce((highest, question) => Math.max(highest, question.position), 0)

  const asked = new Set(keeping.map((question) => question.prompt))
  const additions: NewQuestion[] = []

  for (const shipped of DEFAULT_RSVP_QUESTIONS) {
    if (asked.has(shipped.prompt)) continue
    if (formData.get(`add:${shipped.key}`) === null) continue

    position += 1
    additions.push({
      type: shipped.type,
      prompt: shipped.prompt,
      required: formData.get(`addRequired:${shipped.key}`) !== null,
      piiClass: shipped.piiClass,
      options: shipped.options,
      position,
    })
  }

  const added = await addQuestions(buyer, eventId, additions)
  if (!added.ok) return failed(added.message, [{ path: 'database', message: added.detail }])

  dropCachedCopies(eventId, event.slug)
  return saved('Saved. The reply form asks this now.')
}

// Shared ----------------------------------------------------------------------

type Opened =
  | { readonly failure: SaveResult }
  | {
      readonly buyer: BuyerSession
      readonly event: EditableEvent
      readonly definition: TemplateDefinition
    }

/**
 * The session, the event and its template, or the reason there is nothing to
 * save into. Every action starts here, including the ones a form on this page
 * never posts to, because a server action is a POST endpoint.
 */
async function open(eventId: string): Promise<Opened> {
  const buyer = await currentBuyer()
  if (buyer === null) {
    return { failure: failed('Your session has expired. Sign in again and nothing will be lost.') }
  }

  const event = await loadEditableEvent(buyer, eventId)
  if (event === null) return { failure: failed('That invitation could not be found.') }

  const definition = templateDefinitionPipeline.load(event.definition)
  if (!definition.ok) {
    return {
      failure: failed('This template could not be read, so nothing was changed.', [
        ...definition.issues,
      ]),
    }
  }

  return { buyer, event, definition: definition.document }
}

/**
 * What each picture control did: a picture to write, or null for one that was
 * removed. Slots nobody touched are absent, which is what leaves them alone.
 */
async function resolvePictures(
  buyer: BuyerSession,
  event: EditableEvent,
  sections: readonly EditableSection[],
  formData: FormData
): Promise<
  { readonly failure: SaveResult } | { readonly byName: Map<string, PictureValue | null> }
> {
  const byName = new Map<string, PictureValue | null>()

  for (const section of sections) {
    for (const picture of pictureFields(section.fields, sectionPrefix(section), section.current)) {
      if (formData.get(`${picture.name}.clear`) !== null) {
        byName.set(picture.name, null)
        continue
      }

      const uploadId = String(formData.get(`${picture.name}.upload`) ?? '').trim()
      if (uploadId === '') continue

      const resolved = await pictureForUpload(buyer, event.id, uploadId)
      if (resolved === null) {
        /*
         * The upload is not this event's, or is gone. Refusing the whole save is
         * the right answer rather than saving the words and dropping the
         * picture: a buyer who chose a photograph and pressed save should never
         * be told it saved when the photograph did not.
         */
        return {
          failure: failed('That picture could not be found, so nothing was saved.', [
            { path: picture.name, message: 'the upload was not found on this invitation' },
          ]),
        }
      }

      byName.set(picture.name, resolved)
    }
  }

  return { byName }
}

/**
 * Drops the guest page's cached copy, and the editor's own.
 *
 * `updateTag` rather than `revalidateTag`, and the difference is the whole
 * point: `revalidateTag` marks the entry stale and serves the stale copy while
 * a fresh one is built, which is right for a catalogue and wrong here.
 * `updateTag` expires it, so the next request waits for the new page. A buyer
 * who pressed save and then opened their own link has to see what they saved;
 * being shown the previous version for another minute reads as "it did not
 * save" and is answered by pressing save again.
 *
 * The guest page's own cache is a minute long on purpose, and that is a privacy
 * bound rather than a speed one (src/lib/serving/cache.ts). This does not
 * loosen it. It is the other direction: `eventCacheTag` exists so a save can
 * name one event and drop exactly its copy.
 *
 * `revalidatePath` on the editor as well, because that page is `force-dynamic`
 * and reads no tagged fetch, and the form has to come back showing what was
 * just written rather than what was on screen before it.
 */
function dropCachedCopies(eventId: string, slug: string): void {
  updateTag(eventCacheTag(slug))
  revalidatePath(`/dashboard/${eventId}/edit`)
}

/** `2027-03-14` and `16:00` from a form, as the wall clock the column holds. */
function wallClockFrom(formData: FormData, dateKey: string, timeKey: string): string | null {
  const date = String(formData.get(dateKey) ?? '').trim()
  const time = String(formData.get(timeKey) ?? '').trim()
  if (date === '' || time === '') return null

  // Seconds are added rather than asked for: an invitation is not scheduled to
  // the second, and a time input that offered them would be asking for noise.
  const candidate = `${date}T${time.length === 5 ? `${time}:00` : time}`
  return parseWallClock(candidate) === null ? null : candidate
}
