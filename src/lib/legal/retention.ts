/**
 * The retention schedule, as numbers the privacy statement prints.
 *
 * Retention text that disagrees with the code is worse than no retention text,
 * because it is a promise nobody is keeping and everybody believes. So the page
 * does not restate these in prose: it renders them from here, and
 * `tests/unit/legal/retention.test.ts` reads the migrations and fails if any of
 * these numbers stops matching the SQL that actually runs.
 *
 * The migrations are the source of truth. This file is the copy, and the test
 * is what makes a copy safe.
 */

/** Days after hosting expires that the page keeps serving. 20260819010400_events.sql. */
export const GRACE_DAYS = 30

/** Days after grace ends that identifying answers are erased. 20260821010100. */
export const REDACTION_DAYS = 30

/** Days after grace ends that the event and everything under it is deleted. */
export const PURGE_DAYS = 365

/** When the sweep runs, UTC. 20260819010900_schedule_retention.sql. */
export const SWEEP_TIME_UTC = '03:17'

/**
 * The address a guest or a buyer writes to about their data.
 *
 * Deployment configuration rather than a literal, because the domain is not
 * bought yet and a privacy statement naming an address nobody reads is worse
 * than one that admits it is not configured. `PRIVACY_CONTACT_FALLBACK` is what
 * renders when it is absent, and it is deliberately not a plausible looking
 * address.
 */
export const PRIVACY_CONTACT_FALLBACK = 'not configured yet'

export function readPrivacyContact(
  source: Record<string, string | undefined> = process.env
): string {
  const value = (source.NEXT_PUBLIC_PRIVACY_CONTACT ?? '').trim()
  return value === '' ? PRIVACY_CONTACT_FALLBACK : value
}

/**
 * Where the database lives, named for the privacy statement.
 *
 * It comes from the environment because AGENTS.md forbids a hosted region
 * appearing in this repo: it is chosen once, it is effectively irreversible, and
 * it is the captain's call. The statement has to say it anyway, so the page
 * reads it from the deployment and says plainly when the deployment has not
 * been told. `tests/unit/legal/retention.test.ts` asserts that no region is
 * hardcoded here or on the page.
 */
export const DATA_REGION_FALLBACK = 'not configured yet'

export function readDataRegion(source: Record<string, string | undefined> = process.env): string {
  const value = (source.NEXT_PUBLIC_DATA_REGION ?? '').trim()
  return value === '' ? DATA_REGION_FALLBACK : value
}
