/**
 * The index of what there is to look at.
 *
 * Three themes nobody can open are three themes that have not landed, and there
 * is no page renderer and no database client yet, so this is the way in. It
 * links into /preview/<theme>, which renders the committed seed documents
 * through the real `resolveEventPage`.
 *
 * It is not the product. There is no auth here, no event, no persistence and no
 * renderer: every link on this page goes to the same five blocks drawn from a
 * hand written template with a hard coded date, and the page says so rather
 * than implying otherwise.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

import { DESIGN_DIRECTIONS, PLACEHOLDER_THEMES } from '@/lib/preview/fixture'

export const metadata: Metadata = {
  title: 'Theme preview',
  robots: { index: false, follow: false },
}

const FIXTURES: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'report-sample', label: 'Emma & Jake' },
  { key: 'no-artwork', label: 'Without the artwork' },
  { key: 'long-names', label: 'Long names at 320px' },
  { key: 'sample', label: 'Template defaults' },
]

/**
 * The cover, which the preview otherwise starts opened.
 *
 * Two links rather than one, because the two are the whole claim the envelope
 * makes: the theme's own envelope, drawn from that direction's tokens, and the
 * universal one every theme falls back to when a template says nothing.
 */
const ENVELOPES: readonly { readonly query: string; readonly label: string }[] = [
  { query: 'envelope=closed&fixture=report-sample', label: 'The envelope' },
  { query: 'envelope=closed&fixture=universal-envelope', label: 'The universal envelope' },
]

export default function PreviewIndexPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Theme preview</h1>
      <p className="mt-2 text-sm text-slate-600">
        The five v1 blocks, rendered from the committed seed documents under one theme. There is no
        database read, no event slug and no designed 404 or expired state here: this is the block
        set with a theme on it, and nothing else exists yet.
      </p>

      <p
        data-testid="artwork-placeholder-notice"
        className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      >
        <span className="font-semibold">The artwork at the top of each page is a placeholder.</span>{' '}
        It is the sample image supplied on 20 August 2026, cropped to its florals so that the
        card&rsquo;s own printed text stays out of frame and the couple&rsquo;s names, date and
        venue below it are the only place those words appear. Its rights are unestablished and it
        must not ship. It is rendered exactly as supplied in all three directions, with no
        recolouring, tint or filter, because how it sits against each palette is the thing to judge.
        Compare each direction against <span className="font-medium">Without the artwork</span> to
        see what it is doing.
      </p>

      <p className="mt-4 text-sm text-slate-600">
        Every link below starts with the envelope already opened, because this page exists to look
        at the blocks. <span className="font-medium">The envelope</span> and{' '}
        <span className="font-medium">The universal envelope</span> start it closed. It opens on a
        tap with no JavaScript involved, and the invitation underneath is reachable either way.
      </p>

      <h2 className="mt-8 text-lg font-semibold">The template line</h2>
      <p className="mt-1 text-sm text-slate-600">
        Three design directions, built as three themes rather than narrowed to one. Emma &amp; Jake
        is the sample content the directions were designed and measured against.
      </p>

      <ul className="mt-4 grid gap-4">
        {DESIGN_DIRECTIONS.map((direction) => (
          <li key={direction.key} className="rounded border border-slate-200 p-4">
            <h3 className="font-semibold">{direction.name}</h3>
            <p className="mt-1 text-sm text-slate-600">{direction.mood}</p>
            <p className="mt-2 text-sm text-slate-500">
              <span className="font-medium">Signature, not yet built:</span> {direction.signature}
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {FIXTURES.map((fixture) => (
                <Link
                  key={fixture.key}
                  href={`/preview/${direction.key}?fixture=${fixture.key}`}
                  className="text-blue-700 underline"
                >
                  {fixture.label}
                </Link>
              ))}
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {ENVELOPES.map((envelope) => (
                <Link
                  key={envelope.query}
                  href={`/preview/${direction.key}?${envelope.query}`}
                  className="text-blue-700 underline"
                >
                  {envelope.label}
                </Link>
              ))}
            </p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Placeholder themes</h2>
      <p className="mt-1 text-sm text-slate-600">
        Committed with the template format in Phase 0.3 to prove the block set renders whatever
        tokens it is handed. They are not part of the template line and they load no web fonts.
      </p>
      <p className="mt-3 flex gap-4 text-sm">
        {PLACEHOLDER_THEMES.map((key) => (
          <Link key={key} href={`/preview/${key}`} className="text-blue-700 underline">
            {key}
          </Link>
        ))}
      </p>
    </main>
  )
}
