import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { copyTemplateForBuyer } from '@/lib/activation/copy'
import { templatePreviewPath } from '@/lib/activation/code'
import { currentBuyer } from '@/lib/supabase/buyer'
import { findCopyableTemplate } from '@/lib/supabase/templates'

import { CopySignIn } from './copy-sign-in'

/**
 * `/t/<templateId>/use`: the same link for everybody, and it makes your own copy.
 *
 * The captain's decision of 2026-08-24, in their words: "LET'S MAKE one link
 * for all for now", paired with releasing the first template free. Canva's
 * shape, and the reason to take it is not the shape: it is that a link which has
 * to stay secret to be safe is not a link you can put on an Etsy listing.
 *
 * **This route is deliberately temporary and must not outlive the free launch.**
 * An open copy link plus a price is a free product, so this must not still be
 * the active route when the first PAID listing publishes.
 * `ip-decision-order-verification` was the decision that replaces it and it is
 * now built: `/order` takes a typed Etsy order number and checks it against the
 * captain's own list (docs/orders.md). What is left here is a withdrawal, not a
 * decision. `/claim/<code>`, `scripts/issue-codes.ts` and `activation_codes`
 * are untouched. See src/lib/activation/copy.ts and docs/activation.md.
 *
 * ## The preview keeps no door in front of it
 *
 * `/t/<templateId>` is the sales pitch: public, cached, indexed, and readable
 * with no session at all. That is why copying is a second route rather than a
 * branch inside the first. A page that rendered differently for a signed-in
 * visitor could not be served from an edge, and the invitation somebody was
 * shown is the whole of what makes them want one.
 *
 * ## Why the copy happens on the GET
 *
 * Same question the claim page answers, and a different answer to one half of
 * it, so it is worth writing out rather than pointing at.
 *
 * Can anything but a person trigger it? A copy needs a signed-in session, so
 * the link scanners and chat previewers that open URLs reach the signed-out
 * branch and write nothing. Unlike a claim link, though, this URL is public and
 * meant to spread, so a signed-in person may reach it without meaning to.
 *
 * What does that cost? A draft. Copies and drafts are unlimited by the same
 * decision that opened this link, an unpublished event is never in front of a
 * guest, and hosting is only spent on a published one. So the cost of the
 * accident is a row in somebody's own dashboard that they can ignore, and the
 * cost of the alternative is a confirmation step between signing in and being
 * in your invitation, which is where people are lost.
 *
 * The link from the preview is a plain anchor rather than a `Link` for exactly
 * this reason: Next prefetches a `Link`, and a prefetch is a GET nobody pressed.
 *
 * The same answer covers the two neighbours of that question, and both are
 * worth naming rather than leaving for somebody to find. The session cookie is
 * `SameSite=Lax`, so a top level navigation from another site does carry it,
 * which means a page anywhere can send a signed-in visitor here and leave a
 * draft behind. And nothing rate limits a signed-in visitor who simply asks a
 * thousand times. Both produce the same thing: draft rows on the asker's own
 * account, unpublished, invisible to every guest, and costing no hosting. What
 * they cannot produce is a second published invitation, which is the limit that
 * actually guards the money (`public.events_publish_limit`).
 *
 * `force-dynamic`, and `private, no-store` from src/proxy.ts, because the
 * answer depends entirely on who is asking.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Make this invitation yours',
  /*
   * The opposite of the preview one segment up, which is meant to be indexed
   * and to spread. This page is a step in a flow and a search result pointing
   * at it would put a sign-in form where the invitation should be.
   */
  robots: { index: false, follow: false },
}

type PageProps = { params: Promise<{ templateId: string }> }

export default async function UseTemplatePage({ params }: PageProps) {
  const { templateId } = await params

  const template = await findCopyableTemplate(templateId)
  if (template.kind === 'not-found') notFound()
  if (template.kind === 'unavailable') return <Unavailable templateId={templateId} />

  const buyer = await currentBuyer()

  if (buyer === null) {
    return (
      <Shell title="Make this invitation yours">
        <p data-testid="copy-ready" className="text-slate-600">
          <strong>{template.template.name}</strong> is yours to fill in and share. Enter your email
          address and we will send you a link that brings you straight back here and opens your own
          copy. There is no password and nothing to pay.
        </p>
        <CopySignIn templateId={templateId} />
        <BackToPreview templateId={templateId} />
      </Shell>
    )
  }

  const copied = await copyTemplateForBuyer(templateId, buyer.userId)

  if (copied.kind === 'copied') redirect(`/dashboard/${copied.eventId}/edit?claimed=1`)
  if (copied.kind === 'not-found') notFound()

  return <Unavailable templateId={templateId} />
}

// The screens ----------------------------------------------------------------

function Unavailable({ templateId }: { readonly templateId: string }) {
  return (
    <Shell title="We could not open that just now">
      <p data-testid="copy-unavailable" className="text-slate-600">
        Something on our side is not answering, and nothing has been created. Please try again in a
        few minutes.
      </p>
      <BackToPreview templateId={templateId} />
    </Shell>
  )
}

function BackToPreview({ templateId }: { readonly templateId: string }) {
  return (
    <p className="text-sm text-slate-600">
      <Link href={templatePreviewPath(templateId)} className="underline">
        Look at the invitation again
      </Link>
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
