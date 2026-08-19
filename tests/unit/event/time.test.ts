/**
 * The countdown is the one feature on a guest page that is wrong in a way
 * nobody notices until the day. These tests are the reason it is a pure
 * function taking an explicit `now` rather than something that reads the clock
 * itself: a DST boundary can be walked over deliberately instead of waited for.
 *
 * Sydney is used throughout because it is the captain's zone, it moves its
 * clocks in the opposite direction to the northern hemisphere, and its
 * transitions are at 2am and 3am rather than at midnight.
 */

import { describe, expect, it } from 'vitest'

import {
  countdownTo,
  formatEventDate,
  formatEventTime,
  resolveEventSchedule,
  wallClockToInstant,
  type WallClock,
} from '@/lib/event/time'

const SYDNEY = 'Australia/Sydney'

function wall(value: string): WallClock {
  const resolved = resolveEventSchedule({
    startsAtLocal: value,
    endsAtLocal: null,
    timeZone: SYDNEY,
  })
  if (resolved === null) throw new Error(`fixture ${value} did not resolve`)
  return resolved.startsAtLocal
}

describe('reading a stored wall clock', () => {
  it('accepts both shapes Postgres hands back for a timestamp without zone', () => {
    // PostgREST serialises as T-separated, psql and a raw dump as space
    // separated. A page must not depend on which client fetched the row.
    const tSeparated = resolveEventSchedule({
      startsAtLocal: '2027-03-14T16:00:00',
      endsAtLocal: null,
      timeZone: SYDNEY,
    })
    const spaceSeparated = resolveEventSchedule({
      startsAtLocal: '2027-03-14 16:00:00',
      endsAtLocal: null,
      timeZone: SYDNEY,
    })

    expect(tSeparated?.startsAt).toBe(spaceSeparated?.startsAt)
    expect(tSeparated?.startsAtLocal).toEqual({
      year: 2027,
      month: 3,
      day: 14,
      hour: 16,
      minute: 0,
      second: 0,
    })
  })

  it('returns null rather than throwing when the row is unusable', () => {
    // This runs on a request path. A malformed row has to produce a designed
    // error state upstream, never a stack trace in front of a guest.
    expect(
      resolveEventSchedule({ startsAtLocal: 'soon', endsAtLocal: null, timeZone: SYDNEY })
    ).toBeNull()
    expect(
      resolveEventSchedule({
        startsAtLocal: '2027-02-30T16:00:00',
        endsAtLocal: null,
        timeZone: SYDNEY,
      })
    ).toBeNull()
    expect(
      resolveEventSchedule({
        startsAtLocal: '2027-03-14T16:00:00',
        endsAtLocal: null,
        timeZone: 'Mars/Olympus_Mons',
      })
    ).toBeNull()
    expect(
      resolveEventSchedule({
        startsAtLocal: '2027-03-14T16:00:00',
        endsAtLocal: null,
        // An offset is a fact about a moment, not about a place. The schema
        // stores IANA names, and anything else has to be refused here too.
        timeZone: '+11:00',
      })
    ).toBeNull()
  })

  it('resolves an end time when there is one, and tolerates there not being one', () => {
    const withEnd = resolveEventSchedule({
      startsAtLocal: '2027-03-14T16:00:00',
      endsAtLocal: '2027-03-14T23:30:00',
      timeZone: SYDNEY,
    })

    expect(withEnd?.endsAtLocal).toEqual({
      year: 2027,
      month: 3,
      day: 14,
      hour: 23,
      minute: 30,
      second: 0,
    })

    const withoutEnd = resolveEventSchedule({
      startsAtLocal: '2027-03-14T16:00:00',
      endsAtLocal: null,
      timeZone: SYDNEY,
    })
    expect(withoutEnd?.endsAtLocal).toBeNull()
  })

  it('refuses an end time it cannot read instead of silently dropping it', () => {
    // Dropping it would render an event that quietly forgot when it finishes.
    expect(
      resolveEventSchedule({
        startsAtLocal: '2027-03-14T16:00:00',
        endsAtLocal: 'later',
        timeZone: SYDNEY,
      })
    ).toBeNull()
  })
})

describe('a wall clock is not an instant', () => {
  it('reads the same local time as two different instants either side of a DST change', () => {
    // 4pm in Sydney in March is +11. 4pm in Sydney in June is +10. Storing an
    // offset instead of a zone is what quietly breaks this.
    const march = wallClockToInstant(wall('2027-03-14T16:00:00'), SYDNEY)
    const june = wallClockToInstant(wall('2027-06-14T16:00:00'), SYDNEY)

    expect(march).toBe(Date.parse('2027-03-14T05:00:00Z'))
    expect(june).toBe(Date.parse('2027-06-14T06:00:00Z'))
  })

  it('handles a northern hemisphere zone too, so the rule is not a Sydney special case', () => {
    const london = wallClockToInstant(
      { year: 2027, month: 7, day: 3, hour: 15, minute: 0, second: 0 },
      'Europe/London'
    )

    expect(london).toBe(Date.parse('2027-07-03T14:00:00Z'))
  })

  it('resolves a local time that does not exist, forward across the gap', () => {
    // Sydney springs forward at 2am on 4 October 2026: 02:00 becomes 03:00, so
    // 02:30 is a wall clock that never happens. A buyer can type it into the
    // guided form, so it needs a defined answer rather than an Invalid Date.
    const instant = wallClockToInstant(
      { year: 2026, month: 10, day: 4, hour: 2, minute: 30, second: 0 },
      SYDNEY
    )

    // 03:30 AEDT, the same wall clock shifted forward by the length of the gap.
    expect(instant).toBe(Date.parse('2026-10-03T16:30:00Z'))
  })

  it('resolves an ambiguous local time to the later of its two occurrences', () => {
    // Sydney falls back at 3am on 4 April 2027, so 02:30 happens twice: once at
    // +11 and once at +10. The two differ by exactly an hour and either is
    // defensible; what matters is that it is decided here and tested, rather
    // than depending on which browser the guest opened the link in.
    const instant = wallClockToInstant(
      { year: 2027, month: 4, day: 4, hour: 2, minute: 30, second: 0 },
      SYDNEY
    )

    expect(instant).toBe(Date.parse('2027-04-03T16:30:00Z'))
  })
})

describe('formatting the date and the time', () => {
  it('prints the wall clock the buyer typed, whatever zone the guest is in', () => {
    // An invitation says "4:00 pm". Every guest sees the same string, because
    // the string is the promise, not a moment converted into their own zone.
    const schedule = resolveEventSchedule({
      startsAtLocal: '2027-03-14T16:00:00',
      endsAtLocal: '2027-03-14T23:30:00',
      timeZone: SYDNEY,
    })
    if (schedule === null) throw new Error('fixture did not resolve')

    expect(formatEventDate(schedule.startsAtLocal)).toBe('Sunday 14 March 2027')
    expect(formatEventTime(schedule.startsAtLocal)).toBe('4:00 pm')
    expect(formatEventTime(schedule.endsAtLocal!)).toBe('11:30 pm')
  })

  it('prints a morning time without a leading zero and a minute with one', () => {
    expect(formatEventTime({ year: 2027, month: 3, day: 14, hour: 9, minute: 5, second: 0 })).toBe(
      '9:05 am'
    )
  })
})

describe('the countdown itself', () => {
  const target = Date.parse('2027-03-14T05:00:00Z')

  it('counts down in the units the template asked for', () => {
    const now = target - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000)

    expect(countdownTo(target, now, ['days', 'hours', 'minutes', 'seconds'])).toEqual({
      passed: false,
      parts: [
        { unit: 'days', value: 2 },
        { unit: 'hours', value: 3 },
        { unit: 'minutes', value: 4 },
        { unit: 'seconds', value: 5 },
      ],
    })
  })

  it('rolls an unused unit into the next one it is allowed to show', () => {
    // A template that asks for days and minutes must not lose the hours. The
    // alternative is a countdown that is silently three hours short.
    const now = target - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000)

    expect(countdownTo(target, now, ['days', 'minutes'])).toEqual({
      passed: false,
      parts: [
        { unit: 'days', value: 2 },
        { unit: 'minutes', value: 184 },
      ],
    })
  })

  it('always reads largest unit first, whatever order the template listed them in', () => {
    // The schema permits any order. A countdown that reads "4 minutes, 2 days"
    // is a bug a guest sees, so order is the block set's decision, not the
    // template author's.
    const now = target - (2 * 86_400_000 + 4 * 60_000)

    expect(countdownTo(target, now, ['minutes', 'days']).parts).toEqual([
      { unit: 'days', value: 2 },
      { unit: 'minutes', value: 4 },
    ])
  })

  it('measures elapsed time, so a countdown spanning a DST change stays honest', () => {
    // Sydney springs forward on 4 October 2026, so 3 October 2026 to 6 October
    // 2026 is 3 days minus an hour of real time. Counting calendar days would
    // say 3 and be an hour wrong on the morning of the wedding.
    const start = wallClockToInstant(
      { year: 2026, month: 10, day: 3, hour: 18, minute: 0, second: 0 },
      SYDNEY
    )
    const wedding = wallClockToInstant(
      { year: 2026, month: 10, day: 6, hour: 18, minute: 0, second: 0 },
      SYDNEY
    )
    if (start === null || wedding === null) throw new Error('fixture did not resolve')

    expect(wedding - start).toBe(3 * 86_400_000 - 3_600_000)
    expect(countdownTo(wedding, start, ['days', 'hours']).parts).toEqual([
      { unit: 'days', value: 2 },
      { unit: 'hours', value: 23 },
    ])
  })

  it('reports passed at the target instant and after it, not a second later', () => {
    expect(countdownTo(target, target - 1, ['days']).passed).toBe(false)
    expect(countdownTo(target, target, ['days'])).toEqual({ passed: true, parts: [] })
    expect(countdownTo(target, target + 86_400_000, ['days']).passed).toBe(true)
  })

  it('never counts down past zero into negative units', () => {
    const result = countdownTo(target, target + 5_000, ['days', 'hours', 'minutes', 'seconds'])

    expect(result.passed).toBe(true)
    expect(result.parts).toEqual([])
  })
})
