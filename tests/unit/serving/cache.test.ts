import { describe, expect, it } from 'vitest'

import {
  GUEST_PAGE_CACHE_CONTROL,
  GUEST_PAGE_REVALIDATE_SECONDS,
  GUEST_PAGE_STALE_WHILE_REVALIDATE_SECONDS,
  eventCacheTag,
} from '@/lib/serving/cache'

/**
 * The header, as a contract rather than as a string somebody typed.
 *
 * tests/e2e/caching.spec.ts reads the header off a real response, which is the
 * assertion that matters, because a header is a property of a deployment. This
 * one is about the value itself, and it exists because the two directives that
 * matter most are the ones that are wrong by omission: a missing `max-age=0`
 * lets a browser apply its own heuristic, and a stray `immutable` on a document
 * would cache a live invitation in a guest's browser until they clear it.
 */

function directives(header: string): Map<string, string | null> {
  return new Map(
    header.split(',').map((part) => {
      const [name, value] = part.trim().split('=')
      return [name!.toLowerCase(), value ?? null]
    })
  )
}

describe('the guest page cache header', () => {
  const parsed = directives(GUEST_PAGE_CACHE_CONTROL)

  it('lets a shared cache hold one copy for every guest', () => {
    expect(parsed.has('public')).toBe(true)
  })

  it('makes a browser ask every time, so a 304 is the most it can reuse', () => {
    expect(parsed.get('max-age')).toBe('0')
    expect(parsed.has('must-revalidate')).toBe(true)
  })

  it('bounds the edge copy at the same number the route revalidates on', () => {
    // These two drifting apart is the failure this test exists for: the route
    // would rebuild on one schedule and the edge would serve on another, and
    // the serving state a guest sees would be stale for the difference.
    expect(parsed.get('s-maxage')).toBe(String(GUEST_PAGE_REVALIDATE_SECONDS))
  })

  it('keeps that bound short enough to be a privacy control', () => {
    // How long a guest can be shown "live, RSVPs open" after hosting lapsed.
    expect(GUEST_PAGE_REVALIDATE_SECONDS).toBeLessThanOrEqual(60)
  })

  it('serves a stale page while a fresh one is built, rather than making anyone wait', () => {
    expect(parsed.get('stale-while-revalidate')).toBe(
      String(GUEST_PAGE_STALE_WHILE_REVALIDATE_SECONDS)
    )
  })

  it('is never immutable, because a document URL says nothing about its contents', () => {
    expect(GUEST_PAGE_CACHE_CONTROL).not.toContain('immutable')
  })
})

describe('eventCacheTag', () => {
  it('names one event, so a publish can invalidate that page and no other', () => {
    expect(eventCacheTag('emma-jake-11ea91')).toBe('event:emma-jake-11ea91')
    expect(eventCacheTag('a')).not.toBe(eventCacheTag('b'))
  })
})
