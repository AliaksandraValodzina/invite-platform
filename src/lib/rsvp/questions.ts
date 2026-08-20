/**
 * The question model, shared by everything that touches a reply.
 *
 * This module imports nothing, on purpose. `scripts/seed-event.ts` says it
 * deliberately imports nothing from `src/`, because Node runs a `.ts` file by
 * stripping the types and the app's modules are written for a bundler that
 * resolves extensionless imports. A leaf module with no imports of its own can
 * be pulled in by an explicit path from the script and by the alias from the
 * app, so the default question set has one definition rather than two that
 * drift. Everything that needs Zod lives in `./submission.ts`.
 *
 * The values here mirror the database, and where they do the SQL is the source
 * of truth and this file is the copy: `20260821010000_rsvp_questions_and_answers.sql`
 * holds the enums, the shape map and the caps, and
 * `tests/unit/rsvp/schema-agreement.test.ts` reads that migration and fails if
 * the two ever disagree.
 *
 * The one idea worth understanding before reading on: **an answer is stored by
 * shape, not by question type.** Three columns exist on `rsvp_answers`, one per
 * shape, and a question type says which of them its answers use. That is what
 * makes a sixth question type an addition rather than a migration, and it is
 * why `RSVP_ANSWER_SHAPES` is a map rather than a switch buried in a writer.
 */

/** The five that ship. A sixth is an entry here, an enum value, and a reader. */
export const RSVP_QUESTION_TYPES = [
  'short_answer',
  'long_answer',
  'multiple_choice',
  'checkbox',
  'email',
] as const

export type RsvpQuestionType = (typeof RSVP_QUESTION_TYPES)[number]

/**
 * What an answer holds about a person, declared on the question and copied onto
 * every answer at answer time.
 *
 * The retention sweep reads this and never the prompt, which is what lets the
 * question set grow without growing an unswept corner of the database. Only
 * `none` survives redaction.
 */
export const RSVP_PII_CLASSES = ['none', 'identity', 'contact', 'sensitive'] as const

export type RsvpPiiClass = (typeof RSVP_PII_CLASSES)[number]

/** The three columns an answer can be stored in. */
export const RSVP_VALUE_SHAPES = ['text', 'choice', 'number'] as const

export type RsvpValueShape = (typeof RSVP_VALUE_SHAPES)[number]

/**
 * The map the whole design rests on, and the mirror of
 * `public.rsvp_answer_shape`. `number` has no shipped type pointing at it. That
 * is not an oversight: `scripts/prove-question-type-addition.mjs` adds a type
 * that uses it and shows that no table changed.
 */
export const RSVP_ANSWER_SHAPES: Readonly<Record<RsvpQuestionType, RsvpValueShape>> = {
  short_answer: 'text',
  long_answer: 'text',
  multiple_choice: 'choice',
  checkbox: 'choice',
  email: 'text',
}

/** How long an answer of each type may be. Mirrors nothing in the schema except the 2000 cap on value_text. */
export const RSVP_TEXT_LIMITS: Readonly<Record<RsvpQuestionType, number>> = {
  short_answer: 200,
  long_answer: 2000,
  multiple_choice: 0,
  checkbox: 0,
  email: 254,
}

/** Mirrors `rsvp_questions_before_write`: an event may ask at most this many live questions. */
export const RSVP_MAX_QUESTIONS = 12

/** Mirrors `rsvp_questions_prompt_length`. */
export const RSVP_MAX_PROMPT_LENGTH = 200

/** Mirrors `rsvps_party_size_range`. */
export const RSVP_MAX_PARTY_SIZE = 20

export type RsvpQuestionOption = {
  /** What an answer stores. Stable, so a label can be reworded. */
  readonly value: string
  readonly label: string
}

/** One live question on one event, as the guest page and the write path see it. */
export type RsvpQuestion = {
  readonly id: string
  readonly type: RsvpQuestionType
  readonly prompt: string
  readonly position: number
  readonly required: boolean
  /** Present for the choice shapes and null for everything else. */
  readonly options: readonly RsvpQuestionOption[] | null
  readonly piiClass: RsvpPiiClass
}

export function rsvpAnswerShape(type: RsvpQuestionType): RsvpValueShape {
  return RSVP_ANSWER_SHAPES[type]
}

export function isRsvpQuestionType(value: string): value is RsvpQuestionType {
  return (RSVP_QUESTION_TYPES as readonly string[]).includes(value)
}

export function isRsvpPiiClass(value: string): value is RsvpPiiClass {
  return (RSVP_PII_CLASSES as readonly string[]).includes(value)
}

/**
 * The name a question's control carries in the submitted form.
 *
 * Prefixed rather than bare, so a question id can never collide with
 * `attendance`, `party_size` or the honeypot, and so the write path can tell a
 * field it is meant to interpret from one it is meant to ignore. A submitted
 * field naming a question the event does not ask is rejected rather than
 * dropped: silently ignoring it is how a renamed field stops being collected
 * without anybody noticing.
 */
export const RSVP_QUESTION_FIELD_PREFIX = 'q:'

export function rsvpQuestionField(questionId: string): string {
  return `${RSVP_QUESTION_FIELD_PREFIX}${questionId}`
}

export function rsvpQuestionIdFromField(name: string): string | null {
  if (!name.startsWith(RSVP_QUESTION_FIELD_PREFIX)) return null
  const id = name.slice(RSVP_QUESTION_FIELD_PREFIX.length)
  return id === '' ? null : id
}

/** Envelope fields, which are never questions. */
export const RSVP_ATTENDANCE_FIELD = 'attendance'
export const RSVP_PARTY_SIZE_FIELD = 'party_size'

/**
 * The honeypot.
 *
 * Named after something a form filler would plausibly complete and a guest will
 * never see. It is the cheapest abuse control that costs a real guest nothing,
 * and unlike a captcha it asks nothing of somebody replying to a wedding
 * invitation on a phone on a train.
 */
export const RSVP_HONEYPOT_FIELD = 'website'

export const RSVP_ATTENDANCE_VALUES = ['attending', 'not_attending'] as const

export type RsvpAttendance = (typeof RSVP_ATTENDANCE_VALUES)[number]

/**
 * The question set every event starts with.
 *
 * Hardcoded, and that is the captain's own scope line: v1 has no custom RSVP
 * question builder, it has attending, guest count, dietary and message. Guest
 * count and attendance are not here because they are envelope columns on
 * `rsvps` rather than questions, so that the headcount query never depends on
 * which questions an event happens to ask.
 *
 * They are code rather than template content because the template format
 * carries design, and because a question carries a `piiClass` that decides what
 * the retention sweep erases. A stored document that could introduce a question
 * could introduce personal information nobody classified.
 *
 * The classes, and why each one:
 *
 *   name      identity   it is a person's name
 *   email     contact    it reaches them
 *   dietary   sensitive  "coeliac", "nut allergy" and "no pork" are health and,
 *                        read together, religious information
 *   message   identity   free text written by a named person, which in practice
 *                        contains names, plans and family news. Classing it
 *                        `none` to keep it past redaction would be the whole
 *                        control undone by one convenient decision.
 */
export type DefaultRsvpQuestion = {
  /** Stable key for the fixture and the seed script. Not stored. */
  readonly key: string
  readonly type: RsvpQuestionType
  readonly prompt: string
  readonly required: boolean
  readonly piiClass: RsvpPiiClass
  readonly options: readonly RsvpQuestionOption[] | null
}

export const DEFAULT_RSVP_QUESTIONS: readonly DefaultRsvpQuestion[] = [
  {
    key: 'name',
    type: 'short_answer',
    prompt: 'Your name',
    required: true,
    piiClass: 'identity',
    options: null,
  },
  {
    key: 'email',
    type: 'email',
    prompt: 'Email, so we can send you the details',
    required: false,
    piiClass: 'contact',
    options: null,
  },
  {
    key: 'dietary',
    type: 'long_answer',
    prompt: 'Anything we should know about food?',
    required: false,
    piiClass: 'sensitive',
    options: null,
  },
  {
    key: 'message',
    type: 'long_answer',
    prompt: 'A note for the hosts',
    required: false,
    piiClass: 'identity',
    options: null,
  },
]

/** The rows `DEFAULT_RSVP_QUESTIONS` becomes for one event, in order. */
export function defaultQuestionRows(eventId: string, ownerId: string) {
  return DEFAULT_RSVP_QUESTIONS.map((question, index) => ({
    owner_id: ownerId,
    event_id: eventId,
    type: question.type,
    prompt: question.prompt,
    position: index + 1,
    required: question.required,
    pii_class: question.piiClass,
    options: question.options,
  }))
}
