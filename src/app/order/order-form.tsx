'use client'

import { useActionState } from 'react'

import { findOrder, type OrderFormState } from './actions'

/**
 * The order number field.
 *
 * `inputMode="numeric"` rather than `type="number"`, on purpose. An order number
 * is an identifier that happens to be digits, not a quantity: a number input
 * would offer a spinner, drop leading zeros and let a scroll wheel change what
 * somebody typed.
 *
 * The refusal is rendered beside the field rather than on another page, and the
 * field keeps what was typed, because the commonest reason to be here twice is
 * one wrong digit.
 */

const INITIAL: OrderFormState = { status: 'idle' }

export function OrderForm() {
  const [state, action, pending] = useActionState(findOrder, INITIAL)

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="order" className="text-sm text-slate-600">
        Etsy order number
      </label>
      <input
        id="order"
        name="order"
        type="text"
        required
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        defaultValue={state.typed ?? ''}
        aria-describedby={state.status === 'idle' ? undefined : 'order-error'}
        className="rounded-md border border-slate-300 p-3 text-lg tracking-wider"
      />

      {state.status !== 'idle' && (
        <p id="order-error" data-testid="order-error" role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 p-3 text-white disabled:opacity-60"
      >
        {pending ? 'Checking' : 'Open my invitation'}
      </button>
    </form>
  )
}
