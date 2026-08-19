/**
 * /preview/<theme> renders the five blocks from the committed seed documents.
 *
 * This is the surface the 320px tests run against and the surface the captain
 * can open on a phone to check a theme against the block set. It is not the
 * guest page: there is no database read, no slug, and no designed 404, expired
 * or unpublished state here. Those are Phase 0.5, and this route goes away or
 * becomes a thin wrapper when they land.
 *
 * It does go through `resolveEventPage`, so what is on screen is the same merge
 * of definition, theme and buyer content that a real page will serve, rather
 * than a hand assembled approximation of it.
 *
 * Query parameters, both of them preview affordances:
 *   fixture=sample|long-names|report-sample   which content overrides to apply
 *   rsvp=open|closed                          the serving phase of the RSVP block
 *
 * There is deliberately no parameter for freezing the clock. It would only hold
 * until hydration, after which the countdown reads the browser's clock, so it
 * would look like a feature and behave like a flicker. A test that needs a
 * different now installs a fake clock in the browser instead.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlockList } from '@/components/blocks'
import { ThemeScope } from '@/components/theme-scope'
import { resolveEventSchedule } from '@/lib/event/time'
import {
  DEFAULT_PREVIEW_FIXTURE,
  PREVIEW_DEFINITION,
  PREVIEW_EVENT,
  PREVIEW_FIXTURES,
  PREVIEW_THEMES,
} from '@/lib/preview/fixture'
import { EMPTY_THEME_OVERRIDE, resolveEventPage } from '@/lib/template'

import { withWebFonts } from '../../fonts'
import { previewRsvpSubmit } from './actions'

// The countdown is rendered with the server's clock, so this page must not be
// cached into one.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Block preview',
  // Placeholder content under a real domain is not something a search engine
  // should ever have a copy of.
  robots: { index: false, follow: false },
}

export default async function BlockPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ theme: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { theme } = await params
  const query = await searchParams

  const themeDocument = PREVIEW_THEMES[theme]
  if (themeDocument === undefined) notFound()

  const fixtureName = single(query.fixture) ?? DEFAULT_PREVIEW_FIXTURE
  const content = PREVIEW_FIXTURES[fixtureName]
  if (content === undefined) notFound()

  const outcome = resolveEventPage({
    definition: PREVIEW_DEFINITION,
    theme: themeDocument,
    content,
    themeOverride: EMPTY_THEME_OVERRIDE,
  })

  const schedule = resolveEventSchedule(PREVIEW_EVENT)

  if (!outcome.ok || schedule === null) {
    // The seed files are gated by a unit test, so reaching this means one of
    // them changed without its test. Say which document, and say it plainly.
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">The preview could not be resolved</h1>
        <p data-testid="preview-failure" className="mt-2 text-sm">
          {outcome.ok ? 'the preview event time did not resolve' : outcome.message}
        </p>
      </main>
    )
  }

  return (
    /*
     * `withWebFonts` swaps the head of each font stack for the self hosted face
     * of the same name. It is applied here rather than inside ThemeScope so that
     * the component turning tokens into CSS stays free of anything Next
     * specific, and the guest page in Phase 0.5 does the same thing in the same
     * place. See src/app/fonts.ts for why the faces are not preloaded.
     */
    <ThemeScope tokens={withWebFonts(outcome.page.tokens)}>
      <BlockList
        blocks={outcome.page.blocks}
        context={{
          schedule,
          nowMs: serverNow(),
          rsvp: {
            phase: single(query.rsvp) === 'closed' ? 'closed' : 'open',
            submit: previewRsvpSubmit,
          },
        }}
      />
    </ThemeScope>
  )
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reading the clock is what makes this render dynamic, which is why the route
 * declares `force-dynamic`. It is deliberately not read inside the component
 * body: a server render that samples the clock is correct here, but a component
 * that calls `Date.now()` inline is the shape that goes wrong the moment
 * something decides to re-render or cache it.
 */
function serverNow(): number {
  return Date.now()
}
