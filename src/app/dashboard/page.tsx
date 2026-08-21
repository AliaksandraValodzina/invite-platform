import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatEventDate, parseWallClock } from '@/lib/event/time'
import { currentBuyer, loadBuyerEvents } from '@/lib/supabase/buyer'

/**
 * The buyer's events, and how many people have replied.
 *
 * `force-dynamic` here for the reason it would be wrong on a guest page: this
 * is one person's list of their own events, assembled from their own session,
 * and there is nothing about it worth serving from an edge. The header that
 * says so is set in src/proxy.ts.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your invitations',
  robots: { index: false, follow: false },
}

const STATE_WORDS: Record<string, string> = {
  unpublished: 'Not published',
  live: 'Live, replies open',
  grace: 'Hosting lapsed, replies closed',
  expired: 'Expired',
}

export default async function DashboardPage() {
  const buyer = await currentBuyer()
  if (buyer === null) redirect('/login')

  const events = await loadBuyerEvents(buyer)

  if (events === null) {
    return (
      <Shell>
        <p data-testid="dashboard-unavailable" className="rounded-md bg-slate-100 p-4">
          Your invitations could not be loaded just now. Nothing is lost; please try again in a
          moment.
        </p>
      </Shell>
    )
  }

  if (events.length === 0) {
    return (
      <Shell>
        <p data-testid="dashboard-empty" className="rounded-md bg-slate-100 p-4">
          There are no invitations on this account yet.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <ul data-testid="event-list" className="flex flex-col gap-4">
        {events.map((event) => (
          <li key={event.id} className="rounded-md border border-slate-200 p-4">
            <h2 className="text-lg font-medium">{event.title}</h2>
            <p className="text-sm text-slate-600">{eventDay(event.startsAtLocal)}</p>
            <p className="text-sm text-slate-600">{STATE_WORDS[event.state] ?? event.state}</p>

            <p data-testid={`replies-${event.slug}`} className="mt-2 text-sm">
              {/*
               * Two numbers, because they answer two different questions and a
               * caterer only ever wants the second one. Replies is how many
               * people wrote back; guests is how many are actually coming,
               * which is `sum(party_size)` and counts a decline as nobody.
               */}
              <strong>{event.replies}</strong> {event.replies === 1 ? 'reply' : 'replies'},{' '}
              <strong>{event.attending}</strong> coming
            </p>

            <p className="mt-2 flex gap-4 text-sm">
              <Link href={`/dashboard/${event.id}/edit`} className="underline">
                Edit
              </Link>
              <Link href={`/dashboard/${event.id}/replies`} className="underline">
                Read the replies
              </Link>
              <Link href={`/e/${event.slug}`} className="underline">
                Open the invitation
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

/**
 * The event's own day, in its own words.
 *
 * The wall clock is the source of truth (docs/data-model.md), so this formats
 * the local pair rather than an instant: a buyer in London looking at a Sydney
 * wedding should read the date the wedding is on, not the date it is on for
 * them.
 */
function eventDay(startsAtLocal: string): string {
  const wallClock = parseWallClock(startsAtLocal)
  return wallClock === null ? '' : formatEventDate(wallClock)
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your invitations</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </main>
  )
}
