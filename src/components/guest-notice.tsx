/**
 * The four things a guest can be shown instead of an invitation.
 *
 * AGENTS.md: "404, expired and unpublished states are designed, never default
 * error pages. Guests hit them at emotional moments and it reflects on the
 * buyer's shop reviews." Someone opening a link from a group chat at the moment
 * they were about to reply should not meet a stack trace or a browser's own
 * "this page isn't working".
 *
 * These are platform pages, not invitations, and they are deliberately drawn in
 * the app's own type rather than in the event's theme. Two reasons, and the
 * second is the one that decides it. A 404 has no event and therefore no theme,
 * so theming the other three would make the set inconsistent for no gain. And
 * an expired page must not carry the couple's names, their date or their
 * palette: the expiry state exists precisely because the hosting they paid for
 * has lapsed, and dressing it in their invitation would be showing the thing it
 * is refusing to show.
 *
 * That is also why no notice names the event. Every one of them is reachable by
 * anyone holding the link, including after the buyer has stopped paying for it.
 */

import { SiteFooter } from '@/components/site-footer'

const NOTICES = {
  'not-found': {
    eyebrow: 'Invitation',
    heading: 'That link does not lead anywhere',
    body: 'The address may have been typed slightly differently, or this invitation may never have existed. Ask whoever sent it to share the link again.',
  },
  unpublished: {
    eyebrow: 'Invitation',
    heading: 'This invitation is not ready yet',
    body: 'The page has been set up but not published. If it is yours, publishing it is what makes this address work. If somebody sent it to you, they are still finishing it.',
  },
  expired: {
    eyebrow: 'Invitation',
    heading: 'This invitation has closed',
    body: 'The event has passed and this page is no longer being hosted. If you still need the details, ask whoever sent you the invitation.',
  },
  unavailable: {
    eyebrow: 'Invitation',
    heading: 'This page could not be loaded',
    body: 'Something went wrong on our side, not on yours. Please try again in a minute.',
  },
} as const

export type GuestNoticeKind = keyof typeof NOTICES

export const GUEST_NOTICE_KINDS = Object.keys(NOTICES) as GuestNoticeKind[]

export function GuestNotice({ kind }: { readonly kind: GuestNoticeKind }) {
  const notice = NOTICES[kind]

  /*
   * The footer is here rather than on each route that renders a notice, so a
   * fifth state cannot be added without it. A guest who was sent a link to an
   * expired or unpublished invitation has already replied to something, or is
   * about to, and this is the only page in front of them: it is the wrong place
   * to be the one page with no way to the privacy statement.
   */
  return (
    <div className="flex min-h-dvh flex-col">
      <main
        data-testid="guest-notice"
        data-notice={kind}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16"
      >
        <p className="text-xs tracking-[0.2em] text-slate-500 uppercase">{notice.eyebrow}</p>

        <h1 className="mt-4 font-serif text-3xl leading-tight text-balance text-slate-900">
          {notice.heading}
        </h1>

        <hr className="mt-6 w-12 border-t border-slate-300" />

        <p className="mt-6 text-base leading-relaxed text-pretty text-slate-600">{notice.body}</p>
      </main>

      <SiteFooter />
    </div>
  )
}
