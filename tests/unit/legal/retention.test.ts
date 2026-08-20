import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DATA_REGION_FALLBACK,
  GRACE_DAYS,
  PRIVACY_CONTACT_FALLBACK,
  PURGE_DAYS,
  readDataRegion,
  readPrivacyContact,
  REDACTION_DAYS,
  SWEEP_TIME_UTC,
} from '@/lib/legal/retention'

/**
 * The privacy statement makes promises about days, and something has to check
 * that the job keeping them uses the same numbers.
 *
 * Retention text that disagrees with the code is worse than no retention text:
 * it is a promise nobody is keeping and everybody believes. So these read the
 * migrations that actually run and compare them with what the page prints.
 */

function migration(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../supabase/migrations/${name}`, import.meta.url)),
    'utf8'
  )
}

const events = migration('20260819010400_events.sql')
const retention = migration('20260821010100_retention_over_answers.sql')
const purge = migration('20260819010800_retention.sql')
const schedule = migration('20260819010900_schedule_retention.sql')

describe('the retention schedule the page prints', () => {
  it('uses the grace period the events trigger actually applies', () => {
    expect(events).toContain(`new.hosting_expires_at + interval '${GRACE_DAYS} days'`)
  })

  it('erases answers on the day the sweep erases them', () => {
    expect(retention).toContain(`e.grace_ends_at + interval '${REDACTION_DAYS} days' <= p_now`)
  })

  it('deletes events on the day the purge deletes them', () => {
    expect(purge).toContain(`e.grace_ends_at + interval '${PURGE_DAYS} days' <= p_now`)
  })

  it('names the time the sweep is scheduled for', () => {
    const [hour, minute] = SWEEP_TIME_UTC.split(':')
    // cron writes an hour without a leading zero; the page writes a clock time.
    expect(schedule).toContain(`${minute} ${Number(hour)} * * *`)
  })
})

const privacyPage = readFileSync(
  fileURLToPath(new URL('../../../src/app/privacy/page.tsx', import.meta.url)),
  'utf8'
)

describe('what the privacy page hardcodes', () => {
  /**
   * AGENTS.md forbids a hosted region appearing in this repo: it is chosen once,
   * it is effectively irreversible, and it is the captain's call. The statement
   * has to name one anyway, so it reads the deployment's own configuration.
   */
  it('names no region of its own', () => {
    const regionish =
      /\b(us-east|us-west|ap-southeast|ap-northeast|eu-west|eu-central|sa-east|ca-central)[-\s]?\d?\b/i
    expect(privacyPage).not.toMatch(regionish)
  })

  it('reads the region and the contact address from the deployment', () => {
    expect(privacyPage).toContain('readDataRegion')
    expect(privacyPage).toContain('readPrivacyContact')
  })

  it('prints the numbers rather than restating them in prose', () => {
    for (const marker of ['GRACE_DAYS', 'REDACTION_DAYS', 'PURGE_DAYS', 'SWEEP_TIME_UTC']) {
      expect(privacyPage).toContain(marker)
    }
  })

  /**
   * A statement that says the wrong address is worse than one that admits it
   * has none, because somebody writes to it and nobody answers. Both fallbacks
   * are deliberately not plausible addresses.
   */
  it('admits when the deployment has not been configured, rather than inventing something', () => {
    expect(readPrivacyContact({})).toBe(PRIVACY_CONTACT_FALLBACK)
    expect(readDataRegion({})).toBe(DATA_REGION_FALLBACK)
    expect(PRIVACY_CONTACT_FALLBACK).not.toContain('@')
  })

  it('uses the configured values when they are set', () => {
    expect(readPrivacyContact({ NEXT_PUBLIC_PRIVACY_CONTACT: 'privacy@example.test' })).toBe(
      'privacy@example.test'
    )
    expect(readDataRegion({ NEXT_PUBLIC_DATA_REGION: 'the United States' })).toBe(
      'the United States'
    )
  })

  it('treats whitespace as absent, so a half-filled deployment does not print a blank', () => {
    expect(readPrivacyContact({ NEXT_PUBLIC_PRIVACY_CONTACT: '   ' })).toBe(
      PRIVACY_CONTACT_FALLBACK
    )
  })
})

/**
 * The same source with its line breaks collapsed. Prettier decides where a
 * sentence wraps, and an assertion that a sentence is present should not fail
 * because of where it wrapped.
 */
const prose = privacyPage.replace(/\s+/g, ' ')

describe('what the privacy page has to say, because the plan requires it', () => {
  it('says the unusual thing: no address, no device, no trackers', () => {
    expect(prose).toContain('No IP address')
    expect(prose).toContain('advertising trackers')
  })

  it('names who can see a reply, including us', () => {
    expect(prose).toContain('as the operator')
  })

  it('tells a guest how to ask to be erased, and by when we answer', () => {
    expect(prose).toContain('30 days')
  })

  it('covers the Australian Privacy Act and the GDPR controller split', () => {
    expect(prose).toContain('Australian Privacy Principles')
    expect(prose).toMatch(/controller.{0,120}processor/)
  })

  it('says it is not legal advice, rather than implying it is', () => {
    expect(prose).toContain('not legal advice')
  })
})
