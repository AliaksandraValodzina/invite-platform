import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlockList } from '@/components/blocks'
import { GuestNotice } from '@/components/guest-notice'
import { ThemeScope } from '@/components/theme-scope'
import { readSiteConfig } from '@/lib/env'
import { resolveEventSchedule, type ResolvedSchedule } from '@/lib/event/time'
import { buildEventShareMetadata, ogCardFields, ogCardVersion } from '@/lib/og'
import { loadGuestPage } from '@/lib/supabase/events'
import { resolveEventPage, type ResolvedPage, type TemplateBlock } from '@/lib/template'

import { withWebFonts } from '../../fonts'
import { submitRsvp } from './actions'

/**
 * The guest page. One slug, one event, one of four serving states.
 *
 * What decides which state: `public.event_state_at`, read as the computed
 * column `events.serving_state` (see src/lib/supabase/events.ts). Nothing here
 * compares timestamps, because a second implementation of that comparison is a
 * second answer to "is this event still live", and they would disagree on the
 * day it mattered.
 *
 *   unpublished  designed notice, no content
 *   live         the full page, RSVPs open
 *   grace        the full page, RSVPs closed. Hosting has lapsed, so the link a
 *                guest already has still works and no new PII is collected
 *   expired      designed notice, no content
 *
 * A slug with no row calls `notFound()`, which renders the designed 404 next to
 * this file at a real 404 status.
 *
 * Two exports at the bottom of this comment do the caching, and they are the
 * reason this route is shaped the way it is rather than declared
 * `force-dynamic` like the preview route. `revalidate` bounds how long a guest
 * can be shown the wrong serving state, which makes it a privacy control before
 * it is a speed one (src/lib/serving/cache.ts and docs/serving.md), and
 * `generateStaticParams` returning nothing is what puts this route on that
 * path at all: without it Next renders every request fresh and streams the
 * response, and a streamed response carries no ETag, so every browser
 * revalidation costs a whole page instead of a 304. Measured, not assumed. The
 * header itself is set in src/proxy.ts and read off the wire by
 * tests/e2e/caching.spec.ts.
 */

/*
 * The literal is not a preference. Next reads this export by static analysis at
 * build time and refuses an imported constant ("Invalid segment configuration
 * export detected"), so the number cannot be shared with
 * src/lib/serving/cache.ts by an import. It is held to that module's value by
 * tests/unit/serving/page-revalidate.test.ts instead, which reads this file.
 */
export const revalidate = 60

export function generateStaticParams(): { slug: string }[] {
  return []
}

type PageProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const outcome = await loadGuestPage(slug)

  /*
   * A page that is not serving an invitation says nothing about the event, and
   * that includes its title. An unpublished event's slug is held by the buyer
   * and an expired one's is in every guest's chat history, so neither is a
   * secret, but neither is a thing to put in a browser tab or a link preview.
   */
  if (outcome.kind !== 'found' || (outcome.state !== 'live' && outcome.state !== 'grace')) {
    return { title: 'Invitation', robots: { index: false, follow: false } }
  }

  const page = resolveEventPage(outcome.documents)
  if (!page.ok) return { title: 'Invitation', robots: { index: false, follow: false } }

  const { siteUrl } = readSiteConfig()
  const fields = ogCardFields(outcome.event, page.page.blocks)

  const share = buildEventShareMetadata({
    siteUrl,
    slug: outcome.event.slug,
    title: fields.title,
    startsAtLocal: fields.startsAt,
    kicker: fields.kicker,
    venue: fields.venue,
    cardVersion: ogCardVersion(fields, page.page.tokens),
  })

  return {
    title: share.title,
    description: share.description,
    openGraph: {
      type: share.openGraph.type,
      url: share.openGraph.url,
      title: share.openGraph.title,
      description: share.openGraph.description,
      images: share.openGraph.images.map((image) => ({ ...image })),
    },
    twitter: {
      card: share.twitter.card,
      title: share.twitter.title,
      description: share.twitter.description,
      images: [...share.twitter.images],
    },
    /*
     * An invitation is shared into a chat, not published to the web. It carries
     * a couple's names, their date and their venue, and a buyer who pasted a
     * link to twelve people did not ask for a search result. The share card
     * itself is noindex for the same reason, and neither setting stops a chat
     * app fetching the page to build its preview.
     */
    robots: { index: false, follow: false },
  }
}

export default async function GuestPage({ params }: PageProps) {
  const { slug } = await params
  const outcome = await loadGuestPage(slug)

  if (outcome.kind === 'not-found') notFound()
  if (outcome.kind === 'unavailable') return <GuestNotice kind="unavailable" />
  if (outcome.state === 'unpublished') return <GuestNotice kind="unpublished" />
  if (outcome.state === 'expired') return <GuestNotice kind="expired" />

  const page = resolveEventPage(outcome.documents)
  if (!page.ok) return <GuestNotice kind="unavailable" />

  const schedule = resolveEventSchedule({
    startsAtLocal: outcome.event.startsAtLocal,
    endsAtLocal: outcome.event.endsAtLocal,
    timeZone: outcome.event.timeZone,
  })
  if (schedule === null) return <GuestNotice kind="unavailable" />

  return renderPage(page.page, schedule, outcome.state)
}

function renderPage(
  page: ResolvedPage<TemplateBlock>,
  schedule: ResolvedSchedule,
  state: 'live' | 'grace'
) {
  return (
    /*
     * `withWebFonts` swaps the head of each font stack for the self hosted face
     * of the same name, applied here rather than inside ThemeScope so the
     * component that turns tokens into CSS stays free of anything Next
     * specific. The preview route does the same thing in the same place.
     */
    <ThemeScope tokens={withWebFonts(page.tokens)}>
      <BlockList
        blocks={page.blocks}
        context={{
          schedule,
          nowMs: serverNow(),
          rsvp: {
            // RSVPs close at hosting expiry. Collecting new guest PII against
            // lapsed hosting is the thing grace exists to avoid, not a side
            // effect of it.
            phase: state === 'live' ? 'open' : 'closed',
            submit: submitRsvp,
          },
        }}
      />
    </ThemeScope>
  )
}

/**
 * The server's clock at render time, which under this route's cache is the
 * clock of whichever render produced the copy being served, up to a minute ago.
 * That is what the countdown is contracted to survive: docs/blocks.md records
 * that the clock in the browser is an external store rather than state set in
 * an effect, so the first client render uses this number and hydrates exactly,
 * and the browser's own clock takes over immediately afterwards.
 *
 * Read here rather than inside a component for the same reason the preview
 * route reads it here: a component that calls Date.now() inline is the shape
 * that goes wrong the moment something re-renders it.
 */
function serverNow(): number {
  return Date.now()
}
