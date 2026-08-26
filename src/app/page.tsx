/**
 * The front door.
 *
 * It used to print the site URL and where that value came from, which was an
 * honest thing for a shell nobody had deployed and the wrong thing for a bought
 * domain. The config contract those values proved is covered by
 * tests/unit/env.test.ts, which is where it belonged all along.
 *
 * The name and one true sentence, and nothing else. What this page should say
 * beyond that is the captain's to write.
 *
 * The footer under it is navigation rather than words: a buyer linking here
 * from an Etsy listing is asked for a privacy statement, and until this page
 * carried one the only way to reach it was to already know the path.
 */

import { SiteFooter } from '@/components/site-footer'

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Mirthly</h1>

        <p className="text-slate-600">
          You fill in the invitation you bought, share the link, and your guests reply from their
          phones.
        </p>
      </main>

      <SiteFooter />
    </div>
  )
}
