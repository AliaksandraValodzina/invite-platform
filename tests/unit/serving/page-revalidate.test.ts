import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { GUEST_PAGE_REVALIDATE_SECONDS } from '@/lib/serving/cache'

/**
 * The guest page's `revalidate` and the `s-maxage` in its cache header have to
 * be the same number, and they cannot be the same constant.
 *
 * Next reads route segment config by static analysis at build time. An imported
 * value fails the build with "Invalid segment configuration export detected",
 * so the page has to carry a literal. That is exactly the shape that drifts:
 * somebody tunes one of the two, the build stays green, and the edge then
 * serves a copy for a minute that the origin rebuilds every five. The guest
 * facing consequence is a page showing the wrong serving state for the
 * difference.
 *
 * Reading the source is the only place this can be checked, which is the same
 * reason tests/unit/components/block-tokens.test.ts reads block sources.
 */

const PAGE = fileURLToPath(new URL('../../../src/app/e/[slug]/page.tsx', import.meta.url))

describe('the guest page route segment config', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('exports a revalidate literal, because Next will not accept an import', () => {
    expect(source).toMatch(/^export const revalidate = \d+$/m)
  })

  it('exports the same number the cache header advertises as s-maxage', () => {
    const match = /^export const revalidate = (\d+)$/m.exec(source)

    expect(match, 'no revalidate export found at all').not.toBeNull()
    expect(Number(match![1])).toBe(GUEST_PAGE_REVALIDATE_SECONDS)
  })

  it('still returns no paths from generateStaticParams, which is what puts it on the ISR path', () => {
    // Without this the route renders every request fresh and streams the
    // response, and a streamed response carries no ETag, so every browser
    // revalidation costs a whole page rather than a 304. Measured, not assumed.
    expect(source).toMatch(/export function generateStaticParams\(\)/)
  })
})
