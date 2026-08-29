import type { Metadata } from 'next'
import Link from 'next/link'

import { OrderForm } from './order-form'

/**
 * `/order`: one public link, and the buyer types the number from their receipt.
 *
 * The captain's decision, taken twice and put to them a second time with
 * firstmate's objection attached. It is settled: this is how a paid buyer
 * proves they paid. Checking a number against Etsy live needs Open API v3
 * approval, which does not exist here, so the site checks it against a list the
 * captain loads from their own dashboard in batches
 * (`scripts/load-orders.ts`, docs/orders.md). An unknown number is refused.
 *
 * This is the fourth activation link and the mistake to avoid is the same one
 * as ever, conflating them:
 *
 *   `/t/<id>`        renders a template, creates nothing, meant to spread
 *   `/t/<id>/use`    mints anybody's copy. FREE LAUNCH ONLY
 *   `/claim/<code>`  spends a code this platform minted and put in an order message
 *   `/order`         this: the buyer types a number they already have
 *
 * `/order` and `/claim` are both the paid route, and they can both be live at
 * once: a code is what the captain sends when something has gone wrong, and a
 * typed order number is what everybody else uses. `/t/<id>/use` is the one that
 * has to be withdrawn before the first paid listing publishes, because an open
 * copy link plus a price is a free product.
 *
 * No `force-dynamic` and no session read: this page is a form and a paragraph,
 * the same for everybody. What it must never be is CACHED BY ANYTHING SHARED,
 * because the page one segment down carries a purchase in its URL, and
 * `src/proxy.ts` puts the whole `/order` prefix behind `private, no-store`
 * rather than leaving the two to be told apart.
 */

export const metadata: Metadata = {
  title: 'Open your invitation',
  description: 'Enter your Etsy order number to open the invitation you bought.',
}

export default function OrderPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Open your invitation</h1>

      <p data-testid="order-intro" className="text-slate-600">
        Enter the order number from your Etsy receipt. It opens the invitation you bought, once, and
        then it is yours to fill in and share.
      </p>

      <OrderForm />

      <p className="text-xs text-slate-500">
        Your order number is on your Etsy receipt and in your Etsy purchases list, shown as the
        Order ID.
      </p>

      <p className="text-sm text-slate-600">
        Already opened it?{' '}
        <Link href="/dashboard" className="underline">
          Open your dashboard
        </Link>
        .
      </p>
    </main>
  )
}
