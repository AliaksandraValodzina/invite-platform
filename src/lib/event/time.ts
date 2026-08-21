/**
 * Event time, resolved from the pair the database calls the source of truth.
 *
 * `events.starts_at_local` is a wall clock ("Saturday at 4pm") and
 * `events.time_zone` is an IANA name. `starts_at_utc` is a cache and is
 * deliberately not used here: a page resolves the local pair on every read, so
 * a government moving a DST boundary between activation and the wedding changes
 * the answer the next time a guest opens the link, which is the behaviour the
 * schema was shaped around. See docs/data-model.md, "Event time".
 *
 * Two properties everything in this file is built around.
 *
 * Nothing throws. This runs while a guest is looking at the page. A row that
 * cannot be read produces `null` and a designed state upstream, never a stack
 * trace and never an "Invalid Date" rendered into an invitation.
 *
 * `now` is always a parameter. A countdown that reads the clock itself cannot
 * be tested across a DST boundary without waiting for one, and the boundary is
 * exactly where this kind of code is wrong.
 */

import { COUNTDOWN_UNITS } from '@/lib/template'

export type CountdownUnit = (typeof COUNTDOWN_UNITS)[number]

/** A local date and time with no zone attached, which is what a promise is. */
export type WallClock = {
  readonly year: number
  /** 1 to 12, not the 0 to 11 that Date uses. */
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** The three fields a page needs off the event row in order to render time. */
export type EventSchedule = {
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
}

export type ResolvedSchedule = {
  /** Epoch milliseconds. What the countdown counts to. */
  readonly startsAt: number
  readonly startsAtLocal: WallClock
  readonly endsAtLocal: WallClock | null
  readonly timeZone: string
}

/**
 * The product formats dates in one locale rather than the guest's.
 *
 * An invitation is a printed object: every guest should read the same words the
 * couple wrote, in the same order. Formatting per guest would show one of them
 * "3/14/2027" and make the page look like software instead of stationery.
 */
const EVENT_LOCALE = 'en-AU'

const MS = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
} as const satisfies Record<CountdownUnit, number>

/**
 * Accepts both shapes Postgres hands back for `timestamp without time zone`:
 * `2027-03-14T16:00:00` from PostgREST and `2027-03-14 16:00:00` from a dump.
 * Seconds and fractional seconds are optional. Anything carrying a zone or an
 * offset is refused, because this column is a wall clock and a value with an
 * offset in it means something upstream has already made the mistake this
 * module exists to prevent.
 */
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/

export function parseWallClock(value: string): WallClock | null {
  const match = WALL_CLOCK_PATTERN.exec(value.trim())
  if (match === null) return null

  const [, year, month, day, hour, minute, second] = match
  const parsed: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? 0 : Number(second),
  }

  // The pattern accepts 2027-02-30 and 25:00. Round tripping through Date is
  // what rejects them, because Date silently rolls them over into March and the
  // next day, and a rolled over date is a wrong date rendered confidently.
  const roundTrip = new Date(asUtcMilliseconds(parsed))
  if (
    roundTrip.getUTCFullYear() !== parsed.year ||
    roundTrip.getUTCMonth() + 1 !== parsed.month ||
    roundTrip.getUTCDate() !== parsed.day ||
    roundTrip.getUTCHours() !== parsed.hour ||
    roundTrip.getUTCMinutes() !== parsed.minute
  ) {
    return null
  }

  return parsed
}

/**
 * Converts a wall clock in a named zone to an instant.
 *
 * The offset of a zone depends on the instant, and the instant is what we are
 * trying to find, so this guesses and then corrects: read the offset at the
 * naive guess, apply it, then read the offset again at the corrected instant
 * and re-apply if the two disagree. Two passes is enough for every real zone,
 * because a transition is at most a couple of hours and no zone transitions
 * twice within one.
 *
 * The two edge cases are decided here rather than left to whichever browser the
 * guest happened to open the link in:
 *
 *   a local time that does not exist (the hour a zone springs forward through)
 *   resolves forward across the gap, so 02:30 on a 2am-to-3am morning becomes
 *   03:30.
 *
 *   a local time that happens twice (the hour a zone falls back through)
 *   resolves to the later of the two.
 *
 * Both are tested. Either choice is defensible and they differ by exactly an
 * hour; what is not defensible is not knowing which one the product does.
 */
export function wallClockToInstant(wallClock: WallClock, timeZone: string): number | null {
  if (!isSupportedTimeZone(timeZone)) return null

  const naive = asUtcMilliseconds(wallClock)

  const firstOffset = zoneOffsetAt(naive, timeZone)
  if (firstOffset === null) return null

  const candidate = naive - firstOffset

  const secondOffset = zoneOffsetAt(candidate, timeZone)
  if (secondOffset === null) return null

  return secondOffset === firstOffset ? candidate : naive - secondOffset
}

export function resolveEventSchedule(schedule: EventSchedule): ResolvedSchedule | null {
  const startsAtLocal = parseWallClock(schedule.startsAtLocal)
  if (startsAtLocal === null) return null

  const startsAt = wallClockToInstant(startsAtLocal, schedule.timeZone)
  if (startsAt === null) return null

  let endsAtLocal: WallClock | null = null
  if (schedule.endsAtLocal !== null) {
    endsAtLocal = parseWallClock(schedule.endsAtLocal)
    // Refused rather than dropped. Rendering an event that quietly forgot when
    // it finishes is worse than refusing to render it.
    if (endsAtLocal === null) return null
  }

  return { startsAt, startsAtLocal, endsAtLocal, timeZone: schedule.timeZone }
}

/** "Sunday 14 March 2027". */
export function formatEventDate(wallClock: WallClock): string {
  return format(wallClock, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** "4:00 pm". */
export function formatEventTime(wallClock: WallClock): string {
  return format(wallClock, { hour: 'numeric', minute: '2-digit', hour12: true })
}

export type CountdownPart = {
  readonly unit: CountdownUnit
  readonly value: number
}

export type CountdownResult = {
  readonly passed: boolean
  /** Empty once the event has started. The block renders `passedMessage` then. */
  readonly parts: readonly CountdownPart[]
}

/**
 * Splits the remaining time into the units a template asked for.
 *
 * Two decisions the template does not get to make. Units always read largest
 * first, whatever order they were listed in, because "4 minutes, 2 days" is a
 * bug a guest sees. And a unit that was not asked for is rolled into the next
 * one that was, so a template showing days and minutes is not silently three
 * hours short.
 *
 * Values are floored, so a countdown showing days and hours reads "0 hours" for
 * the last fifty nine minutes. That is the honest answer for the units asked
 * for; rounding up would show an hour that has already gone.
 */
export function countdownTo(
  targetMs: number,
  nowMs: number,
  units: readonly CountdownUnit[]
): CountdownResult {
  const remaining = targetMs - nowMs
  if (remaining <= 0) return { passed: true, parts: [] }

  const asked = new Set(units)
  const parts: CountdownPart[] = []
  let rest = remaining

  for (const unit of COUNTDOWN_UNITS) {
    if (!asked.has(unit)) continue

    const size = MS[unit]
    parts.push({ unit, value: Math.floor(rest / size) })
    rest %= size
  }

  return { passed: false, parts }
}

/**
 * Reads a zone's offset, in milliseconds, at a given instant.
 *
 * `Intl` is the only thing in the platform that knows the tz database, and it
 * only formats, so the offset is recovered by formatting the instant in the
 * zone and asking what those parts would be if they were UTC.
 */
function zoneOffsetAt(instantMs: number, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs))
  } catch {
    return null
  }

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)
    return part === undefined ? Number.NaN : Number(part.value)
  }

  // hourCycle h23 so midnight is 00 rather than 24, which would roll the day.
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second')
  )
  if (Number.isNaN(asUtc)) return null

  return asUtc - instantMs
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(timeZone)
  if (cached !== undefined) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  zoneFormatters.set(timeZone, formatter)
  return formatter
}

/**
 * IANA names only.
 *
 * `Intl` accepts `+11:00` as a time zone and `UTC` resolves too, but the schema
 * stores names validated against `pg_timezone_names`, and an offset is a fact
 * about a moment rather than about a place. Accepting one here would let a row
 * that dodged the database trigger render a countdown that stops being correct
 * the next time the zone moves.
 */
/**
 * Whether this runtime knows the zone.
 *
 * Exported because the editor has to refuse a zone a buyer typed with a
 * sentence rather than letting `events_before_write` refuse it with a Postgres
 * error, and a second implementation of "is this a real zone" is a second answer
 * to the question the countdown depends on.
 */
export function isSupportedTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timeZone)) return false

  try {
    zoneFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * Formats a wall clock by treating it as UTC and formatting it in UTC, which is
 * the whole trick: the parts go in and come back unchanged, so no conversion
 * can shift the date the buyer typed across midnight.
 */
function format(wallClock: WallClock, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(EVENT_LOCALE, { ...options, timeZone: 'UTC' }).format(
    new Date(asUtcMilliseconds(wallClock))
  )
}

function asUtcMilliseconds(wallClock: WallClock): number {
  return Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
    wallClock.second
  )
}
