import type { Metadata } from 'next'

import { GuestNotice } from '@/components/guest-notice'

/**
 * The designed 404 for /e/<slug>.
 *
 * It is a route level not-found rather than the app's global one, so that a
 * mistyped invitation link gets copy written for someone holding an invitation
 * rather than copy written for someone lost on a website. Next renders it at a
 * real 404 status, which is what a crawler and a chat app's link unfurler both
 * need to hear.
 */

export const metadata: Metadata = {
  title: 'Invitation',
  robots: { index: false, follow: false },
}

export default function GuestNotFound() {
  return <GuestNotice kind="not-found" />
}
