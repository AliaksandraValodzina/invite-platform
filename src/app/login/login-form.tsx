'use client'

import { useActionState } from 'react'

import { sendSignInLink, type LoginState } from './actions'

/**
 * The form. A client component only because it shows what happened after the
 * action ran; everything it does happens on the server.
 *
 * The success message deliberately does not say whether the address has an
 * account. See `sendSignInLink`.
 */

const INITIAL: LoginState = { status: 'idle' }

export function LoginForm() {
  const [state, action, pending] = useActionState(sendSignInLink, INITIAL)

  if (state.status === 'sent') {
    return (
      <p data-testid="login-sent" role="status" className="rounded-md bg-slate-100 p-4">
        If that address has an account, a sign-in link is on its way. It is good for one use.
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
        <p data-testid="login-error" role="alert" className="text-sm text-red-700">
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
