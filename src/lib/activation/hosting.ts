/**
 * The hosting term, from `activation_codes.hosting_months` to
 * `events.hosting_expires_at`.
 *
 * Its own module and pure, because it is a date calculation with one nasty case
 * and no reason to be tested through a database. `grace_ends_at` is deliberately
 * not computed here: `events_before_write` defaults it to hosting expiry plus
 * thirty days, so a second implementation of that sum in the app would be a
 * second answer to when a page stops serving.
 *
 * Months, not days, because that is what the column says and what a promotion
 * varies. "Twelve months of hosting" bought on 31 January has to mean something,
 * and the something is 28 or 29 February rather than 3 March: a term that
 * silently grew a couple of days every leap year is a term nobody can state.
 * Clamping to the last day of the target month is the same rule every calendar
 * application uses, and it is the only one that never lands outside the month
 * the buyer was promised.
 *
 * UTC throughout. Hosting expiry is a `timestamptz`, an instant, and unlike the
 * event's own start it is not a wall-clock promise to anybody: nobody is
 * standing anywhere at the moment a hosting term ends.
 */

const MONTHS_IN_YEAR = 12

/**
 * `from` plus `months`, clamped into the target month.
 *
 * Takes the instant rather than reading the clock, so a caller that has already
 * decided what "now" is cannot end up with two of them.
 */
export function addMonths(from: Date, months: number): Date {
  if (!Number.isInteger(months)) {
    throw new Error(`hosting months must be a whole number, got ${months}`)
  }

  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + months
  const targetYear = year + Math.floor(month / MONTHS_IN_YEAR)
  const targetMonth = ((month % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR

  // Day 0 of the following month is the last day of this one, which is how the
  // length of February gets asked for rather than remembered.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  )
}

/** Matches `activation_codes_hosting_months_range`. */
export const MIN_HOSTING_MONTHS = 1
export const MAX_HOSTING_MONTHS = 120

export function isHostingMonths(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_HOSTING_MONTHS && value <= MAX_HOSTING_MONTHS
}

/** When hosting bought at `from` for `months` runs out. */
export function hostingExpiresAt(from: Date, months: number): Date {
  if (!isHostingMonths(months)) {
    throw new Error(
      `hosting months must be between ${MIN_HOSTING_MONTHS} and ${MAX_HOSTING_MONTHS}, got ${months}`
    )
  }
  return addMonths(from, months)
}
