'use client'

/**
 * The RSVP form.
 *
 * What it collects, and what happens to each field at expiry, because
 * AGENTS.md says no field goes on this form without that answer:
 *
 *   name           rsvps.guest_name      erased at grace + 30 days
 *   attendance     rsvps.attendance      kept, it is not identifying
 *   guest count    rsvps.party_size      kept, it is not identifying
 *   email          rsvps.guest_email     erased at grace + 30 days
 *   dietary notes  rsvps.dietary_notes   erased at grace + 30 days
 *   message        rsvps.message         erased at grace + 30 days
 *
 * There is no field here that the format could add, because `fields` is a
 * record of four known questions rather than a list, so this form cannot grow
 * guest PII that the retention rules do not already cover.
 *
 * Two things it does not do. It does not decide where an RSVP goes: `submit` is
 * a required prop, so a form that has nowhere to send a reply cannot be
 * rendered by accident. And it does not draw its own focus rings; the browser's
 * are kept, because there is no focus token and inventing a colour for one is
 * exactly the kind of hardcoded value the block set exists to prevent.
 *
 * Field lengths match the check constraints on `rsvps` so that a guest is told
 * about a limit while they are typing rather than by a rejected submission.
 */

import { useId, useState } from 'react'

import type { RsvpFormConfig } from '@/lib/template'

import { BlockSection } from './block-section'

export type RsvpSubmitResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string }

/** What the block calls when a guest submits. Phase 0.5 wires it to the API route. */
export type RsvpSubmit = (formData: FormData) => Promise<RsvpSubmitResult>

/**
 * Derived from `public.event_state_at`: live serves an open form, grace serves
 * the closed message. RSVPs close at hosting expiry because collecting new
 * guest PII against a lapsed account is not defensible.
 */
export type RsvpPhase = 'open' | 'closed'

/**
 * Copy the format does not carry. Name and attendance are not in `fields`,
 * because neither is optional: an RSVP with no name cannot be matched to an
 * invitation, and one that does not say yes or no is not an RSVP. If a buyer
 * ever needs to reword these, that is a change to the rsvp-form config and a
 * version migration rather than an edit in here.
 */
const NAME_LABEL = 'Your name'
const ATTENDANCE_LEGEND = 'Can you make it?'
const ATTENDING_LABEL = "Yes, I'll be there"
const NOT_ATTENDING_LABEL = "Sorry, I can't make it"
const GENERIC_FAILURE = 'That did not send. Please check your connection and try again.'

const CONTROL_CLASS =
  'type-body mt-[var(--space-xs)] w-full rounded-[var(--radius-md)] border border-[color:var(--color-ink-muted)] bg-[var(--color-surface)] p-[var(--space-sm)] text-[color:var(--color-ink)]'

const LABEL_CLASS = 'type-caption block text-[color:var(--color-ink-muted)]'

export function RsvpFormBlock({
  blockId,
  config,
  phase,
  submit,
}: {
  readonly blockId: string
  readonly config: RsvpFormConfig
  readonly phase: RsvpPhase
  readonly submit: RsvpSubmit
}) {
  const fieldId = useId()
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle')
  const [failure, setFailure] = useState(GENERIC_FAILURE)
  const [attending, setAttending] = useState(true)

  const headingId = `${blockId}-heading`
  const fields = config.fields

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    setStatus('submitting')
    try {
      const result = await submit(formData)
      if (result.ok) {
        setStatus('submitted')
        return
      }
      setFailure(result.message)
      setStatus('failed')
    } catch {
      setFailure(GENERIC_FAILURE)
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
          <div>
            <label htmlFor={`${fieldId}-name`} className={LABEL_CLASS}>
              {NAME_LABEL}
            </label>
            <input
              id={`${fieldId}-name`}
              name="guest_name"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className={CONTROL_CLASS}
            />
          </div>

          <fieldset className="mt-[var(--space-md)]">
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
                  name="attendance"
                  value={choice.value}
                  required
                  defaultChecked={choice.value === 'attending'}
                  onChange={() => setAttending(choice.value === 'attending')}
                />
                {choice.label}
              </label>
            ))}
          </fieldset>

          {/*
           * Only while attending. `rsvps_party_size_range` and its sibling
           * constraint require a decline to carry a party size of zero, so
           * asking a guest who cannot come how many are coming would be asking
           * for a row the database will refuse.
           */}
          {fields.guestCount.enabled && attending && (
            <div className="mt-[var(--space-md)]">
              <label htmlFor={`${fieldId}-party`} className={LABEL_CLASS}>
                {fields.guestCount.label ?? 'How many of you?'}
              </label>
              <select
                id={`${fieldId}-party`}
                name="party_size"
                defaultValue="1"
                className={CONTROL_CLASS}
              >
                {Array.from({ length: fields.guestCount.max }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  )
                )}
              </select>
            </div>
          )}

          {fields.email.enabled && (
            <div className="mt-[var(--space-md)]">
              <label htmlFor={`${fieldId}-email`} className={LABEL_CLASS}>
                {fields.email.label ?? 'Email'}
              </label>
              <input
                id={`${fieldId}-email`}
                name="guest_email"
                type="email"
                maxLength={254}
                autoComplete="email"
                className={CONTROL_CLASS}
              />
            </div>
          )}

          {fields.dietary.enabled && (
            <div className="mt-[var(--space-md)]">
              <label htmlFor={`${fieldId}-dietary`} className={LABEL_CLASS}>
                {fields.dietary.label ?? 'Anything we should know about food?'}
              </label>
              <textarea
                id={`${fieldId}-dietary`}
                name="dietary_notes"
                rows={2}
                maxLength={500}
                className={CONTROL_CLASS}
              />
            </div>
          )}

          {fields.message.enabled && (
            <div className="mt-[var(--space-md)]">
              <label htmlFor={`${fieldId}-message`} className={LABEL_CLASS}>
                {fields.message.label ?? 'A note for us'}
              </label>
              <textarea
                id={`${fieldId}-message`}
                name="message"
                rows={3}
                maxLength={2000}
                className={CONTROL_CLASS}
              />
            </div>
          )}

          {config.deadlineNote !== undefined && (
            <p className="type-caption mt-[var(--space-md)] text-[color:var(--color-ink-muted)]">
              {config.deadlineNote}
            </p>
          )}

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
