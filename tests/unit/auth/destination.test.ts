import { describe, expect, it } from 'vitest'

import { templateCopyPath } from '@/lib/activation/code'
import {
  MAX_ORDER_NUMBER_LENGTH,
  MIN_ORDER_NUMBER_LENGTH,
  orderPath,
} from '@/lib/activation/order-number'
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

  /*
   * The free launch's open copy link. It is built in one place and admitted in
   * another, so the assertion is that the built path is the admitted one rather
   * than that a hand-written string matches a hand-written pattern: a route
   * that moved and an allow list that did not would drop somebody at an empty
   * dashboard after they pressed "make this invitation yours".
   */
  it('accepts the open copy link, and takes the path from the builder', () => {
    const path = templateCopyPath('4f6a2c1e-9b3d-4a7f-8c21-0d5e6f7a8b90')

    expect(path).toBe('/t/4f6a2c1e-9b3d-4a7f-8c21-0d5e6f7a8b90/use')
    expect(safeDestination(path)).toBe(path)
  })

  /*
   * The typed order number. Same argument as the copy link above: the path is
   * built in one place and admitted in another, and a buyer who lost it across
   * the mailbox arrives signed in having paid and received nothing. The
   * builder normalises, so the admitted string is uppercase with no separators
   * however the buyer typed it.
   */
  it('accepts a typed order number, and takes the path from the builder', () => {
    const path = orderPath('#3812-457901')

    expect(path).toBe('/order/3812457901')
    expect(safeDestination(path)).toBe(path)
  })

  it('accepts an order number at both ends of the length the builder allows', () => {
    for (const length of [MIN_ORDER_NUMBER_LENGTH, MAX_ORDER_NUMBER_LENGTH]) {
      const path = orderPath('7'.repeat(length))
      expect(safeDestination(path), path).toBe(path)
    }
  })

  it('refuses the order form itself, which redeems nothing', () => {
    expect(safeDestination('/order')).toBeNull()
  })

  it('refuses an order path that is not one the builder makes', () => {
    for (const hostile of [
      '/order/../dashboard',
      '/order/3812457901/../../evil',
      '/order/3812457901?next=//evil.test',
      // Lowercase and separators never survive normalisation, so a path
      // carrying them was composed by somebody else.
      '/order/3812-457901',
      '/order/abc',
      `/order/${'7'.repeat(MAX_ORDER_NUMBER_LENGTH + 1)}`,
    ]) {
      expect(safeDestination(hostile), hostile).toBeNull()
    }
  })

  it('refuses the preview itself, which creates nothing and needs no session', () => {
    expect(safeDestination('/t/4f6a2c1e-9b3d-4a7f-8c21-0d5e6f7a8b90')).toBeNull()
  })

  it('refuses a copy link whose template id is not a template id', () => {
    for (const hostile of [
      '/t/../dashboard/use',
      '/t/not-a-uuid/use',
      '/t/4f6a2c1e-9b3d-4a7f-8c21-0d5e6f7a8b90/use/../../evil',
      '/t/4f6a2c1e-9b3d-4a7f-8c21-0d5e6f7a8b90/use?next=//evil.test',
    ]) {
      expect(safeDestination(hostile), hostile).toBeNull()
    }
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

  it('is built from the configured origin, and never from a literal', () => {
    expect(callbackUrl('http://127.0.0.1:3000/', null)).toBe(
      `http://127.0.0.1:3000/auth/callback?${NEXT_PARAM}=`
    )
  })

  it('drops a destination it would refuse to follow, rather than carrying it', () => {
    expect(callbackUrl('https://example.test', 'https://evil.test')).toBe(
      `https://example.test/auth/callback?${NEXT_PARAM}=`
    )
  })

  /*
   * The email template appends the one-use token to this URL with `&`, because
   * a Go template cannot ask whether what it was handed already has a query
   * string. A bare path here produces `/auth/callback&token_hash=...`, the
   * callback finds no token, and the buyer is told their link did not work one
   * tap after paying. Asserted for every case, because the case that regresses
   * is the one nobody thought about.
   */
  it('always carries a query string, which is what lets the email append a token', () => {
    for (const destination of [
      null,
      '',
      '/dashboard',
      '/claim/AB4CD-9EFGH-JKMNP-QRSTV',
      'https://evil.test',
    ]) {
      const url = callbackUrl('https://example.test', destination)
      expect(url, `destination ${JSON.stringify(destination)}`).toContain('?')
      expect(new URL(`${url}&token_hash=abc`).searchParams.get('token_hash')).toBe('abc')
    }
  })

  it('an empty next is not a destination, so the claim cookie still decides', () => {
    expect(resolveDestination('', '/claim/AB4CD-9EFGH-JKMNP-QRSTV')).toBe(
      '/claim/AB4CD-9EFGH-JKMNP-QRSTV'
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
