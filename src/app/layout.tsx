import type { Metadata, Viewport } from 'next'

import { readSiteConfig } from '@/lib/env'

import './globals.css'

/**
 * The product is Mirthly, and this is the one place that says so.
 *
 * The name lives in a title template rather than in each page, so a buyer's tab
 * reads "Sign in - Mirthly" without any route repeating the brand. A page that
 * must not carry it says so itself with `title: { absolute }`: the live guest
 * page does exactly that, because the tab over somebody's invitation belongs to
 * the couple and not to us. Anything a chat app unfurls is the explicit
 * `openGraph` on that route, which a title template never touches.
 *
 * `metadataBase` is here so a route that ever names a relative image resolves
 * it against the deployment's own origin rather than against a guess.
 */

const { siteUrl } = readSiteConfig()

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Mirthly',
    template: '%s - Mirthly',
  },
  description: 'Interactive invitation websites.',
  applicationName: 'Mirthly',
  openGraph: {
    type: 'website',
    siteName: 'Mirthly',
    title: 'Mirthly',
    description: 'Interactive invitation websites.',
  },
}

// Guests arrive on phones, so the viewport is set from the first commit rather
// than added once something looks wrong at 320px.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
