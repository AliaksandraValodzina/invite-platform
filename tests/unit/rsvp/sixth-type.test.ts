import { describe, expect, it } from 'vitest'

import type { RsvpQuestion } from '@/lib/rsvp/questions'
import {
  parseRsvpSubmission,
  READERS,
  type QuestionTypeReaders,
  type SubmittedField,
} from '@/lib/rsvp/submission'

/**
 * The app half of "a sixth question type is an addition".
 *
 * `scripts/prove-question-type-addition.mjs` does the database half: it adds a
 * type to a database that already holds answers and reads the catalogue to show
 * that no table and no row was rewritten. This is the other half of the same
 * sentence from the plan, "an enum value and a Zod branch", and it is written
 * the way `tests/unit/template/versioning.test.ts` is written: it builds a
 * genuinely sixth type on top of the readers that actually shipped and runs a
 * real submission through the same function the product runs.
 *
 * `rating` is chosen because it is the one shape no shipped type uses. If the
 * value columns were typed by question type rather than by shape, this test
 * could not be written without a migration, which is the whole point.
 */

const RATING: QuestionTypeReaders = {
  ...READERS,
  rating: {
    shape: 'number',
    read: (values) => {
      const raw = (values[0] ?? '').trim()
      if (raw === '') return { kind: 'blank' }
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
        return { kind: 'invalid', message: 'Please choose a number from one to five.' }
      }
      return { kind: 'answered', number: parsed }
    },
  },
}

/*
 * The cast is the honest expression of what is being tested. `RsvpQuestion` is
 * typed against the five types this deploy ships, and the scenario is a
 * database that carries six because somebody ran the migration. What has to
 * keep working is everything downstream of that, which is what runs below.
 */
const ratingQuestion = {
  id: 'q-rating',
  type: 'rating',
  prompt: 'How excited are you, one to five?',
  position: 2,
  required: false,
  options: null,
  piiClass: 'none',
} as unknown as RsvpQuestion

const QUESTIONS: readonly RsvpQuestion[] = [
  {
    id: 'q-name',
    type: 'short_answer',
    prompt: 'Your name',
    position: 1,
    required: true,
    options: null,
    piiClass: 'identity',
  },
  ratingQuestion,
]

function fields(entries: readonly (readonly [string, string])[]): SubmittedField[] {
  return entries.map(([name, value]) => ({ name, values: [value] }))
}

const SUBMITTED = [
  ['attendance', 'attending'],
  ['party_size', '1'],
  ['q:q-name', 'Priya Raman'],
  ['q:q-rating', '5'],
] as const

describe('adding a sixth question type', () => {
  it('costs one reader, and the reply stores in a column that was already there', () => {
    const outcome = parseRsvpSubmission(
      { fields: fields(SUBMITTED), questions: QUESTIONS, maxPartySize: 6 },
      RATING
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const rating = outcome.submission.answers.find((answer) => answer.questionId === 'q-rating')

    expect(rating).toMatchObject({
      questionPrompt: 'How excited are you, one to five?',
      valueNumber: 5,
      // The shape decides the column, so nothing spills into the two the five
      // shipped types use.
      valueText: null,
      valueChoice: null,
    })
  })

  it('validates through the new reader, so a sixth type is not a hole in the checks', () => {
    const outcome = parseRsvpSubmission(
      {
        fields: fields([...SUBMITTED.slice(0, 3), ['q:q-rating', '11']]),
        questions: QUESTIONS,
        maxPartySize: 6,
      },
      RATING
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-rating')
  })

  it('leaves the five shipped types exactly as they were', () => {
    const outcome = parseRsvpSubmission(
      { fields: fields(SUBMITTED), questions: QUESTIONS, maxPartySize: 6 },
      RATING
    )

    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    expect(
      outcome.submission.answers.find((answer) => answer.questionId === 'q-name')
    ).toMatchObject({ valueText: 'Priya Raman', questionType: 'short_answer' })
  })

  /**
   * The failure this design has to have, and the reason the readers map is a
   * parameter rather than a module constant a deploy can be wrong about: a
   * database that carries the sixth type against a deploy that does not.
   *
   * Silently skipping the question would store a reply that looks complete and
   * is missing an answer, and neither the guest nor the buyer would ever know.
   * So it refuses the whole reply and says which question, which is the outcome
   * a guest can act on.
   */
  it('refuses a reply rather than dropping an answer it cannot read', () => {
    const outcome = parseRsvpSubmission(
      { fields: fields(SUBMITTED), questions: QUESTIONS, maxPartySize: 6 },
      READERS
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toEqual(['q:q-rating'])
  })
})
