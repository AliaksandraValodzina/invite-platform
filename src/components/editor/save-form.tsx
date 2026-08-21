'use client'

import { useActionState } from 'react'

import type { SaveResult } from '@/lib/editor/result'

/**
 * A form that reports what happened to it.
 *
 * The fields inside are rendered on the server and handed in as children, so
 * this component knows nothing about what it is wrapping: it owns the submit
 * button, the pending state and the result, and nothing else.
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
 */

export function SaveForm({
  action,
  submitLabel,
  children,
}: {
  readonly action: (previous: SaveResult, formData: FormData) => Promise<SaveResult>
  readonly submitLabel: string
  readonly children: React.ReactNode
}) {
  const [result, formAction, pending] = useActionState(action, { status: 'idle' } as SaveResult)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Saving...' : submitLabel}
        </button>

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
