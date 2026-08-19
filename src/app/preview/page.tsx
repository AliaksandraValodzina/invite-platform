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
  { key: 'long-names', label: 'Long names at 320px' },
  { key: 'sample', label: 'Template defaults' },
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
