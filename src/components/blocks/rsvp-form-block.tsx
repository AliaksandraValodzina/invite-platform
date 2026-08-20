'use client'

/**
 * The RSVP form.
 *
 * It draws two different kinds of thing, and the difference is the reply
 * model rather than a layout decision:
 *
 *   The envelope. Attendance and party size, which are columns on `rsvps` and
 *   never questions, because an RSVP that does not say yes or no is not an
 *   RSVP and because the headcount query must not depend on which questions an
 *   event happens to ask. Their copy is in this file, not in the format.
 *
 *   The questions. Rows in `rsvp_questions`, passed in through the block
 *   context, drawn one control per question in the order the rows give. The
 *   block config carries none of them.
 *
 * What happens to each answer at expiry, because AGENTS.md says no field goes
 * on this form without that answer: every question carries a `pii_class`, and
 * everything not classed `none` is erased 30 days after the event's grace
 * period ends. That is a property of the row rather than of this component,
 * which is exactly why the form can grow a question without growing an unswept
 * corner of the database. `docs/replies.md` has the table.
 *
 * Two things it still does not do. It does not decide where a reply goes:
 * `submit` is a required prop, so a form with nowhere to send a reply cannot be
 * rendered by accident. And it does not draw its own focus rings; the browser's
 * are kept, because there is no focus token and inventing a colour for one is
 * exactly the kind of hardcoded value the block set exists to prevent.
 */

import { useId, useState } from 'react'

import {
  RSVP_ATTENDANCE_FIELD,
  RSVP_HONEYPOT_FIELD,
  RSVP_PARTY_SIZE_FIELD,
  RSVP_TEXT_LIMITS,
  rsvpQuestionField,
  type RsvpQuestion,
} from '@/lib/rsvp/questions'
import type { RsvpFormConfig } from '@/lib/template'

import { BlockSection } from './block-section'

/** One message about one control, so a guest is told which answer to fix. */
export type RsvpSubmitIssue = { readonly field: string; readonly message: string }

export type RsvpSubmitResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly message: string
      readonly issues?: readonly RsvpSubmitIssue[]
    }

/** What the block calls when a guest submits. */
export type RsvpSubmit = (formData: FormData) => Promise<RsvpSubmitResult>

/**
 * Derived from `public.event_state_at`: live serves an open form, grace serves
 * the closed message. RSVPs close at hosting expiry because collecting new
 * guest PII against a lapsed account is not defensible.
 */
export type RsvpPhase = 'open' | 'closed'

/**
 * Copy the format does not carry, because neither field is ever optional and
 * neither is a question. If a buyer ever needs to reword these it is a change
 * to the rsvp-form config and a version migration, not an edit in here.
 */
const NAME_LABEL = 'Your name'
const ATTENDANCE_LEGEND = 'Can you make it?'
const ATTENDING_LABEL = "Yes, I'll be there"
const NOT_ATTENDING_LABEL = "Sorry, I can't make it"
const GENERIC_FAILURE = 'That did not send. Please check your connection and try again.'

/**
 * What happens to a reply, said on the form rather than only in a policy.
 *
 * A guest never signed up with us, has no account, and is handing over their
 * name and sometimes their allergies because somebody else asked them to. One
 * line and a link is the least this can do, and it is on the form because that
 * is where the decision is being made.
 */
const PRIVACY_NOTE = 'Your reply goes to the hosts.'
const PRIVACY_LINK_LABEL = 'What happens to it'

const CONTROL_CLASS =
  'type-body mt-[var(--space-xs)] w-full rounded-[var(--radius-md)] border border-[color:var(--color-ink-muted)] bg-[var(--color-surface)] p-[var(--space-sm)] text-[color:var(--color-ink)]'

const LABEL_CLASS = 'type-caption block text-[color:var(--color-ink-muted)]'

const ISSUE_CLASS = 'type-caption mt-[var(--space-xs)] text-[color:var(--color-critical)]'

export function RsvpFormBlock({
  blockId,
  config,
  phase,
  questions,
  submit,
}: {
  readonly blockId: string
  readonly config: RsvpFormConfig
  readonly phase: RsvpPhase
  readonly questions: readonly RsvpQuestion[]
  readonly submit: RsvpSubmit
}) {
  const fieldId = useId()
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle')
  const [failure, setFailure] = useState(GENERIC_FAILURE)
  const [issues, setIssues] = useState<readonly RsvpSubmitIssue[]>([])
  const [attending, setAttending] = useState(true)

  const headingId = `${blockId}-heading`

  function issueFor(field: string): string | undefined {
    return issues.find((issue) => issue.field === field)?.message
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    setStatus('submitting')
    try {
      const result = await submit(formData)
      if (result.ok) {
        setIssues([])
        setStatus('submitted')
        return
      }
      setFailure(result.message)
      setIssues(result.issues ?? [])
      setStatus('failed')
    } catch {
      setFailure(GENERIC_FAILURE)
      setIssues([])
      setStatus('failed')
    }
  }

  return (
    <BlockSection
      blockId={blockId}
      labelledBy={config.heading === undefined ? undefined : headingId}
    >
      {config.heading !== undefined && (
        <h2 id={headingId} className="type-title">
          {config.heading}
        </h2>
      )}

      {config.intro !== undefined && (
        <p className="type-body mt-[var(--space-sm)] text-[color:var(--color-ink-muted)]">
          {config.intro}
        </p>
      )}

      {phase === 'closed' ? (
        <p data-testid="rsvp-closed" className="type-body mt-[var(--space-md)]">
          {config.closedMessage}
        </p>
      ) : status === 'submitted' ? (
        <p data-testid="rsvp-success" role="status" className="type-body mt-[var(--space-md)]">
          {config.successMessage}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-[var(--space-lg)]">
          {/*
           * The honeypot. Hidden from everybody a screen can reach and from
           * anybody a screen reader reads to, so a guest can never fill it, and
           * left in the tab order's way by nothing: `tabIndex={-1}` and
           * `aria-hidden` are what make it a trap for a script rather than a
           * trip hazard for a person.
           */}
          <div aria-hidden="true" className="hidden">
            <label htmlFor={`${fieldId}-${RSVP_HONEYPOT_FIELD}`}>Your website</label>
            <input
              id={`${fieldId}-${RSVP_HONEYPOT_FIELD}`}
              name={RSVP_HONEYPOT_FIELD}
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <fieldset>
            <legend className={LABEL_CLASS}>{ATTENDANCE_LEGEND}</legend>
            {(
              [
                { value: 'attending', label: ATTENDING_LABEL },
                { value: 'not_attending', label: NOT_ATTENDING_LABEL },
              ] as const
            ).map((choice) => (
              <label
                key={choice.value}
                className="type-body mt-[var(--space-xs)] flex items-center gap-[var(--space-sm)]"
              >
                <input
                  type="radio"
                  name={RSVP_ATTENDANCE_FIELD}
                  value={choice.value}
                  required
                  defaultChecked={choice.value === 'attending'}
                  onChange={() => setAttending(choice.value === 'attending')}
                />
                {choice.label}
              </label>
            ))}
            <Issue message={issueFor(RSVP_ATTENDANCE_FIELD)} />
          </fieldset>

          {/*
           * Only while attending. `rsvps_party_size_range` and its sibling
           * constraint require a decline to carry a party size of zero, so
           * asking a guest who cannot come how many are coming would be asking
           * for a row the database will refuse.
           */}
          {config.guestCount.enabled && attending && (
            <div className="mt-[var(--space-md)]">
              <label htmlFor={`${fieldId}-party`} className={LABEL_CLASS}>
                {config.guestCount.label ?? 'How many of you?'}
              </label>
              <select
                id={`${fieldId}-party`}
                name={RSVP_PARTY_SIZE_FIELD}
                defaultValue="1"
                className={CONTROL_CLASS}
              >
                {Array.from({ length: config.guestCount.max }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  )
                )}
              </select>
              <Issue message={issueFor(RSVP_PARTY_SIZE_FIELD)} />
            </div>
          )}

          {questions.map((question) => (
            <QuestionControl
              key={question.id}
              question={question}
              idPrefix={fieldId}
              issue={issueFor(rsvpQuestionField(question.id))}
            />
          ))}

          {config.deadlineNote !== undefined && (
            <p className="type-caption mt-[var(--space-md)] text-[color:var(--color-ink-muted)]">
              {config.deadlineNote}
            </p>
          )}

          <p className="type-caption mt-[var(--space-md)] text-[color:var(--color-ink-muted)]">
            {PRIVACY_NOTE}{' '}
            <a href="/privacy" className="underline">
              {PRIVACY_LINK_LABEL}
            </a>
          </p>

          {status === 'failed' && (
            <p
              data-testid="rsvp-error"
              role="alert"
              className="type-body mt-[var(--space-md)] text-[color:var(--color-critical)]"
            >
              {failure}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="type-body mt-[var(--space-lg)] w-full rounded-[var(--radius-pill)] bg-[var(--color-accent)] p-[var(--space-sm)] text-[color:var(--color-accent-ink)]"
          >
            {config.submitLabel}
          </button>
        </form>
      )}
    </BlockSection>
  )
}

function Issue({ message }: { readonly message: string | undefined }) {
  if (message === undefined) return null
  return (
    <p role="alert" className={ISSUE_CLASS}>
      {message}
    </p>
  )
}

/**
 * One question, drawn by its shape.
 *
 * The switch is exhaustive against the union the question model derives, so a
 * sixth question type fails the typecheck here rather than rendering nothing at
 * runtime. That is the same guarantee `renderBlock` gives for block types, for
 * the same reason: a control that silently does not appear is an answer
 * silently not collected.
 */
function QuestionControl({
  question,
  idPrefix,
  issue,
}: {
  readonly question: RsvpQuestion
  readonly idPrefix: string
  readonly issue: string | undefined
}) {
  const name = rsvpQuestionField(question.id)
  const id = `${idPrefix}-${question.id}`

  switch (question.type) {
    case 'multiple_choice':
    case 'checkbox':
      return (
        <fieldset className="mt-[var(--space-md)]">
          <legend className={LABEL_CLASS}>{question.prompt}</legend>
          {(question.options ?? []).map((option) => (
            <label
              key={option.value}
              className="type-body mt-[var(--space-xs)] flex items-center gap-[var(--space-sm)]"
            >
              <input
                type={question.type === 'checkbox' ? 'checkbox' : 'radio'}
                name={name}
                value={option.value}
                required={question.type === 'multiple_choice' && question.required}
              />
              {option.label}
            </label>
          ))}
          <Issue message={issue} />
        </fieldset>
      )

    case 'long_answer':
      return (
        <div className="mt-[var(--space-md)]">
          <label htmlFor={id} className={LABEL_CLASS}>
            {question.prompt}
          </label>
          <textarea
            id={id}
            name={name}
            rows={3}
            required={question.required}
            maxLength={RSVP_TEXT_LIMITS.long_answer}
            className={CONTROL_CLASS}
          />
          <Issue message={issue} />
        </div>
      )

    case 'short_answer':
    case 'email':
      return (
        <div className="mt-[var(--space-md)]">
          <label htmlFor={id} className={LABEL_CLASS}>
            {question.prompt}
          </label>
          <input
            id={id}
            name={name}
            type={question.type === 'email' ? 'email' : 'text'}
            required={question.required}
            maxLength={RSVP_TEXT_LIMITS[question.type]}
            /*
             * The one place the form guesses at meaning. The name question is
             * the field a browser should offer to fill, and getting that wrong
             * on a phone costs a guest real typing. It is matched on the prompt
             * because a question is a row now, and there is no other marker to
             * match on until one is worth adding.
             */
            autoComplete={
              question.type === 'email' ? 'email' : question.prompt === NAME_LABEL ? 'name' : 'off'
            }
            className={CONTROL_CLASS}
          />
          <Issue message={issue} />
        </div>
      )

    default: {
      // A question type with no control is a typecheck failure, not a question
      // that quietly disappears from the form. The write path makes the same
      // refusal at runtime for a database that is newer than this deploy.
      const unhandled: never = question.type
      return unhandled
    }
  }
}
