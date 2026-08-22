import { describe, expect, it } from 'vitest'

import {
  MAX_HOSTING_MONTHS,
  MIN_HOSTING_MONTHS,
  addMonths,
  hostingExpiresAt,
  isHostingMonths,
} from '@/lib/activation/hosting'

/**
 * The hosting term, and the one case that decides whether it can be stated.
 *
 * "Twelve months of hosting" bought on 31 January has to land inside February,
 * because a term that quietly grew by a couple of days each time is a term
 * nobody can put on a product page. Everything else here follows from that.
 */

const iso = (value: string) => new Date(value)

describe('adding months', () => {
  it('keeps the day of the month when the target month has one', () => {
    expect(addMonths(iso('2026-08-23T04:15:00.000Z'), 12).toISOString()).toBe(
      '2027-08-23T04:15:00.000Z'
    )
  })

  it('clamps into February rather than spilling into March', () => {
    expect(addMonths(iso('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z'
    )
  })

  it('knows February is longer in a leap year', () => {
    expect(addMonths(iso('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z'
    )
  })

  it('clamps a 31st into a 30 day month', () => {
    expect(addMonths(iso('2026-05-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-06-30T00:00:00.000Z'
    )
  })

  it('crosses a year boundary', () => {
    expect(addMonths(iso('2026-11-30T09:00:00.000Z'), 3).toISOString()).toBe(
      '2027-02-28T09:00:00.000Z'
    )
  })

  it('keeps the time of day, so the term ends at the moment it was bought', () => {
    expect(addMonths(iso('2026-03-01T23:59:59.999Z'), 6).toISOString()).toBe(
      '2026-09-01T23:59:59.999Z'
    )
  })

  it('refuses a fraction rather than rounding one', () => {
    expect(() => addMonths(iso('2026-01-01T00:00:00.000Z'), 1.5)).toThrow(/whole number/)
  })
})

describe('the range the column accepts', () => {
  it('matches activation_codes_hosting_months_range', () => {
    expect(MIN_HOSTING_MONTHS).toBe(1)
    expect(MAX_HOSTING_MONTHS).toBe(120)
  })

  it('refuses what the database would refuse, before the round trip', () => {
    expect(isHostingMonths(0)).toBe(false)
    expect(isHostingMonths(121)).toBe(false)
    expect(isHostingMonths(12.5)).toBe(false)
    expect(isHostingMonths(1)).toBe(true)
    expect(isHostingMonths(120)).toBe(true)
  })

  it('throws rather than writing a row the constraint will reject', () => {
    expect(() => hostingExpiresAt(iso('2026-08-23T00:00:00.000Z'), 0)).toThrow(/between 1 and 120/)
  })
})

describe('a promotion varying the term', () => {
  it('is one number on the code and nothing else', () => {
    // The whole reason hosting_months lives on activation_codes: a six month
    // promotion and a two year one are the same code row with a different value.
    const bought = iso('2026-08-23T00:00:00.000Z')

    expect(hostingExpiresAt(bought, 6).toISOString()).toBe('2027-02-23T00:00:00.000Z')
    expect(hostingExpiresAt(bought, 24).toISOString()).toBe('2028-08-23T00:00:00.000Z')
  })
})
