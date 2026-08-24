'use client'

import { useActionState } from 'react'

import { CONFIRM_FIELD, CONFIRM_REPLAY_FIELD, type SaveResult } from '@/lib/editor/result'

/**
 * A form that reports what happened to it.
 *
 * The fields inside are rendered on the server and handed in as children, so
 * this component knows nothing about what it is wrapping: it owns the submit
 * button, the pending state and the result, and nothing else.
 *
 * `submitLabel` may be null, and then the children own the buttons. That is for
 * the composition panel, where every control is its own submit button carrying
 * its own command (`up:hero`, `remove:venue-map`) and there is nothing left for
 * one button at the bottom to mean. The status, the failure list and the
 * confirmation panel are the same in both shapes, which is the reason this is a
 * prop rather than a second component: a save that reports differently
 * depending on which form it came from is two answers to one question.
 *
 * `useActionState` rather than a redirect carrying a query string, because a
 * failed save has field paths to show and a query string is a bad place to put
 * a list of them. It also keeps what the buyer typed on screen, which is the
 * whole difference between "that did not save" and "that did not save and you
 * have lost it".
 *
 * The form still works without JavaScript. React posts it as a normal form,
 * the action runs, and the page comes back rendered from the saved row; what is
 * lost with no JavaScript is the message, not the save.
 *
 * ## The confirmation
 *
 * A `confirm` result means nothing was written and a question is being asked:
 * this save moves a detail guests have already acted on, and this many people
 * have replied. It is a confirmation and never a block, so the panel below has a
 * button that goes ahead with exactly what was submitted.
 *
 * The panel states the change as from and to rather than pointing at the
 * controls above, and that is not decoration. React resets an uncontrolled form
 * after an action returns, so by the time this renders, the date in the field
 * has snapped back to the stored one. What gets written is the hidden replay
 * field, so the sentence in the panel is the accurate description of what the
 * button does, and the field above is not.
 */

export function SaveForm({
  action,
  submitLabel,
  children,
}: {
  readonly action: (previous: SaveResult, formData: FormData) => Promise<SaveResult>
  readonly submitLabel: string | null
  readonly children: React.ReactNode
}) {
  const [result, formAction, pending] = useActionState(action, { status: 'idle' } as SaveResult)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}

      <div className="flex items-center gap-4">
        {submitLabel !== null && (
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Saving...' : submitLabel}
          </button>
        )}

        {result.status === 'saved' && (
          <p data-save-status="saved" className="text-sm text-green-800">
            {result.message}
          </p>
        )}

        {result.status === 'failed' && (
          <p data-save-status="failed" className="text-sm text-red-700">
            {result.message}
          </p>
        )}
      </div>

      {result.status === 'confirm' && (
        <div
          data-save-status="confirm"
          role="alert"
          className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          <p data-testid="confirm-message" className="font-medium">
            {result.message}
          </p>

          <ul data-testid="confirm-changes" className="flex flex-col gap-1">
            {result.changes.map((change) => (
              <li key={change.label}>
                {change.label} changes from <strong>{change.from}</strong> to{' '}
                <strong>{change.to}</strong>.
              </li>
            ))}
          </ul>

          <p className="text-slate-700">
            Nothing has been changed yet, and nobody is told either way. Telling your guests is
            still yours to do.
          </p>

          {/*
           * The submitted form, carried whole in one field so that confirming
           * writes what was asked about rather than what the controls above
           * happen to say now. See src/lib/editor/result.ts.
           */}
          <input type="hidden" name={CONFIRM_REPLAY_FIELD} value={result.replay} />

          <button
            type="submit"
            name={CONFIRM_FIELD}
            value="yes"
            disabled={pending}
            className="self-start rounded bg-amber-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Change it anyway
          </button>
        </div>
      )}

      {result.status === 'failed' && result.issues.length > 0 && (
        <ul data-save-issues="" className="flex flex-col gap-1 rounded bg-red-50 p-3 text-sm">
          {result.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
