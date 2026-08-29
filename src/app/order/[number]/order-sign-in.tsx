'use client'

import { useActionState } from 'react'

import { sendOrderSignInLink, type OrderSignInState } from './actions'

/**
 * The email field on a recognised order number.
 *
 * Deliberately the same shape as `/login` and `/claim/<code>`, including the
 * answer that says nothing about whether an address has an account. What is
 * different is behind it: this one may create the account, because the person
 * filling it in has a purchase on the captain's list. See ./actions.ts.
 */

const INITIAL: OrderSignInState = { status: 'idle' }

export function OrderSignIn({
  number,
  submitLabel,
}: {
  readonly number: string
  readonly submitLabel: string
}) {
  const [state, action, pending] = useActionState(sendOrderSignInLink.bind(null, number), INITIAL)

  if (state.status === 'sent') {
    return (
      <p data-testid="order-link-sent" role="status" className="rounded-md bg-slate-100 p-4">
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
        <p data-testid="order-sign-in-error" role="alert" className="text-sm text-red-700">
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
