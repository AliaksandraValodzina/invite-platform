import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TEMPLATE_PREVIEW_REVALIDATE_SECONDS } from '@/lib/serving/cache'

/**
 * The template preview's `revalidate` and the lifetime of the read behind it
 * have to be the same number, and they cannot be the same constant.
 *
 * Same reason as `page-revalidate.test.ts` next door: Next reads route segment
 * config by static analysis at build time and refuses an imported value, so the
 * page carries a literal. Two numbers that must agree and cannot be shared is
 * exactly the shape that drifts.
 *
 * It matters less here than it does for a guest page, and it is worth being
 * clear about why. On `/e/<slug>` the lifetime bounds how long somebody can be
 * shown the wrong serving state, which is a privacy control. Here it only bounds
 * how long a design edit takes to reach a shop listing. This test exists so that
 * distinction stays a decision rather than an accident.
 */

const PAGE = fileURLToPath(new URL('../../../src/app/t/[templateId]/page.tsx', import.meta.url))

describe('the template preview route segment config', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('exports a revalidate literal, because Next will not accept an import', () => {
    expect(source).toMatch(/^export const revalidate = \d+$/m)
  })

  it('exports the same number the read behind it uses', () => {
    const match = /^export const revalidate = (\d+)$/m.exec(source)

    expect(match, 'no revalidate export found at all').not.toBeNull()
    expect(Number(match![1])).toBe(TEMPLATE_PREVIEW_REVALIDATE_SECONDS)
  })
})
