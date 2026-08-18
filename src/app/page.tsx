import { readSiteConfig } from '@/lib/env'

export default function HomePage() {
  const { siteUrl, siteUrlConfigured } = readSiteConfig()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Invite Platform</h1>

      <p className="text-slate-600">
        Phase 0.1 shell. The template format, blocks and guest pages are separate tasks.
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Site URL</dt>
        <dd data-testid="site-url" className="font-mono break-all">
          {siteUrl}
        </dd>

        <dt className="text-slate-500">Source</dt>
        <dd data-testid="site-url-source">{siteUrlConfigured ? 'environment' : 'fallback'}</dd>
      </dl>
    </main>
  )
}
