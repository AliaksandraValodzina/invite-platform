import { describe, expect, it } from 'vitest'

import {
  NEW_EVENT_DAYS_AHEAD,
  NEW_EVENT_TIME_ZONE,
  NEW_EVENT_TITLE,
  placeholderStart,
} from '@/lib/activation/mint'
import { isSupportedTimeZone, parseWallClock, resolveEventSchedule } from '@/lib/event/time'

/**
 * The row a new invitation is minted with, and the two columns on it that
 * cannot be arbitrary.
 *
 * Both doors reach the same placeholder: a spent claim code and the free
 * launch's open copy link at `/t/<templateId>/use`. They share
 * `src/lib/activation/mint.ts`, which is where these constants live and why
 * this file reads them from there rather than from the claim path.
 *
 * `events.starts_at_local` and `events.time_zone` are NOT NULL and nobody knows
 * the real answer at the moment a code is spent, so a placeholder goes in. The
 * placeholder has to satisfy BOTH gates, and they are not the same gate:
 *
 *   the database  `events_before_write` checks `pg_timezone_names`, which
 *                 contains bare `UTC`
 *   this app      `isSupportedTimeZone` requires an `Area/Location` name,
 *                 because the countdown resolves through `Intl` and a zone it
 *                 cannot format has no instant to count to
 *
 * A placeholder that clears the first and fails the second inserts happily and
 * then serves the designed "could not be loaded" notice on the buyer's own
 * page, and refuses their first save of the details for a reason the form
 * cannot explain. That is the bug this file exists to keep out, and it is not
 * hypothetical: `UTC` was the first choice here and did exactly that.
 */

describe('the placeholder an activation creates', () => {
  it('names a time zone this app can resolve a countdown in', () => {
    expect(isSupportedTimeZone(NEW_EVENT_TIME_ZONE)).toBe(true)
  })

  it('resolves to a real schedule, which is what the guest page needs', () => {
    const schedule = resolveEventSchedule({
      startsAtLocal: placeholderStart(new Date('2026-08-23T00:00:00Z')),
      endsAtLocal: null,
      timeZone: NEW_EVENT_TIME_ZONE,
    })

    expect(schedule).not.toBeNull()
  })

  it('is a wall clock the events column and the editor both accept', () => {
    const start = placeholderStart(new Date('2026-08-23T00:00:00Z'))

    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(parseWallClock(start)).not.toBeNull()
  })

  it('is far enough ahead to read as a stand-in rather than as a date somebody chose', () => {
    const now = new Date('2026-08-23T00:00:00Z')
    const expected = new Date(now.getTime() + NEW_EVENT_DAYS_AHEAD * 86_400_000)

    expect(placeholderStart(now)).toBe(`${expected.toISOString().slice(0, 10)}T16:00:00`)
  })

  it('carries no names, because the buyer has not given any yet', () => {
    // The title seeds the slug, and a slug minted from a template's example
    // couple would put somebody else's names in a buyer's public URL.
    expect(NEW_EVENT_TITLE).toBe('Your invitation')
  })
})
