import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlockList } from '@/components/blocks'
import { EnvelopeCover, envelopeHeadline } from '@/components/envelope'
import { GuestNotice } from '@/components/guest-notice'
import { SiteFooter } from '@/components/site-footer'
import { ThemeScope } from '@/components/theme-scope'
import { templateCopyPath, templatePreviewUrl } from '@/lib/activation/code'
import { readSiteConfig } from '@/lib/env'
import { resolveEventSchedule } from '@/lib/event/time'
import { PREVIEW_QUESTIONS } from '@/lib/preview/fixture'
import { loadTemplatePreview } from '@/lib/supabase/templates'
import { resolveEventPage } from '@/lib/template'

import { withWebFonts } from '../../fonts'
import { templatePreviewRsvpSubmit } from './actions'

/**
 * `/t/<templateId>`: a template, rendered as a guest would meet it.
 *
 * This page may be held by anybody: it goes in the Etsy listing and on social,
 * it renders a design, and it still creates nothing. Copying is one segment
 * below at `./use/page.tsx`, which is a separate route because everything about
 * it is the opposite: signed in, dynamic and never cached. Nothing on this page
 * varies by who is asking, which is what lets an edge hold it.
 *
 * The strip at the bottom carries the same call to action for everybody,
 * signed in or not, and it is a plain anchor rather than a `Link`: Next
 * prefetches a `Link`, and the route it points at makes a copy on the GET.
 *
 * **A visitor who is not signed in still sees the whole invitation.** The
 * preview is the sales pitch, and putting sign-in in front of it would be
 * putting a door in front of the shop window.
 *
 * What is on screen is the template's own defaults through the same
 * `resolveEventPage` a guest page uses, so a preview cannot quietly drift from
 * what a buyer would receive. There is no event, so:
 *
 *   the date        a placeholder derived from today, rounded to the day so a
 *                   cached copy stays truthful for as long as it is held
 *   the questions   the shipped set, as the guided form would create them
 *   the reply form  drawn, and refuses on send. See ./actions.ts
 *
 * Cached and indexable, both deliberately. It carries no personal information
 * at all: the words on it are the template's, which is why it is the one page
 * in this product that is meant to spread. Guest pages are the opposite
 * decision for the opposite reason (src/app/e/[slug]/page.tsx).
 */

/*
 * A literal, because Next reads route segment config by static analysis and
 * refuses an imported constant. It is held to
 * TEMPLATE_PREVIEW_REVALIDATE_SECONDS by
 * tests/unit/serving/template-preview-revalidate.test.ts.
 */
export const revalidate = 300

/**
 * Empty, and it is what puts this route on the cached path at all.
 *
 * Without it Next renders every request fresh and streams the response, and the
 * header on the wire is `private, no-store` rather than anything an edge can
 * hold. Measured on a production build, not assumed, and it is the same finding
 * `src/app/e/[slug]/page.tsx` records for the guest page. A marketing link that
 * reaches the origin for every visitor is the one page here where that is
 * simply waste.
 */
export function generateStaticParams(): { templateId: string }[] {
  return []
}

type PageProps = { params: Promise<{ templateId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { templateId } = await params
  const outcome = await loadTemplatePreview(templateId)

  if (outcome.kind !== 'found') {
    return { title: 'Invitation template', robots: { index: false, follow: false } }
  }

  const { siteUrl } = readSiteConfig()
  const url = templatePreviewUrl(siteUrl, templateId)
  const description =
    'A preview of this invitation design. Open it on a phone: this is what your guests see.'

  return {
    title: outcome.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title: outcome.name, description },
    twitter: { card: 'summary_large_image', title: outcome.name, description },
  }
}

export default async function TemplatePreviewPage({ params }: PageProps) {
  const { templateId } = await params
  const outcome = await loadTemplatePreview(templateId)

  if (outcome.kind === 'not-found') notFound()
  if (outcome.kind === 'unavailable') return <GuestNotice kind="unavailable" />

  const page = resolveEventPage(outcome.documents)
  if (!page.ok) return <GuestNotice kind="unavailable" />

  const schedule = resolveEventSchedule(placeholderSchedule())
  if (schedule === null) return <GuestNotice kind="unavailable" />

  return (
    <>
      <ThemeScope
        tokens={withWebFonts(page.page.tokens)}
        cover={
          <EnvelopeCover
            config={page.page.envelope}
            headline={envelopeHeadline(page.page.blocks)}
          />
        }
      >
        <BlockList
          blocks={page.page.blocks}
          context={{
            schedule,
            nowMs: serverNow(),
            rsvp: {
              phase: 'open',
              questions: PREVIEW_QUESTIONS,
              submit: templatePreviewRsvpSubmit,
            },
          }}
        />
      </ThemeScope>

      {/*
       * Outside the theme scope on purpose. This strip is the product talking,
       * not the invitation, and giving it the theme's palette would make it
       * read as part of the design somebody is looking at. It sits under the
       * envelope until the envelope opens, which is the right order: the
       * arrival is the thing being sold.
       */}
      <footer
        data-testid="template-preview-footer"
        className="flex flex-col items-center gap-4 bg-slate-900 px-4 py-8 text-center text-sm text-slate-200"
      >
        <p>
          This is a preview of an invitation design. The names, date and place are examples. Nothing
          typed here is sent or saved.
        </p>

        {/*
         * The same link for everybody, which is the whole of the captain's
         * decision on 2026-08-24: entitlement is handled at the account level
         * rather than by holding a secret, because a link that has to stay
         * secret to be safe is not a link you can put on an Etsy listing.
         *
         * A plain anchor, not `Link`. Next prefetches a `Link`, and this points
         * at a route that mints a copy on the GET, so a prefetch would be a
         * press nobody made.
         */}
        <a
          data-testid="template-copy-link"
          href={templateCopyPath(templateId)}
          className="rounded-md bg-white px-5 py-3 font-medium text-slate-900"
        >
          Make this invitation yours
        </a>

        <p className="text-slate-400">Free, and yours to fill in. No card, no password.</p>
      </footer>

      {/*
       * This page is what an Etsy listing links to, so it is a front door as
       * much as the home page is, and a front door is where a buyer is asked
       * for a privacy statement. Separate from the strip above because that one
       * is the offer and this one is the paperwork.
       */}
      <SiteFooter />
    </>
  )
}

/**
 * The server's clock at render time, read here rather than inside the component
 * for the same reason the guest page and the block preview read it here: a
 * component that calls `Date.now()` inline is the shape that goes wrong the
 * moment something re-renders it.
 */
function serverNow(): number {
  return Date.now()
}

/**
 * A date to count down to, when there is no event to ask.
 *
 * Rounded to the start of today in UTC and then pushed out, so every render
 * within a day agrees. That matters because this page is cached: a target
 * computed to the second would mean the copy served at four o'clock counting
 * down to a moment three hundred milliseconds different from the one served at
 * noon, for no reason anybody could see.
 *
 * The time zone is the one the design work used, because the placeholder words
 * on the page come from the same sample. It is a stand-in and the page says so.
 */
const PREVIEW_DAYS_AHEAD = 120

function placeholderSchedule(): {
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
} {
  const today = new Date()
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + PREVIEW_DAYS_AHEAD)
  )
  const pad = (part: number) => String(part).padStart(2, '0')
  const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`

  return {
    startsAtLocal: `${date}T16:00:00`,
    endsAtLocal: `${date}T23:30:00`,
    timeZone: 'Australia/Sydney',
  }
}
