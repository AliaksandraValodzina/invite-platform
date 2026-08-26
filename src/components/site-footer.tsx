import Link from 'next/link'

/**
 * The way to the privacy statement and the terms, from every page a stranger
 * can arrive on.
 *
 * Both documents existed before this component did, and neither was reachable
 * without already knowing the path. That is the wrong shape for a service that
 * holds guests' names, contact details and dietary notes: the people described
 * by the privacy statement never signed up for anything, so they cannot be
 * expected to guess at `/privacy`.
 *
 * It is drawn in the app's own type rather than in an event's theme, and the
 * reason is the one the template page's footer already gives: this strip is the
 * product talking, not the invitation, so a themed one would read as part of
 * the design somebody was sent. On the guest page it is rendered outside
 * `ThemeScope` for exactly that reason, which also keeps it out of the block
 * rule's way: no token can be missing from something that never asks for one.
 *
 * The rule and the border are not decoration. Under a dark theme this strip
 * would otherwise read as a page that failed to paint, so it says instead that
 * the invitation has ended and the site has begun. That is the same thing the
 * template page's dark slab does under a pale design, in the other direction.
 *
 * It names Mirthly because the links go to documents about what Mirthly does
 * with a guest's reply, and a guest who has never heard of us should be able to
 * see whose statement they are about to read. It says nothing else: what the
 * front page should say beyond its one sentence is the captain's to write.
 */
export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-slate-200 bg-white px-4 py-8 text-sm text-slate-500"
    >
      <span>Mirthly</span>
      <Link href="/privacy" className="underline">
        Privacy
      </Link>
      <Link href="/terms" className="underline">
        Terms
      </Link>
    </footer>
  )
}
