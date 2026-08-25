import { describe, expect, it } from 'vitest'

import { readBuildInfo } from '@/lib/build-info'
import { GET } from '@/app/api/version/route'

const SHA = '6ea846dec2befa0d0207e2b6a0cd1495562622c9'
const OTHER = '79df4d54af12f6ef4ccc7471e2fc3497331998dd'

describe('readBuildInfo', () => {
  it('reports the commit CI stamped, and says CI stamped it', () => {
    expect(readBuildInfo({ stamped: SHA })).toEqual({ commit: SHA, source: 'ci' })
  })

  it('falls back to Vercel git metadata, and says so, for a deployment CI did not make', () => {
    expect(readBuildInfo({ vercelGit: SHA })).toEqual({ commit: SHA, source: 'vercel-git' })
  })

  it("prefers the publisher's stamp over Vercel's own, because the publisher is the one being checked", () => {
    expect(readBuildInfo({ stamped: SHA, vercelGit: OTHER })).toEqual({ commit: SHA, source: 'ci' })
  })

  it('says it does not know rather than guessing when neither is set', () => {
    expect(readBuildInfo({})).toEqual({ commit: null, source: 'unknown' })
  })

  /*
   * Every one of these is a shape a workflow can produce by accident: an
   * unexpanded expression, an empty variable, an abbreviated hash pasted by
   * hand. Reporting any of them would turn "the site is stale" into "the site
   * says something odd", which is the failure this endpoint exists to prevent.
   */
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['an unexpanded expression', '${{ github.sha }}'],
    ['an abbreviated sha', SHA.slice(0, 7)],
    ['a branch name', 'main'],
    ['a sha with a suffix', `${SHA}-dirty`],
  ])('treats %s as not knowing rather than as an answer', (_label, value) => {
    expect(readBuildInfo({ stamped: value })).toEqual({ commit: null, source: 'unknown' })
  })

  it('accepts an upper case sha, because git prints both', () => {
    expect(readBuildInfo({ stamped: SHA.toUpperCase() })).toEqual({ commit: SHA, source: 'ci' })
  })
})

describe('GET /api/version', () => {
  it('answers with the build info as JSON', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(readBuildInfo())
  })

  /*
   * The one header that matters here. A cached answer to "what are you serving
   * right now" is the previous deployment's answer given confidently, which is
   * the exact shape of the bug this endpoint was added to catch.
   */
  it('is never cached', () => {
    expect(GET().headers.get('cache-control')).toBe('no-store')
  })
})
