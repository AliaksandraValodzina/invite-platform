import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ORDER_MISS_LIMIT,
  ORDER_MISS_WINDOW_SECONDS,
  isCountableClient,
} from '@/lib/activation/order-throttle'

/**
 * The cap on guessing an order number, and the parts of it that can be decided
 * without a request.
 *
 * The counting itself is the database's and is asserted in
 * `supabase/tests/12_order_numbers.test.sql`. What is here is the decision that
 * comes before it: which client addresses mean anything, which is where a
 * failure would be silent. An address that should not have been counted puts
 * every visitor in one bucket; one that should have been and was not is no cap
 * at all.
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260830010000_order_numbers.sql', import.meta.url)
)

const source = readFileSync(MIGRATION, 'utf8')

describe('which clients are counted', () => {
  it('counts a real address, which is what a deployment behind a proxy sends', () => {
    expect(isCountableClient('203.0.113.7')).toBe(true)
    expect(isCountableClient('2001:db8::1')).toBe(true)
  })

  /*
   * Loopback is the machine the server is running on rather than anybody's
   * client, so counting it would put every visitor in one bucket: a cap that
   * refuses everybody after thirty misses between them is worse than no cap.
   * On a local stack it is what every request looks like.
   */
  it('does not count an address that names the server itself', () => {
    for (const address of [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'localhost',
      ' ::1 ',
      'LOCALHOST',
    ]) {
      expect(isCountableClient(address), address).toBe(false)
    }
  })

  it('does not count nothing at all', () => {
    expect(isCountableClient(null)).toBe(false)
    expect(isCountableClient('')).toBe(false)
    expect(isCountableClient('   ')).toBe(false)
  })
})

describe('the cap itself', () => {
  it('is far above a person and far below a loop', () => {
    // A buyer mistypes once or twice and goes to look at their receipt. This
    // has to leave room for a household behind one address doing the same.
    expect(ORDER_MISS_LIMIT).toBeGreaterThan(10)
    // And it has to stay small enough that one address cannot walk the space
    // around a real order number.
    expect(ORDER_MISS_LIMIT).toBeLessThan(200)
  })

  it('uses the window the database defaults to, so an unset argument agrees', () => {
    expect(source).toContain(`p_window_seconds integer default ${ORDER_MISS_WINDOW_SECONDS}`)
  })

  it('counts misses, in a table the Data API cannot reach', () => {
    expect(source).toContain('create table platform.order_number_misses')
    expect(source).toContain(
      'revoke all on table platform.order_number_misses from public, anon, authenticated'
    )
  })
})
