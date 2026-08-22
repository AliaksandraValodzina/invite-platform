'use client'

import { useActionState } from 'react'

import { sendClaimSignInLink, type ClaimSignInState } from './actions'

/**
 * The one field between an Etsy order and an invitation.
 *
 * Deliberately the same shape as the sign-in form at `/login`, including the
 * answer that says nothing about whether the address has an account. What is
 * different is what happens behind it: this one may create the account, because
 * the person filling it in is holding a paid activation. See ./actions.ts.
 */

const INITIAL: ClaimSignInState = { status: 'idle' }

export function ClaimSignIn({
  code,
  submitLabel,
}: {
  readonly code: string
  readonly submitLabel: string
}) {
  const [state, action, pending] = useActionState(sendClaimSignInLink.bind(null, code), INITIAL)

  if (state.status === 'sent') {
    return (
      <p data-testid="claim-link-sent" role="status" className="rounded-md bg-slate-100 p-4">
        Check your email. The link we just sent brings you straight back here and opens your
        invitation. It is good for one use.
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
        <p data-testid="claim-error" role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 p-3 text-white disabled:opacity-60"
      >
        {pending ? 'Sending' : submitLabel}
      </button>
    </form>
  )
}
