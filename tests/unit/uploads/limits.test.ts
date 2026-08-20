import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  UPLOAD_EVENT_VARIANT_BUDGET,
  UPLOAD_KINDS,
  UPLOAD_KIND_SPECS,
  UPLOAD_MAX_BYTES,
} from '@/lib/uploads'

/**
 * The limits in TypeScript, held to the limits in SQL.
 *
 * There are two copies of these numbers and there have to be. The database is
 * where they are enforced, because a check in a route can be raced by two
 * uploads in flight and forgotten by the next route that writes to the table.
 * The TypeScript copy is what lets a buyer be refused with a sentence rather
 * than a stack trace. A copy is only safe if something fails when the two stop
 * agreeing, and this is that something: it reads the migration, not a fixture.
 *
 * The same shape as `tests/unit/legal/retention.test.ts`, which holds the days
 * the privacy statement prints to the days the sweep uses, and for the same
 * reason.
 */

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260821010300_uploads.sql', import.meta.url)
  ),
  'utf8'
)

const RETENTION_MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260821010400_uploads_retention.sql', import.meta.url)
  ),
  'utf8'
)

/** Pulls one `when '<kind>' then <n>` out of public.upload_kind_cap. */
function capInSql(kind: string): number {
  const match = MIGRATION.match(new RegExp(`when '${kind}' then (\\d+)`))
  if (match === null) throw new Error(`public.upload_kind_cap has no branch for ${kind}`)
  return Number(match[1])
}

describe('the per event caps', () => {
  it('match the database, kind for kind', () => {
    for (const kind of UPLOAD_KINDS) {
      expect(UPLOAD_KIND_SPECS[kind].perEvent, `${kind} cap`).toBe(capInSql(kind))
    }
  })

  it('are the captain decision of 2026-08-20: 30 photos, one music file, one envelope', () => {
    expect(UPLOAD_KIND_SPECS.image.perEvent).toBe(30)
    expect(UPLOAD_KIND_SPECS.audio.perEvent).toBe(1)
    expect(UPLOAD_KIND_SPECS.envelope.perEvent).toBe(1)
  })
})

describe('the byte limits', () => {
  it('accept ten megabytes per file, in both places', () => {
    expect(UPLOAD_MAX_BYTES).toBe(10_000_000)
    expect(MIGRATION).toContain(`select ${UPLOAD_MAX_BYTES}::bigint`)
    // And as a check constraint, so dropping the trigger does not raise it.
    expect(MIGRATION).toContain(`check (bytes between 1 and ${UPLOAD_MAX_BYTES})`)
  })

  it('bound what is stored per event, which is the number that decides the bill', () => {
    expect(MIGRATION).toContain(`select ${UPLOAD_EVENT_VARIANT_BUDGET}::bigint`)
  })

  it('leave room for the caps they sit next to', () => {
    /*
     * Not arithmetic for its own sake. If 30 photos at three WebP widths could
     * not fit inside the budget, the advertised cap would be a cap nobody can
     * reach, and a buyer would hit an error message about "total size" while
     * counting photos. 120 KB per derivative is generous for WebP at these
     * widths; the measured figure in encode.test.ts is well under it.
     */
    const generousDerivative = 120_000
    const worstCase =
      UPLOAD_KIND_SPECS.image.perEvent *
      UPLOAD_KIND_SPECS.image.variants.length *
      generousDerivative
    expect(worstCase).toBeLessThan(UPLOAD_EVENT_VARIANT_BUDGET)
  })
})

describe('the retention windows', () => {
  it('discard originals thirty days after publication, in both places', () => {
    expect(RETENTION_MIGRATION).toContain('select 30 $$')
    expect(RETENTION_MIGRATION).toContain('upload_original_retention_days')
  })

  it('discard derivatives when grace ends, which is when the page stops serving', () => {
    expect(RETENTION_MIGRATION).toContain('e.grace_ends_at <= p_now')
  })

  it('run inside the sweep that already exists rather than on a second schedule', () => {
    expect(RETENTION_MIGRATION).toContain('create or replace function public.run_retention_sweep')
    expect(RETENTION_MIGRATION).toContain('public.discard_expired_upload_originals(p_now)')
    expect(RETENTION_MIGRATION).toContain('public.discard_expired_upload_derivatives(p_now)')
    // And nothing here schedules a second cron job.
    expect(RETENTION_MIGRATION).not.toContain('cron.schedule')
  })
})

describe('every kind is fully specified', () => {
  it('has a cap, a set of formats and at least one variant', () => {
    for (const kind of UPLOAD_KINDS) {
      const spec = UPLOAD_KIND_SPECS[kind]
      expect(spec.perEvent).toBeGreaterThan(0)
      expect(spec.accepts.length).toBeGreaterThan(0)
      expect(spec.variants.length).toBeGreaterThan(0)
    }
  })

  it('gives every re-encoded kind widths, and the passthrough kind none', () => {
    for (const kind of UPLOAD_KINDS) {
      const spec = UPLOAD_KIND_SPECS[kind]
      const widths = spec.variants.map((variant) => variant.width)
      if (spec.encode === 'image') {
        expect(widths.every((width) => typeof width === 'number')).toBe(true)
      } else {
        expect(widths.every((width) => width === undefined)).toBe(true)
      }
    }
  })

  it('uses variant labels that survive being put in an object key', () => {
    for (const kind of UPLOAD_KINDS) {
      for (const variant of UPLOAD_KIND_SPECS[kind].variants) {
        expect(variant.label).toMatch(/^[a-z0-9]+$/)
      }
    }
  })
})
