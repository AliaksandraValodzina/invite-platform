import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  MAX_ORDER_NUMBER_LENGTH,
  MIN_ORDER_NUMBER_LENGTH,
  ORDER_FORM_PATH,
  isPossibleOrderNumber,
  maskedOrderNumber,
  normaliseOrderNumber,
  orderFormUrl,
  orderNumberSuffix,
  orderPath,
  orderUrl,
} from '@/lib/activation/order-number'

/**
 * What a typed Etsy order number is, and the migration it has to agree with.
 *
 * `public.hash_order_number` decides what a number IS: it strips every
 * non-alphanumeric character, uppercases, and hashes the result. The app never
 * hashes a number itself, so the two can only disagree about which strings are
 * worth sending to the database at all. That is still worth pinning: a
 * TypeScript gate that rejected a character the SQL accepts would turn a paid
 * order into "we cannot find that order number", on the day of somebody's
 * purchase.
 *
 * Reading the source is the only place this can be checked from a unit test, in
 * the same way tests/unit/activation/schema-agreement.test.ts does for codes.
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260830010000_order_numbers.sql', import.meta.url)
)

const source = readFileSync(MIGRATION, 'utf8')

describe('the normalisation rule', () => {
  it('is still strip-then-uppercase in the database', () => {
    expect(source).toContain(
      "upper(regexp_replace(coalesce(p_number, ''), '[^a-zA-Z0-9]', '', 'g'))"
    )
  })

  it('is the same rule in TypeScript, over what a receipt and a keyboard produce', () => {
    for (const [typed, expected] of [
      ['#3812457901', '3812457901'],
      ['3812 457901', '3812457901'],
      ['3812-457901', '3812457901'],
      ['  3812457901  ', '3812457901'],
      ['order 3812457901', 'ORDER3812457901'],
      ['', ''],
    ] as const) {
      expect(normaliseOrderNumber(typed), typed).toBe(expected)
    }
  })
})

describe('the shape gate', () => {
  /*
   * It is a gate in front of the database and nothing more. A number that
   * passes is still almost certainly not on the list, and that is the point:
   * only the list says a purchase happened.
   */
  it('accepts an Etsy order number however it was typed', () => {
    for (const typed of ['3812457901', '#3812457901', '3812 457 901', '3812-457901']) {
      expect(isPossibleOrderNumber(typed), typed).toBe(true)
    }
  })

  it('refuses what is too short, too long, or nothing at all', () => {
    for (const typed of ['', '12345', '#!!', '7'.repeat(MAX_ORDER_NUMBER_LENGTH + 1)]) {
      expect(isPossibleOrderNumber(typed), typed).toBe(false)
    }
  })

  /*
   * It is deliberately tolerant, and this is what that costs: a word of the
   * right length passes the gate and goes to the database, which does not find
   * it and refuses in a sentence. The alternative is a constant in this repo
   * deciding that a real receipt id on the captain's own list is not a number,
   * which is a worse failure and a silent one.
   */
  it('lets a word of the right length through to the list, which is what refuses it', () => {
    expect(isPossibleOrderNumber('not-a-number')).toBe(true)
  })

  it('accepts both ends of its own range, so the constants are not decoration', () => {
    expect(isPossibleOrderNumber('7'.repeat(MIN_ORDER_NUMBER_LENGTH))).toBe(true)
    expect(isPossibleOrderNumber('7'.repeat(MAX_ORDER_NUMBER_LENGTH))).toBe(true)
  })
})

describe('the four characters kept in the clear', () => {
  it('is the shape the migration constrains the column to', () => {
    expect(source).toContain("check (number_suffix ~ '^[A-Z0-9]{4}$')")
  })

  it('is the last four of the normalised number, so a masked row is findable', () => {
    expect(orderNumberSuffix('#3812-457901')).toBe('7901')
    expect(orderNumberSuffix('3812457901')).toMatch(/^[A-Z0-9]{4}$/)
  })

  it('is all a listing prints, because the number itself is stored hashed', () => {
    expect(maskedOrderNumber('7901')).toBe('••••7901')
    expect(maskedOrderNumber('7901')).not.toContain('3812')
  })
})

describe('the links', () => {
  it('normalises into the path, so one order has one URL however it was typed', () => {
    expect(orderPath('#3812-457901')).toBe('/order/3812457901')
    expect(orderPath('3812 457901')).toBe(orderPath('3812457901'))
  })

  /*
   * Normalisation is also what makes the path safe to build from a typed
   * string. There is no separator left to escape a segment with, so a hostile
   * "number" comes out as letters and digits or does not pass the gate at all.
   */
  it('cannot be made to leave its own segment', () => {
    for (const hostile of ['../../dashboard', '3812457901/../evil', '3812457901?x=1']) {
      expect(orderPath(hostile), hostile).toMatch(/^\/order\/[A-Z0-9]*$/)
    }
  })

  it('builds absolute links from the site URL and never from a literal host', () => {
    expect(orderFormUrl('https://mirthly.app/')).toBe(`https://mirthly.app${ORDER_FORM_PATH}`)
    expect(orderUrl('https://mirthly.app', '3812457901')).toBe(
      'https://mirthly.app/order/3812457901'
    )
  })
})

describe('what a redeemed row must carry', () => {
  it('still names its event, which is what makes a second tap idempotent', () => {
    expect(source).toContain('order_numbers_redemption_is_complete')
    expect(source).toContain('redeemed_event_id is not null')
  })

  it('is single use, enforced by a unique index rather than by the route', () => {
    expect(source).toContain(
      'create unique index order_numbers_number_hash_key on public.order_numbers (number_hash)'
    )
  })

  it('has no delete privilege, so a refunded order keeps its trail', () => {
    expect(source).toContain('grant select, insert, update on table public.order_numbers')
    expect(source).not.toContain(
      'grant select, insert, update, delete on table public.order_numbers'
    )
  })

  it('leaves the paid claim path exactly as it was', () => {
    /*
     * This work is additive by instruction: `/claim/<code>`, the issuing script
     * and `activation_codes` stay as they were built, because they are the
     * route the captain still needs the day something goes wrong with an order.
     * The migration may name them in a comment and must not touch them.
     */
    for (const change of [
      'alter table public.activation_codes',
      'drop table',
      'drop function',
      'drop policy',
      'create or replace function public.hash_activation_code',
    ]) {
      expect(source, change).not.toContain(change)
    }
  })
})
