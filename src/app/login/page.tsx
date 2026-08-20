import type { Metadata } from 'next'

import { LoginForm } from './login-form'

/**
 * Where a buyer signs in.
 *
 * One field and no password. A buyer arrives once from an Etsy order and comes
 * back three or four times over a year, which is exactly the interval at which
 * everybody resets a password. A link to the address that received the order is
 * both the thing they can always do and the thing somebody else cannot.
 */

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-slate-600">
        Enter the email address you used on your order and we will send you a link. There is no
        password.
      </p>
      <LoginForm />
    </main>
  )
}
