import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CompositionPanel } from '@/components/editor/composition-panel'
import { PaletteFields } from '@/components/editor/palette-fields'
import { SaveForm } from '@/components/editor/save-form'
import { SectionFields } from '@/components/editor/section-fields'
import {
  PALETTE_FIELD,
  PALETTE_RESET,
  compositionView,
  editableSections,
  sectionPrefix,
  type CompositionView,
  type EditableSection,
  type PaletteColours,
} from '@/lib/editor'
import { parseWallClock } from '@/lib/event/time'
import { DEFAULT_RSVP_QUESTIONS } from '@/lib/rsvp/questions'
import { currentBuyer } from '@/lib/supabase/buyer'
import { loadEditableEvent, type EditableEvent } from '@/lib/supabase/editing'
import {
  EMPTY_EVENT_CONTENT,
  EMPTY_THEME_OVERRIDE,
  eventContentPipeline,
  mergeThemeTokens,
  templateDefinitionPipeline,
  themeOverridePipeline,
  themePipeline,
  type DocumentIssue,
} from '@/lib/template'

import {
  publishInvitation,
  saveComposition,
  saveDetails,
  saveInvitation,
  savePalette,
  saveQuestions,
  unpublishInvitation,
} from './actions'

/**
 * Where a buyer puts their own details on the invitation they bought.
 *
 * There is one form per place the answer lives, and the page is honest about
 * which is which, because that split is the data model rather than a layout
 * choice:
 *
 *   The details     the event row. The date, the end and the time zone are the
 *                   source of truth for the countdown, so they are edited here
 *                   and never inside a section.
 *   The sections    `content.sections`, which is which sections the invitation
 *                   has and in what order. See docs/composition.md.
 *   The invitation  what each of those sections says, drawn from the template
 *                   definition. Every control on it was read out of a block's own
 *                   schema by src/lib/editor/fields.ts. Nothing on this page
 *                   knows what a hero is.
 *   The colours     `event_content.theme`, the buyer's palette as a theme
 *                   override. Tokens, never content.
 *   The reply form  rows in `rsvp_questions`, chosen from the set we classified.
 *
 * What this page deliberately does not offer: a catalogue of designs to add a
 * section from. The sections a buyer can put on their invitation are the ones
 * the template they bought comes with. See docs/composition.md.
 *
 * `force-dynamic` for the same reason the dashboard is: this is one person's
 * own event assembled from their own session, and the no-store header that says
 * so is set in src/proxy.ts, which matches `/dashboard/:path*`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Edit your invitation',
  robots: { index: false, follow: false },
}

const STATE_WORDS: Record<string, string> = {
  unpublished: 'Not published yet, so nobody can open it.',
  live: 'Live. Guests can open it and reply.',
  grace: 'Hosting has lapsed. The link still opens, replies are closed.',
  expired: 'Expired. The link shows a designed notice.',
}

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function EditPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const query = await searchParams
  const justClaimed = query.claimed === '1'

  const buyer = await currentBuyer()
  if (buyer === null) redirect('/login')

  const event = await loadEditableEvent(buyer, id)
  if (event === null) notFound()

  const definition = templateDefinitionPipeline.load(event.definition)
  if (!definition.ok) {
    return (
      <Shell event={event} justClaimed={justClaimed}>
        <Problem
          title="This template could not be read"
          message={definition.message}
          issues={definition.issues}
        />
      </Shell>
    )
  }

  const content = eventContentPipeline.load(event.content ?? EMPTY_EVENT_CONTENT)
  if (!content.ok) {
    return (
      <Shell event={event} justClaimed={justClaimed}>
        {/*
         * Nothing is repaired here and nothing is offered as a form. What is
         * stored is still stored, exactly as it was written; a form built on a
         * document this deploy cannot read would be a form that saved a guess.
         */}
        <Problem
          title="Your saved content could not be read"
          message={content.message}
          issues={content.issues}
        />
      </Shell>
    )
  }

  const sections = editableSections(definition.document, content.document)
  const orphans = Object.keys(content.document.blocks).filter(
    (key) => !definition.document.blocks.some((block) => block.id === key)
  )

  return (
    <Shell event={event} justClaimed={justClaimed}>
      <Details event={event} />
      <Sections event={event} view={compositionView(definition.document, content.document)} />
      <Invitation event={event} sections={sections} orphans={orphans} />
      <Colours event={event} />
      <ReplyForm event={event} />
      <Publication event={event} />
    </Shell>
  )
}

// The details ----------------------------------------------------------------

function Details({ event }: { readonly event: EditableEvent }) {
  const starts = splitWallClock(event.startsAtLocal)
  const ends = event.endsAtLocal === null ? null : splitWallClock(event.endsAtLocal)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">The details</h2>
        <p className="text-sm text-slate-600">
          The date and time as they are where the event is. The countdown is worked out from this
          and the time zone, so a guest in another country still sees the right number.
        </p>
      </div>

      <SaveForm action={saveDetails.bind(null, event.id)} submitLabel="Save the details">
        <div className="flex flex-col gap-1">
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            maxLength={160}
            required
            defaultValue={event.title}
            className={INPUT}
          />
          <p className="text-xs text-slate-500">
            Used in the browser tab and the share card, not on the invitation itself.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <Field id="startDate" label="Date">
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={starts.date}
              className={INPUT}
            />
          </Field>
          <Field id="startTime" label="Starts">
            <input
              id="startTime"
              name="startTime"
              type="time"
              required
              defaultValue={starts.time}
              className={INPUT}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <Field id="endDate" label="End date" optional>
            <input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={ends?.date ?? ''}
              className={INPUT}
            />
          </Field>
          <Field id="endTime" label="Ends" optional>
            <input
              id="endTime"
              name="endTime"
              type="time"
              defaultValue={ends?.time ?? ''}
              className={INPUT}
            />
          </Field>
        </div>

        <Field id="timeZone" label="Time zone">
          <select id="timeZone" name="timeZone" defaultValue={event.timeZone} className={INPUT}>
            {/*
             * The zones this runtime knows, which is the same list
             * `isSupportedTimeZone` checks a save against. A free text box here
             * would let a buyer type something the database refuses, and the
             * countdown is the one thing on the page that cannot be approximately
             * right.
             */}
            {timeZones(event.timeZone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </SaveForm>
    </section>
  )
}

// The sections ----------------------------------------------------------------

/**
 * Which sections this invitation has, and in what order.
 *
 * Above the fields rather than below them, because it is the shape of the page
 * and the fields are what goes in it, and because a section a buyer has just
 * taken out has no form below to look for.
 */
function Sections({
  event,
  view,
}: {
  readonly event: EditableEvent
  readonly view: CompositionView
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">The sections</h2>
        <p className="text-sm text-slate-600">
          The order guests read them in. Taking one out keeps everything you wrote in it, so putting
          it back is the same as never having removed it.
        </p>
      </div>

      {/*
       * No submit button of its own: every control inside is one. See
       * src/lib/editor/composition.ts for why one press is one whole saved
       * order rather than an edit somebody has to commit.
       */}
      <SaveForm action={saveComposition.bind(null, event.id)} submitLabel={null}>
        <CompositionPanel view={view} live={event.state === 'live' || event.state === 'grace'} />
      </SaveForm>
    </section>
  )
}

// The invitation --------------------------------------------------------------

function Invitation({
  event,
  sections,
  orphans,
}: {
  readonly event: EditableEvent
  readonly sections: readonly EditableSection[]
  readonly orphans: readonly string[]
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">The invitation</h2>
        <p className="text-sm text-slate-600">
          Every field below came from the template you bought. What each section holds is the
          template&apos;s decision; what it says is yours.
        </p>
      </div>

      {orphans.length > 0 && (
        <p className="rounded bg-slate-100 p-3 text-sm text-slate-600">
          This invitation also has saved words for {orphans.join(', ')}, which this template no
          longer has a section for. Nothing has been deleted, and saving will not touch it.
        </p>
      )}

      <SaveForm action={saveInvitation.bind(null, event.id)} submitLabel="Save the invitation">
        {sections.map((section) => (
          <fieldset
            key={`${section.kind}:${section.id}`}
            data-section={section.id}
            className="flex min-w-0 flex-col gap-4 rounded border border-slate-200 p-4"
          >
            <legend className="px-1 text-sm font-semibold">{section.label}</legend>

            {section.issues.length > 0 && (
              <div className="rounded bg-red-50 p-3 text-sm">
                <p>
                  What is saved here is not being shown to guests, because it no longer fits this
                  template. It is below exactly as you wrote it, and saving will replace it.
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {section.issues.map((issue) => (
                    <li key={`${issue.path}:${issue.message}`}>
                      <code>{issue.path}</code>: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <SectionFields
              fields={section.fields}
              value={section.current}
              prefix={sectionPrefix(section)}
              eventId={event.id}
            />
          </fieldset>
        ))}
      </SaveForm>
    </section>
  )
}

// The colours ------------------------------------------------------------------

/**
 * The buyer's palette.
 *
 * Its own form and its own write, for the same reason the other three are: the
 * palette lives in `event_content.theme` rather than in the content document,
 * and a failure in one save must not half apply another. Choosing colours cannot
 * touch a sentence, and saving a sentence cannot reset a colour.
 *
 * A stored palette this deploy cannot read is not repaired here and is not
 * hidden either. The guest page is already falling back to the template's own
 * colours and reporting it (src/lib/template/resolve.ts); the honest thing for
 * the person who has to fix it is to be told that is what is happening, and to
 * be shown the colours that are actually on the page.
 */
function Colours({ event }: { readonly event: EditableEvent }) {
  const template = themePipeline.load(event.templateTheme)

  if (!template.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">The colours</h2>
        <Problem
          title="This template's colours could not be read"
          message={template.message}
          issues={template.issues}
        />
      </section>
    )
  }

  const override = themeOverridePipeline.load(event.themeOverride ?? EMPTY_THEME_OVERRIDE)
  const colours: PaletteColours = override.ok
    ? mergeThemeTokens(template.document.tokens, override.document.tokens).color
    : template.document.tokens.color

  const chosen = override.ok && override.document.tokens.color !== undefined

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">The colours</h2>
        <p className="text-sm text-slate-600">
          {chosen
            ? 'Your own colours. Everything on the invitation is drawn from these eight, so nothing on the page can be a colour that is not here.'
            : "The template's own colours. Change one and the invitation follows yours instead."}
        </p>
      </div>

      {!override.ok && (
        <p
          data-testid="palette-rejected"
          className="rounded bg-amber-50 p-3 text-sm text-amber-900"
        >
          The colours saved on this invitation are not ones this version can read, so guests are
          being shown the template&apos;s instead and the invitation is still on screen. Nothing has
          been deleted. Saving below replaces them.
        </p>
      )}

      <SaveForm action={savePalette.bind(null, event.id)} submitLabel="Save the colours">
        <PaletteFields colours={colours} />

        {chosen && (
          <button
            type="submit"
            name={PALETTE_FIELD}
            value={PALETTE_RESET}
            className="self-start rounded border border-slate-300 px-3 py-1 text-sm"
          >
            Go back to the template&apos;s colours
          </button>
        )}
      </SaveForm>
    </section>
  )
}

// The reply form --------------------------------------------------------------

function ReplyForm({ event }: { readonly event: EditableEvent }) {
  const asked = new Set(event.questions.map((question) => question.prompt))
  const available = DEFAULT_RSVP_QUESTIONS.filter((question) => !asked.has(question.prompt))

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">The reply form</h2>
        <p className="text-sm text-slate-600">
          Whether a guest is coming, and how many of them, is always asked. These are the rest.
          Removing one keeps every reply already given to it.
        </p>
      </div>

      <SaveForm action={saveQuestions.bind(null, event.id)} submitLabel="Save the reply form">
        {event.questions.map((question) => (
          <div
            key={question.id}
            data-question={question.id}
            className="rounded border border-slate-200 p-3"
          >
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name={`ask:${question.id}`} value="yes" defaultChecked />
              {question.prompt}
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name={`required:${question.id}`}
                value="yes"
                defaultChecked={question.required}
              />
              A guest must answer it
            </label>
          </div>
        ))}

        {available.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Not asked yet</p>
            {available.map((question) => (
              <div
                key={question.key}
                data-add-question={question.key}
                className="rounded border border-dashed border-slate-300 p-3"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name={`add:${question.key}`} value="yes" />
                  {question.prompt}
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    name={`addRequired:${question.key}`}
                    value="yes"
                    defaultChecked={question.required}
                  />
                  A guest must answer it
                </label>
              </div>
            ))}
          </div>
        )}

        {/*
         * There is no box here to write a question of your own, and that is a
         * decision rather than an omission. Every question carries a `pii_class`
         * that decides what the retention sweep erases, and a question in a
         * buyer's own words is a question somebody has to classify. See
         * docs/editing.md.
         */}
        <p className="text-sm text-slate-600">
          These are the questions this platform asks. Writing your own is not available yet.
        </p>
      </SaveForm>
    </section>
  )
}

// Publishing ------------------------------------------------------------------

/**
 * The one control that decides whether guests can open the link.
 *
 * It is last on the page rather than first, and that is the order of the job: an
 * invitation is filled in and then put up. It is also where the link is stated,
 * because the link is what a buyer is about to paste into a group chat and the
 * one thing on this page they cannot change afterwards.
 */
function Publication({ event }: { readonly event: EditableEvent }) {
  const published = event.status === 'published'

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Your link</h2>
        <p data-testid="event-link" className="text-sm text-slate-600">
          <code>/e/{event.slug}</code>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {event.publishedAt === null
            ? 'This link follows the title until you publish. After that it is fixed, because there is no way to reach the people already holding it.'
            : 'This link is fixed. Changing it would break every share that has already gone out.'}
        </p>
      </div>

      {published ? (
        <SaveForm action={unpublishInvitation.bind(null, event.id)} submitLabel="Take it down">
          <p data-testid="publication-state" className="text-sm text-slate-600">
            Published. Anyone with the link can open it and reply. Taking it down replaces the
            invitation with a notice; nothing already replied is lost.
          </p>
        </SaveForm>
      ) : (
        <SaveForm action={publishInvitation.bind(null, event.id)} submitLabel="Publish">
          <p data-testid="publication-state" className="text-sm text-slate-600">
            Not published. Anyone opening the link sees a notice instead of the invitation. Publish
            when you are ready to share it.
          </p>
        </SaveForm>
      )}
    </section>
  )
}

// Shell -----------------------------------------------------------------------

function Shell({
  event,
  justClaimed,
  children,
}: {
  readonly event: EditableEvent
  /** True on the redirect straight out of a claim link. See src/app/claim. */
  readonly justClaimed: boolean
  readonly children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard" className="text-sm underline">
          Your invitations
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <p className="text-sm text-slate-600">{STATE_WORDS[event.state] ?? event.state}</p>
        <p className="text-sm">
          <Link href={`/e/${event.slug}`} className="underline">
            Open the invitation
          </Link>
        </p>
      </div>

      {justClaimed && (
        /*
         * The first thing somebody sees after paying, and it has one job: say
         * that the thing exists and that the date and names on it are ours
         * rather than theirs. An event is created with a placeholder date and
         * the template's example words (src/lib/activation/claim.ts), and a
         * buyer who did not notice would publish somebody else's names.
         */
        <p
          data-testid="just-claimed"
          role="status"
          className="rounded-md bg-green-50 p-4 text-sm text-green-900"
        >
          Your invitation is ready. Everything on it is still an example, including the date, so
          work down the page and replace it. Nobody can open it until you publish.
        </p>
      )}

      {children}
    </main>
  )
}

function Problem({
  title,
  message,
  issues,
}: {
  readonly title: string
  readonly message: string
  readonly issues: readonly DocumentIssue[]
}) {
  return (
    <div data-editor-problem="" className="rounded bg-red-50 p-4 text-sm">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1">{message}</p>
      <p className="mt-1">Nothing has been changed, and nothing you saved has been lost.</p>
      {issues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const INPUT = 'w-full rounded border border-slate-300 px-3 py-2 text-sm'

function Field({
  id,
  label,
  optional = false,
  children,
}: {
  readonly id: string
  readonly label: string
  readonly optional?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional && <span className="ml-2 font-normal text-slate-500">optional</span>}
      </label>
      {children}
    </div>
  )
}

/** `2027-03-14T16:00:00` as the two values a date and a time input hold. */
function splitWallClock(value: string): { readonly date: string; readonly time: string } {
  const wallClock = parseWallClock(value)
  if (wallClock === null) return { date: '', time: '' }

  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    date: `${wallClock.year}-${pad(wallClock.month)}-${pad(wallClock.day)}`,
    time: `${pad(wallClock.hour)}:${pad(wallClock.minute)}`,
  }
}

/**
 * Every zone this runtime knows, with the event's own included even if it is
 * not among them. A row whose zone this build does not recognise still has to
 * be editable, and silently substituting a different one would move somebody's
 * wedding.
 */
function timeZones(current: string): readonly string[] {
  const supported = Intl.supportedValuesOf('timeZone')
  return supported.includes(current) ? supported : [current, ...supported]
}
