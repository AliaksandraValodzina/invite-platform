import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  TAKEDOWN_RESPONSE_WORKING_DAYS,
  UPLOAD_ORIGINAL_RETENTION_DAYS,
} from '@/lib/legal/retention'
import { UPLOAD_KIND_SPECS, UPLOAD_MAX_BYTES } from '@/lib/uploads'

/**
 * The terms page makes promises about uploads, and something has to check that
 * the code keeping them uses the same numbers.
 *
 * The same argument as `retention.test.ts`, applied to a different promise:
 * text that disagrees with the code is worse than no text, because it is a
 * promise nobody is keeping and everybody believes. A stated cap of 12 photos
 * over an enforced cap of 30 is a support ticket; the other way round is a
 * buyer who paid for something they cannot use.
 *
 * The takedown paragraph gets the same treatment for a different reason. The
 * captain's constraint is that content responsibility sits with the buyer "in
 * one place, with a takedown path". The paragraph is the one place. These
 * assertions are that it names a mechanism that exists, including the part
 * nobody wants to write down: an immutable cache lifetime means a takedown
 * stops future fetches and cannot reach a copy already downloaded.
 */

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8')
}

const terms = source('src/app/terms/page.tsx')
const retentionMigration = source('supabase/migrations/20260821010400_uploads_retention.sql')
const uploadsMigration = source('supabase/migrations/20260821010300_uploads.sql')

/** The page's prose with line breaks collapsed, since Prettier decides the wrapping. */
const prose = terms.replace(/\s+/g, ' ')

describe('the limits the terms state', () => {
  it('are printed from the code rather than typed out again', () => {
    expect(terms).toContain('UPLOAD_KIND_SPECS.image.perEvent')
    expect(terms).toContain('UPLOAD_KIND_SPECS.audio.perEvent')
    expect(terms).toContain('UPLOAD_KIND_SPECS.envelope.perEvent')
    expect(terms).toContain('UPLOAD_MAX_BYTES')
  })

  it('are the numbers the database enforces', () => {
    expect(uploadsMigration).toContain(`when 'image' then ${UPLOAD_KIND_SPECS.image.perEvent}`)
    expect(uploadsMigration).toContain(`when 'audio' then ${UPLOAD_KIND_SPECS.audio.perEvent}`)
    expect(uploadsMigration).toContain(
      `when 'envelope' then ${UPLOAD_KIND_SPECS.envelope.perEvent}`
    )
    expect(uploadsMigration).toContain(`select ${UPLOAD_MAX_BYTES}::bigint`)
  })

  it('name every format a kind actually accepts, and nothing it does not', () => {
    /*
     * A stated format list that is wider than the accepted one is a buyer
     * uploading a GIF because the page said they could. Narrower is a feature
     * nobody knows exists.
     */
    for (const format of ['JPEG', 'PNG', 'WebP', 'AVIF', 'MP3', 'M4A']) {
      expect(prose, `the terms do not mention ${format}`).toContain(format)
    }
    expect(prose).not.toContain('GIF')
    expect(prose).not.toContain('HEIC')
  })
})

describe('the retention the terms promise', () => {
  it('discards originals on the day the sweep discards them', () => {
    expect(terms).toContain('UPLOAD_ORIGINAL_RETENTION_DAYS')
    expect(retentionMigration).toContain(`as $$ select ${UPLOAD_ORIGINAL_RETENTION_DAYS} $$`)
  })

  it('says that what is on the page outlives the file that was uploaded', () => {
    // The distinction a buyer needs before deleting their own copy.
    expect(prose).toMatch(/re-crop.{0,200}kept for as long as the page serves/)
  })
})

describe('the takedown path', () => {
  it('names an address, from the deployment rather than invented here', () => {
    expect(terms).toContain('readPrivacyContact')
  })

  it('promises a response time that is a number, once', () => {
    expect(terms).toContain('TAKEDOWN_RESPONSE_WORKING_DAYS')
    expect(TAKEDOWN_RESPONSE_WORKING_DAYS).toBeGreaterThan(0)
  })

  it('promises to remove one file rather than the invitation, which is what the code does', () => {
    expect(prose).toMatch(/remove the single file/)
    // The mechanism that makes that sentence true.
    expect(retentionMigration).toContain('create or replace function public.disable_upload')
  })

  it('has a repeat infringer policy, which is what any safe harbour rests on', () => {
    expect(prose).toMatch(/repeatedly are closed/)
  })

  it('puts the warranty and the indemnity in the same paragraph as the reporting address', () => {
    expect(prose).toMatch(/You warrant that you hold the rights/)
    expect(prose).toMatch(/indemnify us/)
  })

  it('admits the limit an immutable cache lifetime puts on a takedown', () => {
    /*
     * The uncomfortable sentence, and the reason it is asserted: a takedown
     * promise that implies recall is a promise that cannot be kept, and the
     * person relying on it is a rights holder rather than a customer.
     */
    expect(prose).toMatch(/Removing a file stops it being served/)
    expect(prose).toMatch(/does not reach the copy already on the phone/)
  })
})
