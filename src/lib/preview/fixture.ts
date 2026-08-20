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
 * Five themes, and they are not the same kind of thing. `ivory` and `midnight`
 * are the placeholders committed with the template format, kept because the
 * Phase 0.4 suite is written against them. The other three are the template
 * line: the design directions from data/ip-design-directions/report.md, which
 * the captain decided on 2026-08-20 to build all of rather than choose between.
 */

import classicInvitation from '../../../templates/definitions/classic-invitation.json'
import deckleAndDeboss from '../../../templates/themes/deckle-and-deboss.json'
import foilAndMidnight from '../../../templates/themes/foil-and-midnight.json'
import ivory from '../../../templates/themes/ivory.json'
import masthead from '../../../templates/themes/masthead.json'
import midnight from '../../../templates/themes/midnight.json'
import type { EventSchedule } from '@/lib/event/time'
import { DEFAULT_RSVP_QUESTIONS, type RsvpQuestion } from '@/lib/rsvp/questions'

export const PREVIEW_DEFINITION: unknown = classicInvitation

/**
 * The three directions carry the names the report gave them. They are not
 * harmonised, renamed or reordered here: their separateness is the product.
 */
export const DESIGN_DIRECTIONS: readonly {
  readonly key: string
  readonly name: string
  readonly mood: string
  /** The signature element the report designed for it, which is not a token. */
  readonly signature: string
}[] = [
  {
    key: 'deckle-and-deboss',
    name: 'Deckle & Deboss',
    mood: 'A single ink letterpress card on heavy cotton stock with a deckled edge.',
    signature:
      'The pressed monogram: couple initials in a debossed circle at the head of the page, repeated at caption size as the RSVP confirmation mark.',
  },
  {
    key: 'masthead',
    name: 'Masthead',
    mood: 'Modern editorial: the opening spread of a fashion title, names set as a masthead.',
    signature:
      'The full bleed date lockup: the date on one line at display size, letter-spaced to touch both page margins, with the countdown units as a caption row beneath it.',
  },
  {
    key: 'foil-and-midnight',
    name: 'Foil & Midnight',
    mood: 'A 1930s foil stamped invitation: midnight blue card, brass foil, inscriptional capitals.',
    signature:
      'The stepped arch aperture: the hero photograph inside a deco stepped arch with a one pixel brass keyline, appearing exactly once on the page.',
  },
]

/** The placeholder themes from Phase 0.3, which are not part of the template line. */
export const PLACEHOLDER_THEMES = ['ivory', 'midnight'] as const

export const PREVIEW_THEMES: Readonly<Record<string, unknown>> = {
  ivory,
  midnight,
  'deckle-and-deboss': deckleAndDeboss,
  masthead,
  'foil-and-midnight': foilAndMidnight,
}

export const PREVIEW_THEME_NAMES = Object.keys(PREVIEW_THEMES)

/**
 * A wall clock and a zone, exactly as `events` stores them. Sydney because it
 * is the captain's zone and it moves its clocks the other way from most of the
 * examples anyone will have read. 14 March 2027 is also the date the design
 * directions report used throughout.
 */
export const PREVIEW_EVENT: EventSchedule = {
  startsAtLocal: '2027-03-14T16:00:00',
  endsAtLocal: '2027-03-14T23:30:00',
  timeZone: 'Australia/Sydney',
}

/**
 * Content overrides, keyed by block id, which is the shape `event_content`
 * stores.
 *
 * `long-names` exists because the type measurements in the design directions
 * report found that the sample couple hides the failure: "Emma & Jake" fits on
 * one line at 320px in every direction and "Alexandra & Christopher" overflows
 * in all three. The 320px overflow test runs against this fixture rather than
 * the pretty one.
 *
 * `report-sample` is the content the three directions were designed and
 * measured against, so it is the one to look at when judging a direction rather
 * than when testing the block set.
 *
 * `no-artwork` clears the hero artwork the template names, so each direction can
 * be looked at with the band and without it. It is a real content override doing
 * a real thing rather than a preview switch: `null` in an override means "clear
 * this field", which is how a buyer deletes something out of the guided form, so
 * this fixture also happens to be the only place that path is visible on screen.
 */
export const PREVIEW_FIXTURES: Readonly<Record<string, unknown>> = {
  sample: { version: 1, blocks: {} },
  'no-artwork': { version: 1, blocks: { hero: { artwork: null } } },
  'long-names': {
    version: 1,
    blocks: { hero: { headline: 'Alexandra & Christopher' } },
  },
  'report-sample': {
    version: 1,
    blocks: {
      hero: {
        eyebrow: 'Together with their families',
        headline: 'Emma & Jake',
        subhead: 'are getting married',
      },
      'venue-map': {
        heading: 'Where',
        venueName: 'The Grounds of Alexandria',
        address: '7a, 2 Huntley St\nAlexandria NSW 2015',
        directionsUrl: 'https://maps.google.com/?q=The+Grounds+of+Alexandria',
        note: 'The ceremony is in the garden, then dinner in the potting shed.',
      },
      rsvp: {
        heading: 'Will you be there?',
        intro: 'One reply per invitation, please. If plans change, just send another.',
        submitLabel: 'Send RSVP',
        successMessage: 'Thank you. Emma and Jake have your reply.',
        closedMessage: 'RSVPs are closed for this event. Please contact Emma or Jake directly.',
        deadlineNote: 'Please reply by 14 February 2027.',
        guestCount: { enabled: true, label: 'How many of you?', max: 6 },
      },
    },
  },
}

/**
 * The questions the preview draws, since a question is a row and the preview
 * reads no rows.
 *
 * This is the default set from `src/lib/rsvp/questions.ts` with ids attached,
 * plus one choice question that no event ships with. The extra one is not
 * decoration: multiple_choice and checkbox are shipped question types with no
 * shipped default question, so without it the two controls the block set draws
 * for them would never be looked at on a phone until the first buyer added one.
 */
export const PREVIEW_QUESTIONS: readonly RsvpQuestion[] = [
  ...DEFAULT_RSVP_QUESTIONS.map((question, index) => ({
    id: `preview-${question.key}`,
    type: question.type,
    prompt: question.prompt,
    position: index + 1,
    required: question.required,
    options: question.options,
    piiClass: question.piiClass,
  })),
  {
    id: 'preview-courses',
    type: 'multiple_choice' as const,
    prompt: 'Which will you have?',
    position: DEFAULT_RSVP_QUESTIONS.length + 1,
    required: false,
    options: [
      { value: 'fish', label: 'Fish' },
      { value: 'beef', label: 'Beef' },
      { value: 'vegetarian', label: 'Vegetarian' },
    ],
    piiClass: 'none' as const,
  },
]

export const PREVIEW_FIXTURE_NAMES = Object.keys(PREVIEW_FIXTURES)

export const DEFAULT_PREVIEW_FIXTURE = 'sample'
