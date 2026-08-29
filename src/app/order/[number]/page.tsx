import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { findOrderNumber, redeemOrderForBuyer, standingOfOrder } from '@/lib/activation/order'
import {
  isPossibleOrderNumber,
  maskedOrderNumber,
  normaliseOrderNumber,
  ORDER_FORM_PATH,
  orderNumberSuffix,
} from '@/lib/activation/order-number'
import { noteOrderMiss, orderMissesExceeded } from '@/lib/activation/order-throttle'
import { currentBuyer } from '@/lib/supabase/buyer'

import { OrderSignIn } from './order-sign-in'

/**
 * Where a recognised Etsy order number lands: a purchase becomes an invitation.
 *
 * `/order` is the form and this is what it sends the browser to. Two pages
 * rather than one because THIS one has to be reachable by URL: it is where the
 * magic link comes back to, and a form that redeemed in place would have
 * nowhere to return to after sign-in. It is also the page a buyer can be sent
 * directly, which is what makes support a link rather than an instruction.
 *
 * ## Why redeeming happens on the GET
 *
 * The same two questions the claim page answers, with the same answers.
 *
 * Can anything but the buyer trigger it? No. Redeeming needs a signed-in
 * session, so the link scanners and preview fetchers that open URLs out of
 * emails and chat apps reach the signed-out branch and write nothing.
 *
 * What does a repeated GET do? The same thing as the first, which is the
 * requirement rather than a happy accident: a second tap on a phone must open
 * the invitation the first one made. `order_numbers.redeemed_event_id` records
 * which event a number created, so a used number resolves to it and nobody who
 * double-tapped is shown a used-number refusal about the thing they just
 * bought.
 *
 * A DIFFERENT account is the opposite case and gets the refusal, which is the
 * whole reason the list is single use: the first buyer to post their order
 * number publicly would otherwise give the template away to everyone.
 *
 * ## The URL carries a purchase
 *
 * Not a hundred-bit token like a claim link, and that is the difference this
 * design has to live with: an order number is short, printed on a receipt, and
 * enumerable. The throttle below bounds guessing
 * (src/lib/activation/order-throttle.ts) and the list bounds what a hit is
 * worth, which is one invitation, once. `no-referrer` and `noindex` for the
 * same reason the claim page has them, and `private, no-store` from
 * src/proxy.ts.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your invitation',
  robots: { index: false, follow: false },
  /*
   * The path holds the order number. A referrer header would hand it to any
   * host this page links out to, and on this list that number is what opens the
   * invitation.
   */
  referrer: 'no-referrer',
}

type PageProps = { params: Promise<{ number: string }> }

export default async function OrderNumberPage({ params }: PageProps) {
  const { number } = await params

  if (!isPossibleOrderNumber(number)) return <Unrecognised />

  /*
   * Counted here as well as on the form, because this page is a URL and a loop
   * that skipped the form would otherwise be uncounted. Misses rather than
   * attempts, and it fails open with no client address and with no database, so
   * a buyer who has paid is never refused by the thing that counts guesses.
   */
  if ((await orderMissesExceeded()).kind === 'too-many') return <TooMany />

  const lookup = await findOrderNumber(number)
  if (lookup.kind === 'unavailable') return <Unavailable />
  if (lookup.kind === 'unknown') {
    await noteOrderMiss()
    return <Unrecognised />
  }

  const buyer = await currentBuyer()

  if (buyer === null) {
    const standing = standingOfOrder(lookup.order)

    if (standing === 'revoked') return <Revoked />
    if (standing === 'lapsed') return <Lapsed />

    return standing === 'spent' ? (
      <AlreadyUsedSignedOut number={number} />
    ) : (
      <ReadyToOpen number={number} />
    )
  }

  const result = await redeemOrderForBuyer(lookup.order, buyer.userId)

  if (result.kind === 'created') redirect(`/dashboard/${result.eventId}/edit?claimed=1`)
  if (result.kind === 'spent' && result.mine) redirect(`/dashboard/${result.eventId}/edit`)

  if (result.kind === 'spent') return <UsedByAnother number={number} />
  if (result.kind === 'revoked') return <Revoked />
  if (result.kind === 'lapsed') return <Lapsed />
  return <Unavailable />
}

// The screens ----------------------------------------------------------------
//
// Every one of them is designed, for the same reason the guest 404 and expiry
// pages are: somebody reaches these at the moment they have just paid for
// something, and a default error page reflects on the shop they bought it from.

function ReadyToOpen({ number }: { readonly number: string }) {
  return (
    <Shell title="We found your order">
      <p data-testid="order-ready" className="text-slate-600">
        Enter the email address you used on your Etsy order. We will send you a link that brings you
        straight back here and opens your invitation. There is no password.
      </p>
      <OrderSignIn number={number} submitLabel="Send me a link" />
      <OrderLine number={number} />
    </Shell>
  )
}

function AlreadyUsedSignedOut({ number }: { readonly number: string }) {
  return (
    <Shell title="This invitation is already yours">
      <p data-testid="order-already" className="text-slate-600">
        That order number has been used, which means the invitation already exists. Sign in with the
        email address you ordered with and it will open.
      </p>
      <OrderSignIn number={number} submitLabel="Send me a sign-in link" />
      <OrderLine number={number} />
    </Shell>
  )
}

function UsedByAnother({ number }: { readonly number: string }) {
  return (
    <Shell title="That order number has already been used">
      <p data-testid="order-other-account" className="text-slate-600">
        It opened an invitation on a different email address, and an order number only opens one.
        Sign out and sign back in with the address you used on your Etsy order. If that was not you,
        reply to your order message and we will sort it out.
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-md bg-slate-900 p-3 text-white">
          Sign out
        </button>
      </form>
      <OrderLine number={number} />
    </Shell>
  )
}

function Unrecognised() {
  return (
    <Shell title="We cannot find that order number">
      <p data-testid="order-unknown" className="text-slate-600">
        Check it against the Order ID on your Etsy receipt. If it is right, an order placed in the
        last few hours may not have reached us yet: reply to your Etsy order message and we will
        open your invitation for you.
      </p>
      <TryAgain />
    </Shell>
  )
}

function TooMany() {
  return (
    <Shell title="We have paused the check">
      <p data-testid="order-throttled" className="text-slate-600">
        That is a lot of tries in a short time. Try again in a few minutes, or reply to your Etsy
        order message and we will open your invitation for you.
      </p>
    </Shell>
  )
}

function Revoked() {
  return (
    <Shell title="This order was cancelled">
      <p data-testid="order-revoked" className="text-slate-600">
        That order number was withdrawn, which usually means the order was refunded. If that is not
        what you expected, reply to your order message and we will sort it out.
      </p>
      <TryAgain />
    </Shell>
  )
}

function Lapsed() {
  return (
    <Shell title="This order has expired">
      <p data-testid="order-lapsed" className="text-slate-600">
        That order was time limited and its window has closed. Nothing is lost: reply to your order
        message and we will open your invitation for you.
      </p>
      <TryAgain />
    </Shell>
  )
}

function Unavailable() {
  return (
    <Shell title="We could not check that just now">
      <p data-testid="order-unavailable" className="text-slate-600">
        Something on our side is not answering. Your order number has not been used and nothing has
        been lost. Please try again in a few minutes.
      </p>
    </Shell>
  )
}

/**
 * The four characters `order_numbers.number_suffix` keeps in the clear.
 *
 * Support can find a row by them, so they are the part of the number worth
 * quoting in an email, and quoting four is what keeps the buyer from pasting
 * all ten into a message that goes somewhere else.
 */
function OrderLine({ number }: { readonly number: string }) {
  return (
    <p className="text-xs text-slate-500">
      If you need to ask us about this order, quote{' '}
      <code data-testid="order-suffix">
        {maskedOrderNumber(orderNumberSuffix(normaliseOrderNumber(number)))}
      </code>
      .
    </p>
  )
}

function TryAgain() {
  return (
    <p className="text-sm text-slate-600">
      <Link href={ORDER_FORM_PATH} className="underline">
        Try another order number
      </Link>
      , or{' '}
      <Link href="/dashboard" className="underline">
        open your dashboard
      </Link>
      .
    </p>
  )
}

function Shell({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  )
}
