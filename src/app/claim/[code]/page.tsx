import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { claimForBuyer, findActivationCode, standingOf } from '@/lib/activation/claim'
import { formatActivationCode, isPossibleActivationCode } from '@/lib/activation/code'
import { currentBuyer } from '@/lib/supabase/buyer'

import { ClaimSignIn } from './claim-sign-in'

/**
 * Where a claim link lands: an Etsy order becomes an invitation the buyer owns.
 *
 * Two link types exist and this is the single-use one. The other is
 * `/t/<templateId>`, which renders a template, copies nothing and is meant to
 * spread. Conflating them is the mistake this product cannot afford: an open
 * "use this template" link turns one sale into unlimited invitations, because
 * here the invitation IS the purchase rather than a feature of a subscription.
 *
 * ## Why claiming happens on the GET
 *
 * Creating a row while rendering a page is not something to do casually, and
 * there are two questions worth answering out loud.
 *
 * Can something other than the buyer trigger it? No. A claim needs a signed-in
 * session, so the link scanners and preview fetchers that open URLs out of
 * emails and chat apps reach the signed-out branch of this page and write
 * nothing. The mailbox is the deliberate act, and nothing but the buyer has it.
 *
 * What does a repeated GET do? The same thing as the first, and this is the
 * requirement rather than a happy accident: a second tap on a phone must open
 * the invitation they already have. `activation_codes.redeemed_event_id`
 * records which event a code created, so a spent code resolves to it. Nobody
 * who double-tapped is ever shown a spent-code error, because to somebody who
 * has just paid that reads as having lost the purchase.
 *
 * Given both, a confirmation step between the link and the editor would buy
 * nothing and cost the thing the captain asked for on 2026-08-23: the buyer
 * clicks a link and is in their invitation, Canva-style, having typed no code.
 *
 * `force-dynamic`, and `private, no-store` from src/proxy.ts, because the URL
 * carries a bearer token and the answer says what it is still worth.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your invitation',
  robots: { index: false, follow: false },
  /*
   * The path holds the code. A referrer header would hand it to any host this
   * page links out to, which for a bearer token is the whole of the secret.
   */
  referrer: 'no-referrer',
}

type PageProps = { params: Promise<{ code: string }> }

export default async function ClaimPage({ params }: PageProps) {
  const { code } = await params

  if (!isPossibleActivationCode(code)) return <Unrecognised />

  const lookup = await findActivationCode(code)
  if (lookup.kind === 'unavailable') return <Unavailable />
  if (lookup.kind === 'unknown') return <Unrecognised />

  const buyer = await currentBuyer()

  if (buyer === null) {
    const standing = standingOf(lookup.code)

    if (standing === 'revoked') return <Revoked />
    if (standing === 'lapsed') return <Lapsed />

    return standing === 'spent' ? (
      <AlreadyClaimedSignedOut code={code} />
    ) : (
      <ReadyToClaim code={code} />
    )
  }

  const result = await claimForBuyer(lookup.code, buyer.userId)

  if (result.kind === 'created') redirect(`/dashboard/${result.eventId}/edit?claimed=1`)
  if (result.kind === 'spent' && result.mine) redirect(`/dashboard/${result.eventId}/edit`)

  if (result.kind === 'spent') return <ClaimedByAnother />
  if (result.kind === 'revoked') return <Revoked />
  if (result.kind === 'lapsed') return <Lapsed />
  return <Unavailable />
}

// The screens ----------------------------------------------------------------
//
// Every one of them is designed, for the same reason the guest 404 and expiry
// pages are: somebody reaches these at the moment they have just paid for
// something, and a default error page reflects on the shop they bought it from.

function ReadyToClaim({ code }: { readonly code: string }) {
  return (
    <Shell title="Claim your invitation">
      <p data-testid="claim-ready" className="text-slate-600">
        Enter the email address you used on your order. We will send you a link that brings you
        straight back here and opens your invitation. There is no password.
      </p>
      <ClaimSignIn code={code} submitLabel="Send me a link" />
      <CodeLine code={code} />
    </Shell>
  )
}

function AlreadyClaimedSignedOut({ code }: { readonly code: string }) {
  return (
    <Shell title="This invitation is already yours">
      <p data-testid="claim-already" className="text-slate-600">
        This link has been used, which means the invitation already exists. Sign in with the email
        address you ordered with and it will open.
      </p>
      <ClaimSignIn code={code} submitLabel="Send me a sign-in link" />
      <CodeLine code={code} />
    </Shell>
  )
}

function ClaimedByAnother() {
  return (
    <Shell title="This link belongs to another account">
      <p data-testid="claim-other-account" className="text-slate-600">
        This invitation was claimed with a different email address. Sign out and sign back in with
        the address you used on your order.
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-md bg-slate-900 p-3 text-white">
          Sign out
        </button>
      </form>
    </Shell>
  )
}

function Unrecognised() {
  return (
    <Shell title="That is not a claim link">
      <p data-testid="claim-unknown" className="text-slate-600">
        Nothing here matches that link. Check that you copied the whole of it from your order
        message, including everything after the last slash.
      </p>
      <Help />
    </Shell>
  )
}

function Revoked() {
  return (
    <Shell title="This link has been cancelled">
      <p data-testid="claim-revoked" className="text-slate-600">
        This activation was cancelled, which usually means the order was refunded. If that is not
        what you expected, reply to your order message and we will sort it out.
      </p>
      <Help />
    </Shell>
  )
}

function Lapsed() {
  return (
    <Shell title="This link has expired">
      <p data-testid="claim-lapsed" className="text-slate-600">
        This activation was time limited and its window has closed. Nothing is lost: reply to your
        order message and we will send you a new link.
      </p>
      <Help />
    </Shell>
  )
}

function Unavailable() {
  return (
    <Shell title="We could not check that link">
      <p data-testid="claim-unavailable" className="text-slate-600">
        Something on our side is not answering. Your link has not been used and nothing has been
        lost. Please try again in a few minutes.
      </p>
    </Shell>
  )
}

/**
 * The four characters support can find a buyer by.
 *
 * `activation_codes.code_prefix` holds exactly these in the clear so that a
 * person reading their code out over email can be found, and printing them here
 * is what makes that useful: it is the part of the link worth quoting.
 */
function CodeLine({ code }: { readonly code: string }) {
  return (
    <p className="text-xs text-slate-500">
      If you need to ask us about this order, quote{' '}
      <code data-testid="claim-code-prefix">{formatActivationCode(code).slice(0, 4)}</code>.
    </p>
  )
}

function Help() {
  return (
    <p className="text-sm text-slate-600">
      Already have an invitation on this account?{' '}
      <Link href="/dashboard" className="underline">
        Open your dashboard
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
