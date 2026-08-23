import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ACTIVATION_CODE_ALPHABET, normaliseActivationCode } from '@/lib/activation/code'
import { MAX_HOSTING_MONTHS, MIN_HOSTING_MONTHS } from '@/lib/activation/hosting'

/**
 * The migration is the authority. This holds the TypeScript to it.
 *
 * `public.hash_activation_code` decides what a code IS: it strips every
 * non-alphanumeric character, uppercases, and hashes the result. The app never
 * hashes a code itself, so the two can only disagree about which strings are
 * worth sending to the database at all. That is still worth pinning: a
 * TypeScript gate that rejected a character the SQL accepts would turn a paid
 * code into "that is not a claim link we recognise", on the day of somebody's
 * order.
 *
 * Reading the source is the only place this can be checked from a unit test, in
 * the same way `tests/unit/serving/page-revalidate.test.ts` reads a route file
 * and `tests/unit/components/block-tokens.test.ts` reads block sources.
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260819010700_activation_codes.sql', import.meta.url)
)

const source = readFileSync(MIGRATION, 'utf8')

describe('the normalisation rule', () => {
  it('is still strip-then-uppercase in the database', () => {
    expect(source).toContain("upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'))")
  })

  it('is the same rule in TypeScript, over the characters that differ', () => {
    // Each of these is a thing a buyer's keyboard or a link actually produces.
    for (const [typed, expected] of [
      ['ab4cd-9efgh-jkmnp-qrstv', 'AB4CD9EFGHJKMNPQRSTV'],
      ['AB4CD 9EFGH', 'AB4CD9EFGH'],
      ['ab4cd_9efgh', 'AB4CD9EFGH'],
      ['AB4CD.9EFGH', 'AB4CD9EFGH'],
      ['', ''],
    ] as const) {
      expect(normaliseActivationCode(typed), typed).toBe(expected)
    }
  })
})

describe('the prefix', () => {
  it('is still four characters, kept in the clear for support', () => {
    expect(source).toContain("check (code_prefix ~ '^[A-Z0-9]{4}$')")
  })

  it('is a shape every character of the alphabet can produce', () => {
    expect(ACTIVATION_CODE_ALPHABET).toMatch(/^[A-Z0-9]+$/)
  })
})

describe('the hosting term', () => {
  it('has the range the app refuses outside of', () => {
    expect(source).toContain(
      `check (hosting_months between ${MIN_HOSTING_MONTHS} and ${MAX_HOSTING_MONTHS})`
    )
  })
})

describe('what a redeemed row must carry', () => {
  it('still names its event, which is what makes a second click idempotent', () => {
    /*
     * `redeemed_event_id` is how a repeat claim resolves to the invitation the
     * first one made. Without the constraint a row could be marked spent with no
     * event, and the second tap would have nowhere to send the buyer.
     */
    expect(source).toContain('activation_codes_redemption_is_complete')
    expect(source).toContain('redeemed_event_id is not null')
  })

  it('has no delete privilege, so a revoked code keeps its audit trail', () => {
    expect(source).toContain('grant select, insert, update on table public.activation_codes')
    expect(source).not.toContain(
      'grant select, insert, update, delete on table public.activation_codes'
    )
  })
})
