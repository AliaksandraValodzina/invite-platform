/**
 * Formatting `events.starts_at_local` for the card.
 *
 * That column is a wall clock, not an instant: "Saturday at 4pm in Melbourne".
 * The countdown resolves it against `events.time_zone` because a countdown is a
 * duration and durations need instants. The card does not. It prints the words
 * on the invitation, so the only correct operation is to read the components of
 * the stored string and format them.
 *
 * This is why nothing here calls `new Date(string)`. Node parses a bare
 * `2027-03-14T16:00:00` in the machine's own zone, and the machine running this
 * is a Vercel function in UTC while the wedding is in Sydney. The components go
 * through `Date.UTC` and are formatted back in UTC, so the string in equals the
 * string out and a DST boundary has nothing to move.
 *
 * There is no time zone abbreviation on the card for the same reason: printing
 * "AEDT" would mean resolving the wall clock to an instant, and the two hours a
 * year where that is ambiguous are exactly the hours somebody schedules a
 * ceremony for.
 */

/** Fixed so the rendered card does not depend on a server locale. */
const LOCALE = 'en-AU'

const LOCAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/

const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
})

export type EventWhen = {
  readonly date: string
  readonly time: string
  /** The single line the card prints. */
  readonly line: string
}

/**
 * ICU puts U+202F before the meridiem and U+00A0 in some date forms. Both are
 * invisible in a diff, neither is what a test asserting a string expects, and
 * satori has no reason to have a glyph for either.
 */
function normaliseSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ')
}

export function formatEventWhen(startsAtLocal: string): EventWhen {
  const match = LOCAL_TIMESTAMP.exec(startsAtLocal)
  if (match === null) {
    throw new TypeError(
      `expected a stored local timestamp such as 2027-03-14T16:00:00, got "${startsAtLocal}"`
    )
  }

  const [, year, month, day, hour, minute, second] = match
  const parts = [year, month, day, hour, minute].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const instant = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], Number(second ?? '0'))
  )

  // Catches 2027-13-40T16:00:00, which matches the shape but is not a date.
  // Date.UTC rolls those over silently, so the round trip is the check.
  const roundTripped =
    instant.getUTCFullYear() === parts[0] &&
    instant.getUTCMonth() === parts[1] - 1 &&
    instant.getUTCDate() === parts[2] &&
    instant.getUTCHours() === parts[3] &&
    instant.getUTCMinutes() === parts[4]

  if (!roundTripped) {
    throw new TypeError(`"${startsAtLocal}" is not a real local timestamp`)
  }

  const date = normaliseSpaces(DATE_FORMAT.format(instant))
  const time = normaliseSpaces(TIME_FORMAT.format(instant))

  return { date, time, line: `${date} · ${time}` }
}
