'use server'

import { revalidatePath, updateTag } from 'next/cache'

import {
  COMPOSITION_FIELD,
  NO_PALETTE_OVERRIDE,
  PALETTE_FIELD,
  PALETTE_RESET,
  applyCompositionCommand,
  blockDetailChanges,
  buildContentDocument,
  checkContent,
  editableSections,
  isLoadBearingBlock,
  overrideFor,
  paletteOverride,
  parseCompositionCommand,
  pictureFields,
  readPalette,
  readValue,
  scheduleDetailChanges,
  sectionPrefix,
  withSections,
  type CompositionCommandKind,
  type EditableSection,
  type JsonRecord,
  type PictureValue,
} from '@/lib/editor'
import {
  confirming,
  encodeReplay,
  failed,
  isConfirmed,
  replayedForm,
  saved,
  type DetailChange,
  type SaveResult,
} from '@/lib/editor/result'
import {
  formatEventDate,
  formatEventTime,
  isSupportedTimeZone,
  parseWallClock,
} from '@/lib/event/time'
import { DEFAULT_RSVP_QUESTIONS } from '@/lib/rsvp/questions'
import { eventCacheTag } from '@/lib/serving/cache'
import { currentBuyer } from '@/lib/supabase/buyer'
import {
  addQuestions,
  countReplies,
  loadEditableEvent,
  mintSlugForTitle,
  pictureForUpload,
  retireQuestion,
  saveEventContent,
  saveEventDetails,
  saveEventTheme,
  setEventStatus,
  setQuestionRequired,
  type EditableEvent,
  type NewQuestion,
} from '@/lib/supabase/editing'
import {
  EMPTY_EVENT_CONTENT,
  applyOverride,
  eventContentPipeline,
  templateDefinitionPipeline,
  themePipeline,
  type EventContent,
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
 *
 * ## The load bearing detail warning
 *
 * Two of these three saves can change a fact a guest has already acted on: the
 * date and the time zone on the details, and the venue and the address on the
 * map section. When one of those moves on an invitation that has replies, the
 * save stops and asks, showing how many people have replied. Nothing is sent to
 * anybody either way, and the buyer may go ahead: it is a confirmation and never
 * a block. See src/lib/editor/load-bearing.ts for what is on the list and why
 * that list cannot be derived from the format, and src/lib/editor/result.ts for
 * how the pending save survives being asked about.
 *
 * Two more saves live here, and they are one column: publishing, and taking a
 * page back down.
 *
 * ## And two that arrived with composition
 *
 *   the sections  `content.sections`, which is which sections the invitation has
 *                 and in what order. It shares a document and a write path with
 *                 the words, so one press is one whole new published revision
 *                 and a guest never reads half a reorder.
 *   the colours   `event_content.theme`, written through the same function with
 *                 the halves the other way round, so choosing a palette cannot
 *                 touch a sentence.
 */

// The invitation --------------------------------------------------------------

export async function saveInvitation(
  eventId: string,
  _previous: SaveResult,
  submitted: FormData
): Promise<SaveResult> {
  /*
   * A confirmation replays the form that was asked about rather than the one
   * that was just posted, because React resets the visible controls between the
   * two. See `replayedForm`.
   */
  const formData = replayedForm(submitted)

  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const { buyer, event, definition } = loaded

  const stored = readStoredContent(event)
  if ('failure' in stored) return stored.failure

  const sections = editableSections(definition, stored.content)

  const pictures = await resolvePictures(buyer, event, sections, formData)
  if ('failure' in pictures) return pictures.failure

  const blocks: Record<string, JsonRecord> = {}
  let envelope: JsonRecord | undefined
  const changes: DetailChange[] = []

  for (const section of sections) {
    const prefix = sectionPrefix(section)
    const value = readValue(section.fields, {
      formData,
      prefix,
      current: section.current,
      pictures: pictures.byName,
    })
    const override = overrideFor(section.base, value)

    /*
     * Compared against `section.current`, which is the template's default with
     * the buyer's override merged over it: the value a guest can read right
     * now. Comparing overrides would miss a buyer clearing theirs, which does
     * change what is on the page.
     */
    if (isLoadBearingBlock(section.type)) {
      changes.push(...blockDetailChanges(section.type, section.current, value))
    }

    if (section.kind === 'envelope') envelope = override
    else blocks[section.id] = override
  }

  const candidate = buildContentDocument(stored.content, { blocks, envelope })
  const checked = checkContent(definition, candidate)

  if (!checked.ok) {
    return failed('Some of that could not be saved, so none of it was.', [...checked.issues])
  }

  const question = await askAboutChanges(buyer, eventId, changes, submitted)
  if (question !== null) return question

  const written = await saveEventContent(buyer, eventId, checked.content)
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, event.slug)
  return saved('Saved. Guests see this now.')
}

// The sections ----------------------------------------------------------------

/**
 * One pressed button: move a section up or down, take one out, or put one back.
 *
 * Composition is a key in the content document, so this is the same write path
 * the words take: a whole new published revision, in one transaction. That is
 * what answers "what does a guest see mid-edit". They see the order before the
 * press or the order after it, and never a page with a section half moved,
 * because there is no request in which a page exists in between.
 *
 * There is still no draft state, which means an intermediate order on a
 * published invitation is an order guests can see. The honest answer to that is
 * the one that already exists rather than a new one: take the invitation down
 * while rearranging and put it back up. The panel says so.
 *
 * ## Removing a section keeps its words
 *
 * `withSections` copies `blocks` across whole, including the words behind the
 * section being removed. Putting it back is therefore the same thing as never
 * having removed it, which is the only defensible answer for somebody who
 * pressed the wrong button: the stored document is the buyer's only copy of what
 * they wrote. See docs/composition.md.
 */
export async function saveComposition(
  eventId: string,
  _previous: SaveResult,
  submitted: FormData
): Promise<SaveResult> {
  const formData = replayedForm(submitted)

  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const { buyer, event, definition } = loaded

  const command = parseCompositionCommand(formData.get(COMPOSITION_FIELD))
  if (command === null) {
    return failed('That control could not be read, so nothing was changed.')
  }

  const stored = readStoredContent(event)
  if ('failure' in stored) return stored.failure

  const change = applyCompositionCommand(definition, stored.content, command)
  if (!change.ok) return failed(change.message)

  const candidate = withSections(stored.content, change.sections)
  const checked = checkContent(definition, candidate)
  if (!checked.ok) {
    return failed('That change could not be saved, so nothing was.', [...checked.issues])
  }

  /*
   * Only a removal asks, and only when the section carries a fact a guest plans
   * a journey around. Taking the venue and the address off a page twelve people
   * have already replied to is the same harm as changing them, expressed as a
   * change to nothing. Putting a section back is not asked about: it restores
   * what guests could read before and takes nothing away. Reordering is not
   * either, because the same facts in a different order are the same facts.
   */
  const changes =
    command.kind === 'remove'
      ? blockDetailChanges(
          definition.blocks.find((block) => block.id === command.id)?.type ?? '',
          mergedConfigOf(definition, stored.content, command.id),
          {}
        )
      : []

  const question = await askAboutChanges(buyer, eventId, changes, submitted)
  if (question !== null) return question

  const written = await saveEventContent(buyer, eventId, checked.content)
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, event.slug)
  return saved(COMPOSITION_WORDS[command.kind])
}

const COMPOSITION_WORDS: Readonly<Record<CompositionCommandKind, string>> = {
  up: 'Moved. Guests read the sections in this order now.',
  down: 'Moved. Guests read the sections in this order now.',
  remove:
    'Taken off the invitation. What you wrote in it is kept, and putting it back brings it with it.',
  add: 'Put back, at the end. Move it up to where you want it.',
}

// The colours ------------------------------------------------------------------

/**
 * The buyer's palette, written to `event_content.theme`.
 *
 * Nothing on the guest page's read path was tightened to make this work, and
 * that is deliberate. `resolveEventPage` has always fallen back to the
 * template's theme when a stored override does not validate, and reported it
 * rather than failing the page. A palette is not somebody's words: an invitation
 * in the wrong colours still tells guests where to be, and one that refuses to
 * render does not. That fallback is the safety net under everything here.
 *
 * What is tightened instead is the form. Colours arrive from colour inputs, so a
 * browser hands back a hex, and `accentInk` is a choice between the page colour
 * and the card colour rather than a ninth swatch, because the token schema pins
 * it to one of those two (src/lib/editor/palette.ts). A value this cannot read
 * is refused with the field named, which is a form saying which box is wrong,
 * and nothing is written.
 *
 * Contrast is reported beside the controls and never enforced. The palette
 * belongs to the buyer; telling them their guests will struggle to read it is
 * the honest thing that is also true.
 */
export async function savePalette(
  eventId: string,
  _previous: SaveResult,
  formData: FormData
): Promise<SaveResult> {
  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const { buyer, event } = loaded

  if (formData.get(PALETTE_FIELD) === PALETTE_RESET) {
    const cleared = await saveEventTheme(buyer, eventId, NO_PALETTE_OVERRIDE)
    if (!cleared.ok) return failed(cleared.message, [{ path: 'database', message: cleared.detail }])

    dropCachedCopies(eventId, event.slug)
    return saved("Back to the template's own colours.")
  }

  const template = themePipeline.load(event.templateTheme)
  if (!template.ok) {
    /*
     * The comparison that decides whether a palette is an override at all needs
     * the template's own, so without it there is nothing to compare against and
     * writing anyway would store a palette that can never go back to being no
     * palette. Nothing is changed.
     */
    return failed("This template's colours could not be read, so nothing was changed.", [
      ...template.issues,
    ])
  }

  const palette = readPalette(formData)
  if (!palette.ok) {
    return failed('Some of those could not be read as colours, so none of them were saved.', [
      ...palette.issues,
    ])
  }

  const override = paletteOverride(palette.colours, template.document.tokens.color)

  const written = await saveEventTheme(buyer, eventId, override)
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, event.slug)
  return saved(
    override.tokens.color === undefined
      ? "Saved. These are the template's own colours, so this invitation follows the template again."
      : 'Saved. Guests see these colours now.'
  )
}

// The details -----------------------------------------------------------------

export async function saveDetails(
  eventId: string,
  _previous: SaveResult,
  submitted: FormData
): Promise<SaveResult> {
  const formData = replayedForm(submitted)

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

  const changes = scheduleDetailChanges(
    { startsAtLocal: loaded.event.startsAtLocal, timeZone: loaded.event.timeZone },
    { startsAtLocal, timeZone },
    describeWhen
  )

  const question = await askAboutChanges(loaded.buyer, eventId, changes, submitted)
  if (question !== null) return question

  /*
   * A new link, but only while nobody can be holding the old one. The event was
   * created under a placeholder title the moment a code was spent, so the slug
   * minted then says nothing about the couple; letting it follow the title until
   * publication is what turns it into a link worth pasting into a chat. Once
   * published it is frozen by `events_before_write`, and asking for a change
   * then would fail the whole save. See `saveEventDetails`.
   */
  let slug: string | null = null
  if (loaded.event.publishedAt === null && title !== loaded.event.title) {
    slug = await mintSlugForTitle(loaded.buyer, title)
    if (slug === null) {
      return failed('A link for the invitation could not be minted, so nothing was saved.', [
        { path: 'title', message: 'the database would not mint a slug for this title' },
      ])
    }
  }

  const written = await saveEventDetails(loaded.buyer, eventId, {
    title,
    startsAtLocal,
    endsAtLocal,
    timeZone,
    slug,
  })
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  // Both slugs: the one guests would use now, and the one they would have used
  // a moment ago. Dropping only the new one would leave the old address serving
  // a cached copy of a page that has moved.
  dropCachedCopies(eventId, loaded.event.slug)
  if (slug !== null) updateTag(eventCacheTag(slug))

  return saved(
    slug === null
      ? 'Saved. The countdown and the date now read from this.'
      : `Saved. Your link is now /e/${slug}.`
  )
}

/** `Saturday 14 March 2027, 4:00 pm (Australia/Sydney)`, for a confirmation. */
function describeWhen(startsAtLocal: string, timeZone: string): string {
  const wallClock = parseWallClock(startsAtLocal)
  if (wallClock === null) return `${startsAtLocal} (${timeZone})`
  return `${formatEventDate(wallClock)}, ${formatEventTime(wallClock)} (${timeZone})`
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

// Publishing ------------------------------------------------------------------

/**
 * Putting the invitation in front of guests, and taking it back down.
 *
 * One column, `events.status`, and no second opinion about it anywhere. Which
 * of the four states a guest gets is `public.event_state_at` reading that column
 * alongside the two expiry timestamps, and nothing in this application compares
 * those a second time (docs/serving.md). So publishing is a one-field write and
 * the observable effect is somebody else's: `/e/<slug>` stops serving the
 * designed "not published" notice and starts serving the invitation.
 *
 * No confirmation on either, and that is deliberate. The load bearing warning
 * exists because a guest has already read something and acted on it; nobody has
 * read an unpublished page, and taking one down tells guests nothing they were
 * relying on. What unpublishing does need is to be fast, because the reason
 * somebody reaches for it is that the wrong thing is live.
 */
export async function publishInvitation(
  eventId: string,
  _previous: SaveResult,
  _formData: FormData
): Promise<SaveResult> {
  return setStatus(eventId, 'published')
}

export async function unpublishInvitation(
  eventId: string,
  _previous: SaveResult,
  _formData: FormData
): Promise<SaveResult> {
  return setStatus(eventId, 'draft')
}

async function setStatus(eventId: string, status: 'draft' | 'published'): Promise<SaveResult> {
  const loaded = await open(eventId)
  if ('failure' in loaded) return loaded.failure

  const written = await setEventStatus(loaded.buyer, eventId, status)
  if (!written.ok) return failed(written.message, [{ path: 'database', message: written.detail }])

  dropCachedCopies(eventId, loaded.event.slug)

  return saved(
    status === 'published'
      ? `Published. /e/${loaded.event.slug} opens the invitation now, and the link never changes.`
      : 'Taken down. Anyone opening the link now sees a notice instead of the invitation.'
  )
}

// Shared ----------------------------------------------------------------------

/**
 * The question in front of a load bearing change, or null to go ahead.
 *
 * Null in three cases: nothing load bearing moved, nobody has replied, or the
 * buyer has already said yes. Everything else asks, including the case where
 * the count could not be read, because being asked about a change nobody had
 * replied to costs one extra press and changing a venue under twelve people
 * without asking is what the confirmation exists to prevent.
 *
 * `submitted` rather than the replayed form, so that confirming a second time
 * cannot nest one replay inside another.
 */
async function askAboutChanges(
  buyer: BuyerSession,
  eventId: string,
  changes: readonly DetailChange[],
  submitted: FormData
): Promise<SaveResult | null> {
  if (changes.length === 0) return null
  if (isConfirmed(submitted)) return null

  const replies = await countReplies(buyer, eventId)
  if (replies === 0) return null

  return confirming(replies, changes, encodeReplay(submitted))
}

/**
 * The stored content document, or the reason it cannot be read.
 *
 * An unreadable document is never repaired or replaced on the way past. What is
 * stored stays stored, exactly as it was written, and the buyer is told why.
 */
function readStoredContent(
  event: EditableEvent
): { readonly failure: SaveResult } | { readonly content: EventContent } {
  const stored = eventContentPipeline.load(event.content ?? EMPTY_EVENT_CONTENT)
  if (!stored.ok) {
    return {
      failure: failed(
        'Your saved content could not be read, so nothing was changed. ' + stored.message,
        [...stored.issues]
      ),
    }
  }

  return { content: stored.document }
}

/** What a guest can read in one section right now: the template's, plus the buyer's. */
function mergedConfigOf(
  definition: TemplateDefinition,
  content: EventContent,
  blockId: string
): JsonRecord {
  const block = definition.blocks.find((candidate) => candidate.id === blockId)
  if (block === undefined) return {}

  const override = Object.hasOwn(content.blocks, blockId) ? content.blocks[blockId] : undefined
  const merged = applyOverride(block.config, override ?? {})

  return typeof merged === 'object' && merged !== null && !Array.isArray(merged)
    ? (merged as JsonRecord)
    : {}
}

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
