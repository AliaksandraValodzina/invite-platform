/**
 * The fixture behind /preview/<theme>.
 *
 * Phase 0.4 has no guest page and no database read yet, so the only way to look
 * at the block set on a phone is to render the committed seed documents through
 * the real read path. This module is what supplies them, and it is deliberately
 * the same JSON that `tests/unit/template/seed.test.ts` gates and that a
 * seeding script will insert: a preview built from a hand written copy of the
 * template would stop being a preview the first time the two drifted.
 *
 * The two themes here are the placeholders committed with the template format,
 * not design directions. The three directions in data/ip-design-directions are
 * values the captain has not chosen between yet, and this task does not choose
 * for them: it proves the block set renders whatever tokens it is handed.
 */

import classicInvitation from '../../../templates/definitions/classic-invitation.json'
import ivory from '../../../templates/themes/ivory.json'
import midnight from '../../../templates/themes/midnight.json'
import type { EventSchedule } from '@/lib/event/time'

export const PREVIEW_DEFINITION: unknown = classicInvitation

export const PREVIEW_THEMES: Readonly<Record<string, unknown>> = { ivory, midnight }

export const PREVIEW_THEME_NAMES = Object.keys(PREVIEW_THEMES)

/**
 * A wall clock and a zone, exactly as `events` stores them. Sydney because it
 * is the captain's zone and it moves its clocks the other way from most of the
 * examples anyone will have read.
 */
export const PREVIEW_EVENT: EventSchedule = {
  startsAtLocal: '2027-03-14T16:00:00',
  endsAtLocal: '2027-03-14T23:30:00',
  timeZone: 'Australia/Sydney',
}

/**
 * Content overrides, keyed by block id, which is the shape `event_content`
 * stores. `long-names` exists because the type measurements in the design
 * directions report found that the sample couple hides the failure: "Emma &
 * Jake" fits on one line at 320px in every direction and "Alexandra &
 * Christopher" overflows in all three. The 320px overflow test runs against
 * this fixture rather than the pretty one.
 */
export const PREVIEW_FIXTURES: Readonly<Record<string, unknown>> = {
  sample: { version: 1, blocks: {} },
  'long-names': {
    version: 1,
    blocks: { hero: { headline: 'Alexandra & Christopher' } },
  },
}

export const DEFAULT_PREVIEW_FIXTURE = 'sample'
