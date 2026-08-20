import { describe, expect, it } from 'vitest'

import type { RsvpQuestion } from '@/lib/rsvp/questions'
import { parseRsvpSubmission, type SubmittedField } from '@/lib/rsvp/submission'

/**
 * Reading a submitted reply.
 *
 * The assertions read the values that come out, not whether parsing "worked".
 * A parser that accepted everything and stored nothing would pass a test that
 * only checked `ok`, and the buyer would find that out by opening a dashboard
 * full of empty replies.
 */

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
  {
    id: 'q-email',
    type: 'email',
    prompt: 'Email',
    position: 2,
    required: false,
    options: null,
    piiClass: 'contact',
  },
  {
    id: 'q-dietary',
    type: 'long_answer',
    prompt: 'Anything we should know about food?',
    position: 3,
    required: false,
    options: null,
    piiClass: 'sensitive',
  },
  {
    id: 'q-course',
    type: 'multiple_choice',
    prompt: 'Which will you have?',
    position: 4,
    required: false,
    options: [
      { value: 'fish', label: 'Fish' },
      { value: 'beef', label: 'Beef' },
    ],
    piiClass: 'none',
  },
  {
    id: 'q-events',
    type: 'checkbox',
    prompt: 'Which events will you be at?',
    position: 5,
    required: false,
    options: [
      { value: 'ceremony', label: 'Ceremony' },
      { value: 'dinner', label: 'Dinner' },
    ],
    piiClass: 'none',
  },
]

function fields(entries: readonly (readonly [string, string])[]): SubmittedField[] {
  return entries.map(([name, value]) => ({ name, values: [value] }))
}

function parse(entries: readonly (readonly [string, string])[]) {
  return parseRsvpSubmission({ fields: fields(entries), questions: QUESTIONS, maxPartySize: 6 })
}

const COMPLETE = [
  ['attendance', 'attending'],
  ['party_size', '2'],
  ['q:q-name', 'Priya Raman'],
  ['q:q-email', 'Priya@Example.Test'],
  ['q:q-dietary', 'coeliac'],
  ['q:q-course', 'fish'],
  ['q:q-events', 'ceremony'],
  ['q:q-events', 'dinner'],
] as const

describe('reading a reply', () => {
  it('stores each answer in the column its question type names', () => {
    const outcome = parse(COMPLETE)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const byId = new Map(outcome.submission.answers.map((answer) => [answer.questionId, answer]))

    expect(byId.get('q-name')).toMatchObject({
      valueText: 'Priya Raman',
      valueChoice: null,
      valueNumber: null,
    })
    expect(byId.get('q-course')).toMatchObject({
      valueText: null,
      valueChoice: ['fish'],
      valueNumber: null,
    })
    expect(byId.get('q-events')?.valueChoice).toEqual(['ceremony', 'dinner'])
  })

  it('snapshots the prompt, the type and the PII class onto every answer', () => {
    const outcome = parse(COMPLETE)
    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const dietary = outcome.submission.answers.find((answer) => answer.questionId === 'q-dietary')

    expect(dietary).toMatchObject({
      questionPrompt: 'Anything we should know about food?',
      questionType: 'long_answer',
      // The column the retention sweep reads. If this ever came out as `none`,
      // an allergy note would survive redaction.
      piiClass: 'sensitive',
    })
  })

  it('normalises an email to lower case, so two spellings are not two guests', () => {
    const outcome = parse(COMPLETE)
    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const email = outcome.submission.answers.find((answer) => answer.questionId === 'q-email')
    expect(email?.valueText).toBe('priya@example.test')
  })

  it('stores no row for a text question left blank, so absence means unanswered', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['q:q-email', '   '],
      ['q:q-dietary', ''],
    ])

    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const answered = outcome.submission.answers.map((answer) => answer.questionId)
    expect(answered).not.toContain('q-email')
    expect(answered).not.toContain('q-dietary')
  })

  /**
   * A set of checkboxes with nothing ticked sends nothing at all, so "the guest
   * read it and chose none of these" and "the guest never saw it" look
   * identical on the wire. Storing the empty array is what keeps the first one,
   * which is the one a caterer counting head counts cares about.
   */
  it('stores an empty array for an optional checkbox nobody ticked, because that is an answer', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
    ])

    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    const events = outcome.submission.answers.find((answer) => answer.questionId === 'q-events')
    expect(events?.valueChoice).toEqual([])
  })

  it('makes a decline bring nobody, whatever the form sent', () => {
    const outcome = parse([
      ['attendance', 'not_attending'],
      ['party_size', '4'],
      ['q:q-name', 'Jo Fitzgerald'],
    ])

    if (!outcome.ok || outcome.submission === null) throw new Error('expected a submission')

    expect(outcome.submission.attendance).toBe('not_attending')
    expect(outcome.submission.partySize).toBe(0)
  })
})

describe('refusing a reply', () => {
  /**
   * Required has to mean something different for a checkbox, because a guest
   * who never looked at one sends exactly what a guest who ticked none sends.
   * Read the same way as every other type, a required checkbox would be
   * satisfied by nobody answering it.
   */
  it('treats a required checkbox as "tick at least one"', () => {
    const required = QUESTIONS.map((question) =>
      question.id === 'q-events' ? { ...question, required: true } : question
    )

    const outcome = parseRsvpSubmission({
      fields: fields([
        ['attendance', 'attending'],
        ['party_size', '1'],
        ['q:q-name', 'Priya Raman'],
      ]),
      questions: required,
      maxPartySize: 6,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-events')
  })

  it('names the required question that was left blank, not the form as a whole', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', ''],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    expect(outcome.issues).toEqual([{ field: 'q:q-name', message: expect.any(String) }])
  })

  it('refuses an attendance that was never chosen', () => {
    const outcome = parse([['q:q-name', 'Priya Raman']])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('attendance')
  })

  it('refuses a party size above the ceiling the buyer set', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '9'],
      ['q:q-name', 'Priya Raman'],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('party_size')
  })

  it('refuses a choice that is not on the question own list', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['q:q-course', 'lobster'],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-course')
  })

  it('refuses more than one answer to a one-of question', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['q:q-course', 'fish'],
      ['q:q-course', 'beef'],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-course')
  })

  it('refuses something that is not an email address', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['q:q-email', 'not an address'],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-email')
  })

  it('refuses an answer to a question this event does not ask, rather than dropping it', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['q:q-someone-elses', 'smuggled'],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-someone-elses')
  })

  it('refuses an answer longer than the type allows', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'a'.repeat(201)],
    ])

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.issues.map((issue) => issue.field)).toContain('q:q-name')
  })
})

describe('the honeypot', () => {
  /**
   * The one place this code says "ok" without storing anything, and it is
   * deliberate. A form filler that is told which field gave it away has been
   * handed the fix. A guest can never fill this field, because it is hidden
   * from a screen and from a screen reader.
   */
  it('accepts the request and prepares nothing to store', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Definitely A Person'],
      ['website', 'http://example.test'],
    ])

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.submission).toBeNull()
  })

  it('is not tripped by an empty value, which is what every real reply sends', () => {
    const outcome = parse([
      ['attendance', 'attending'],
      ['party_size', '1'],
      ['q:q-name', 'Priya Raman'],
      ['website', ''],
    ])

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.submission).not.toBeNull()
  })
})
