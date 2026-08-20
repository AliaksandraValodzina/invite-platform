import { describe, expect, it } from 'vitest'

import {
  callerAddress,
  checkRateLimit,
  rateLimitKey,
  type RateLimitStore,
} from '@/lib/rsvp/rate-limit'

/**
 * The limiter is driven with an explicit clock and an explicit store, so the
 * boundary can be checked rather than approached by sleeping. A limiter tested
 * by waiting is a slow test that still never reaches the interesting second.
 */

const WINDOW = 1000
const MAX = 3

function limiter() {
  const store: RateLimitStore = new Map()
  return (key: string, nowMs: number) =>
    checkRateLimit(key, nowMs, { store, max: MAX, windowMs: WINDOW })
}

describe('the reply rate limit', () => {
  it('allows a burst up to the limit and then refuses', () => {
    const check = limiter()

    expect(check('a', 0).allowed).toBe(true)
    expect(check('a', 1).allowed).toBe(true)
    expect(check('a', 2).allowed).toBe(true)
    expect(check('a', 3).allowed).toBe(false)
  })

  it('says how long to wait, in whole seconds a person could be told', () => {
    const check = limiter()
    for (let attempt = 0; attempt < MAX; attempt += 1) check('a', 0)

    const decision = check('a', 400)

    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.retryAfterSeconds).toBe(1)
  })

  it('opens again exactly when the window closes, not a moment before', () => {
    const check = limiter()
    for (let attempt = 0; attempt < MAX; attempt += 1) check('a', 0)

    expect(check('a', WINDOW - 1).allowed).toBe(false)
    expect(check('a', WINDOW).allowed).toBe(true)
  })

  it('counts each caller separately, so one household cannot lock out a wedding', () => {
    const check = limiter()
    for (let attempt = 0; attempt < MAX; attempt += 1) check('a', 0)

    expect(check('a', 0).allowed).toBe(false)
    expect(check('b', 0).allowed).toBe(true)
  })

  it('forgets closed windows, so the store does not grow with every caller', () => {
    const store: RateLimitStore = new Map()
    checkRateLimit('a', 0, { store, max: MAX, windowMs: WINDOW })
    checkRateLimit('b', 0, { store, max: MAX, windowMs: WINDOW })
    expect(store.size).toBe(2)

    checkRateLimit('c', WINDOW * 2, { store, max: MAX, windowMs: WINDOW })
    expect(store.size).toBe(1)
  })
})

describe('what the limiter holds about a caller', () => {
  /**
   * `20260819010600_rsvps.sql` says no address, user agent or fingerprint is
   * written down anywhere. The counters are in memory rather than in a table,
   * and what is in memory is a hash: a heap dump or a crash report has no
   * address in it.
   */
  it('holds a hash rather than an address', () => {
    const key = rateLimitKey('203.0.113.7', 'emma-and-jake-a1b2c3')

    expect(key).not.toContain('203.0.113.7')
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it('separates one caller replying to two different invitations', () => {
    expect(rateLimitKey('203.0.113.7', 'one-aaa111')).not.toBe(
      rateLimitKey('203.0.113.7', 'two-bbb222')
    )
  })

  it('is stable within a process, or it would count nothing', () => {
    expect(rateLimitKey('203.0.113.7', 'one-aaa111')).toBe(
      rateLimitKey('203.0.113.7', 'one-aaa111')
    )
  })
})

describe('finding the caller', () => {
  it('takes the first address in a forwarded chain, which is the client', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' })
    expect(callerAddress(headers)).toBe('203.0.113.7')
  })

  it('falls back to the real-ip header a proxy may set instead', () => {
    expect(callerAddress(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  /**
   * Null rather than a constant. Counting every caller against one bucket
   * because a proxy stripped the headers would rate limit a whole wedding, and
   * a limit that fires on the twentieth guest is worse than no limit at all.
   */
  it('answers null when there is nothing to go on', () => {
    expect(callerAddress(new Headers())).toBeNull()
    expect(callerAddress(new Headers({ 'x-forwarded-for': '  ' }))).toBeNull()
  })
})
