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
 */

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Mirthly</h1>

      <p className="text-slate-600">
        You fill in the invitation you bought, share the link, and your guests reply from their
        phones.
      </p>
    </main>
  )
}
