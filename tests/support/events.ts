import {
  DEFAULT_OWNER_EMAIL,
  seedEvent,
  type SeedState,
  type SeededEvent,
} from '../../scripts/seed-event'
import { DEFAULT_RSVP_QUESTIONS } from '../../src/lib/rsvp/questions.ts'

/**
 * The fixtures the browser suite opens, seeded through the same script the
 * captain runs by hand.
 *
 * One implementation of "make an event", not two. A test helper with its own
 * inserts would drift from the script, and the first thing to drift would be
 * the pair of timestamps that decide which serving state a row is in, which is
 * the exact thing these tests exist to walk.
 *
 * The names are deliberately unusual. Two of the assertions are that an
 * unpublished page and an expired page carry none of the couple's details, and
 * a fixture called "Emma & Jake" would make that assertion pass against a page
 * that happened to contain the word "Emma" for some other reason.
 */

/** Distinctive enough that finding it in a page is never a coincidence. */
export const GUEST_TITLE = 'Wilhelmina Ashgrove & Bartholomew Quist'
export const GUEST_HEADLINE = 'Wilhelmina & Bartholomew'
export const GUEST_VENUE = 'The Quist Family Orangery'
export const GUEST_EYEBROW = 'Together with their families'
export const GUEST_CLOSED_MESSAGE = 'Replies have closed. Please call Wilhelmina or Bartholomew.'

/** 4pm on 14 March 2027 in Sydney, which is the date the design work used. */
export const GUEST_STARTS_AT_LOCAL = '2027-03-14T16:00:00'
export const GUEST_ENDS_AT_LOCAL = '2027-03-14T23:30:00'
export const GUEST_TIME_ZONE = 'Australia/Sydney'

export const GUEST_CONTENT = {
  version: 1,
  blocks: {
    hero: {
      eyebrow: GUEST_EYEBROW,
      headline: GUEST_HEADLINE,
      subhead: 'are getting married',
    },
    'venue-map': {
      heading: 'Where',
      venueName: GUEST_VENUE,
      address: '14 Orangery Lane\nAshgrove NSW 2000',
      directionsUrl: 'https://maps.google.com/?q=The+Quist+Family+Orangery',
    },
    rsvp: {
      heading: 'Will you be there?',
      submitLabel: 'Send our reply',
      successMessage: 'Thank you. Wilhelmina and Bartholomew have your reply.',
      closedMessage: GUEST_CLOSED_MESSAGE,
    },
  },
}

/**
 * The prompts the seeded events ask, so a test can find a control by its label
 * without repeating the copy.
 *
 * Read from the default question set rather than written out again: the form is
 * rendered from rows created from that list, and a test that carried its own
 * copy of the prompts would keep passing after somebody changed one.
 */
export const GUEST_QUESTION_PROMPTS = Object.fromEntries(
  DEFAULT_RSVP_QUESTIONS.map((question) => [question.key, question.prompt])
) as Record<string, string>

/** A buyer with a real auth user, which every seeded event belongs to. */
export const GUEST_OWNER_EMAIL = DEFAULT_OWNER_EMAIL

export async function seedGuestEvent(
  state: SeedState,
  options: {
    readonly publishContent?: boolean
    readonly ownerEmail?: string
    readonly questions?: Record<string, unknown>[]
  } = {}
): Promise<SeededEvent> {
  return seedEvent({
    title: GUEST_TITLE,
    startsAtLocal: GUEST_STARTS_AT_LOCAL,
    endsAtLocal: GUEST_ENDS_AT_LOCAL,
    timeZone: GUEST_TIME_ZONE,
    themeKey: 'deckle-and-deboss',
    state,
    content: GUEST_CONTENT,
    ...(options.publishContent === undefined ? {} : { publishContent: options.publishContent }),
    ...(options.ownerEmail === undefined ? {} : { ownerEmail: options.ownerEmail }),
    ...(options.questions === undefined ? {} : { questions: options.questions }),
  })
}

/** A slug shaped like a real one that no row has ever carried. */
export const MISSING_SLUG = 'no-such-invitation-000000'
