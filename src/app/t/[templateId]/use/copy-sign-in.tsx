'use client'

import { useActionState } from 'react'

import { sendCopySignInLink, type CopySignInState } from './actions'

/**
 * The one field between a template preview and somebody's own invitation.
 *
 * Deliberately the same shape as the forms at `/login` and on a claim link,
 * including the answer that says nothing about whether the address has an
 * account. What is different is behind it: this one may create the account,
 * because the design being copied is free. See ./actions.ts.
 */

const INITIAL: CopySignInState = { status: 'idle' }

export function CopySignIn({ templateId }: { readonly templateId: string }) {
  const [state, action, pending] = useActionState(
    sendCopySignInLink.bind(null, templateId),
    INITIAL
  )

  if (state.status === 'sent') {
    return (
      <p data-testid="copy-link-sent" role="status" className="rounded-md bg-slate-100 p-4">
        Check your email. The link we just sent brings you straight back here and opens your own
        copy of this invitation. It is good for one use.
      </p>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm text-slate-600">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="rounded-md border border-slate-300 p-3"
      />

      {(state.status === 'invalid' || state.status === 'failed') && (
        <p data-testid="copy-error" role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 p-3 text-white disabled:opacity-60"
      >
        {pending ? 'Sending' : 'Send me a link'}
      </button>
    </form>
  )
}
