import { describe, expect, it } from 'vitest'

import {
  CLAIM_COOKIE,
  DASHBOARD_DESTINATION,
  NEXT_PARAM,
  callbackUrl,
  resolveDestination,
  safeDestination,
} from '@/lib/auth/destination'

/**
 * Where a magic link lands, which is the place the activation flow breaks if
 * anybody gets it wrong.
 *
 * Two things are being asserted and they pull in opposite directions. The claim
 * has to survive the round trip through a mailbox, or a buyer arrives signed in
 * with nothing to show for a purchase. And `next` must not be an open redirect,
 * because it is a parameter on a URL anybody can compose and send.
 */

describe('what counts as a destination', () => {
  it('accepts a claim link, which is the thing this exists for', () => {
    expect(safeDestination('/claim/AB4CD-9EFGH-JKMNP-QRSTV')).toBe('/claim/AB4CD-9EFGH-JKMNP-QRSTV')
  })

  it('accepts the dashboard', () => {
    expect(safeDestination('/dashboard')).toBe('/dashboard')
  })

  it('refuses every shape that leaves the site', () => {
    for (const hostile of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'http://evil.test/claim/AB4CD-9EFGH-JKMNP-QRSTV',
      '/claim/AB4CD-9EFGH-JKMNP-QRSTV/../../evil',
      'javascript:alert(1)',
      '/claim/AB4CD-9EFGH-JKMNP-QRSTV?next=//evil.test',
    ]) {
      expect(safeDestination(hostile), hostile).toBeNull()
    }
  })

  it('refuses a path this product does not produce', () => {
    expect(safeDestination('/api/uploads/sweep')).toBeNull()
    expect(safeDestination('/dashboard/some-id/replies')).toBeNull()
    expect(safeDestination('')).toBeNull()
    expect(safeDestination(null)).toBeNull()
    expect(safeDestination(undefined)).toBeNull()
  })
})

describe('the callback URL in the email', () => {
  it('carries the destination, so the claim crosses devices', () => {
    const url = callbackUrl('https://example.test', '/claim/AB4CD-9EFGH-JKMNP-QRSTV')

    expect(url).toBe(
      `https://example.test/auth/callback?${NEXT_PARAM}=${encodeURIComponent(
        '/claim/AB4CD-9EFGH-JKMNP-QRSTV'
      )}`
    )
  })

  it('is built from the configured origin, because the product has no name yet', () => {
    expect(callbackUrl('http://127.0.0.1:3000/', null)).toBe('http://127.0.0.1:3000/auth/callback')
  })

  it('drops a destination it would refuse to follow, rather than carrying it', () => {
    expect(callbackUrl('https://example.test', 'https://evil.test')).toBe(
      'https://example.test/auth/callback'
    )
  })
})

describe('resolving where to land', () => {
  it('prefers the link the buyer actually opened', () => {
    expect(
      resolveDestination('/claim/AAAAA-AAAAA-AAAAA-AAAAA', '/claim/BBBBB-BBBBB-BBBBB-BBBBB')
    ).toBe('/claim/AAAAA-AAAAA-AAAAA-AAAAA')
  })

  it('falls back to the cookie when the link lost its query', () => {
    // A mail provider rewriting links, or an auth redirect allow list that does
    // not admit a query string. Both are real and both drop `next`.
    expect(resolveDestination(null, '/claim/BBBBB-BBBBB-BBBBB-BBBBB')).toBe(
      '/claim/BBBBB-BBBBB-BBBBB-BBBBB'
    )
  })

  it('falls back to the dashboard when neither carrier says anything usable', () => {
    expect(resolveDestination(null, null)).toBe(DASHBOARD_DESTINATION)
    expect(resolveDestination('https://evil.test', '//evil.test')).toBe(DASHBOARD_DESTINATION)
  })

  it('names a cookie that is not one of the session cookies', () => {
    // Sharing a name with ip_access or ip_refresh would mean a claim clearing a
    // session, or a sign-out clearing a pending claim.
    expect(CLAIM_COOKIE).not.toBe('ip_access')
    expect(CLAIM_COOKIE).not.toBe('ip_refresh')
  })
})
