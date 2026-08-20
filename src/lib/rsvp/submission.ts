/**
 * Reading a submitted reply, and the seam that makes a sixth question type an
 * addition on this side of the wire too.
 *
 * `20260821010000_rsvp_questions_and_answers.sql` proves that a new type costs
 * an enum value and a function branch in the database. The report's other half
 * of that sentence is "and a Zod branch", which is this file: `READERS` is a
 * map from question type to the one function that turns what a browser sent
 * into the value column its shape names.
 *
 * `parseRsvpSubmission` takes that map as an argument rather than reaching for
 * the module level one. That is not a convenience either: it is what lets
 * `tests/unit/rsvp/sixth-type.test.ts` build a genuinely sixth type, with a
 * shape no shipped type uses, and run a real submission through the same code
 * the product runs. It is the same trick `createTemplateDefinitionSchema` uses
 * to let a test build a real next version of the template format.
 *
 * Nothing here touches the database and nothing here throws. A guest gets an
 * accepted reply or a list of field-scoped messages, so the form can say which
 * answer was the problem instead of "that did not send".
 */

import { z } from 'zod'

import {
  RSVP_ATTENDANCE_FIELD,
  RSVP_ATTENDANCE_VALUES,
  RSVP_HONEYPOT_FIELD,
  RSVP_MAX_PARTY_SIZE,
  RSVP_PARTY_SIZE_FIELD,
  RSVP_TEXT_LIMITS,
  rsvpQuestionField,
  rsvpQuestionIdFromField,
  type RsvpAttendance,
  type RsvpPiiClass,
  type RsvpQuestion,
  type RsvpQuestionType,
  type RsvpValueShape,
} from './questions'

/** What one control sent. `values` is plural because a checkbox sends many. */
export type SubmittedField = {
  readonly name: string
  readonly values: readonly string[]
}

/** One answer, ready to become a row. The snapshot columns are already filled. */
export type PreparedAnswer = {
  readonly questionId: string
  readonly questionPrompt: string
  readonly questionType: RsvpQuestionType
  readonly piiClass: RsvpPiiClass
  readonly valueText: string | null
  readonly valueChoice: readonly string[] | null
  readonly valueNumber: number | null
}

export type PreparedSubmission = {
  readonly attendance: RsvpAttendance
  readonly partySize: number
  readonly answers: readonly PreparedAnswer[]
}

export type SubmissionIssue = {
  /** The form field the message belongs to, so the form can put it next to the control. */
  readonly field: string
  readonly message: string
}

export type SubmissionOutcome =
  | { readonly ok: true; readonly submission: PreparedSubmission }
  /**
   * The honeypot was filled. There is nothing to store and nothing went wrong,
   * so this is neither a success nor a failure: the caller answers the way it
   * answers a real reply and writes nothing. Telling a form filler which of its
   * fields gave it away is free tuning.
   */
  | { readonly ok: true; readonly submission: null; readonly honeypot: true }
  | { readonly ok: false; readonly issues: readonly SubmissionIssue[] }

/** What a reader can decide about one control's values. */
export type ReadOutcome =
  | { readonly kind: 'answered'; readonly text: string }
  | { readonly kind: 'answered'; readonly choice: readonly string[] }
  | { readonly kind: 'answered'; readonly number: number }
  /** The guest left it alone. An optional question stores no row at all. */
  | { readonly kind: 'blank' }
  | { readonly kind: 'invalid'; readonly message: string }

export type QuestionTypeReader = {
  readonly shape: RsvpValueShape
  readonly read: (values: readonly string[], question: RsvpQuestion) => ReadOutcome
}

export type QuestionTypeReaders = Readonly<Record<string, QuestionTypeReader>>

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

function readText(type: RsvpQuestionType) {
  const limit = RSVP_TEXT_LIMITS[type]
  return (values: readonly string[]): ReadOutcome => {
    const raw = (values[0] ?? '').trim()
    if (raw === '') return { kind: 'blank' }
    if (raw.length > limit) {
      return { kind: 'invalid', message: `Please keep this under ${limit} characters.` }
    }
    return { kind: 'answered', text: raw }
  }
}

function optionValues(question: RsvpQuestion): Set<string> {
  return new Set((question.options ?? []).map((option) => option.value))
}

/**
 * The five that ship.
 *
 * `email` normalises to lower case before it is stored, because
 * `rsvps_guest_email_normalised` used to and because two spellings of one
 * address is two guests as far as any later deduplication is concerned. The
 * choice readers refuse a value that is not on the question's own list, which
 * matters more than it looks: the option list is the only thing standing
 * between a select element in a browser somebody controls and an arbitrary
 * string in the buyer's export.
 */
export const READERS: QuestionTypeReaders = {
  short_answer: { shape: 'text', read: readText('short_answer') },
  long_answer: { shape: 'text', read: readText('long_answer') },
  email: {
    shape: 'text',
    read: (values) => {
      const raw = (values[0] ?? '').trim()
      if (raw === '') return { kind: 'blank' }
      const parsed = emailSchema.safeParse(raw)
      if (!parsed.success) {
        return { kind: 'invalid', message: 'That does not look like an email address.' }
      }
      if (parsed.data.length > RSVP_TEXT_LIMITS.email) {
        return { kind: 'invalid', message: 'That email address is too long.' }
      }
      return { kind: 'answered', text: parsed.data }
    },
  },
  multiple_choice: {
    shape: 'choice',
    read: (values, question) => {
      const chosen = values.filter((value) => value !== '')
      if (chosen.length === 0) return { kind: 'blank' }
      if (chosen.length > 1) return { kind: 'invalid', message: 'Please choose one.' }
      const allowed = optionValues(question)
      const only = chosen[0] as string
      if (!allowed.has(only)) {
        return { kind: 'invalid', message: 'Please choose one of the options.' }
      }
      return { kind: 'answered', choice: [only] }
    },
  },
  checkbox: {
    shape: 'choice',
    read: (values, question) => {
      const allowed = optionValues(question)
      const chosen = values.filter((value) => value !== '')
      if (chosen.some((value) => !allowed.has(value))) {
        return { kind: 'invalid', message: 'Please choose from the options.' }
      }
      if (new Set(chosen).size !== chosen.length) {
        return { kind: 'invalid', message: 'Please choose each option at most once.' }
      }
      /*
       * Ticking nothing is an answer, not an absence. Unlike a text box, a set
       * of checkboxes sends nothing at all when a guest read it and ticked
       * none, so the empty array is the only reading that records "none of
       * these" rather than losing it.
       *
       * Which is why `required` on a checkbox has to mean "tick at least one".
       * Left as it is for every other type, a required checkbox would be
       * satisfied by a guest who never looked at it.
       */
      if (chosen.length === 0 && question.required) return { kind: 'blank' }
      return { kind: 'answered', choice: chosen }
    },
  },
}

const attendanceSchema = z.enum(RSVP_ATTENDANCE_VALUES)

const partySizeSchema = z.coerce.number().int().min(1).max(RSVP_MAX_PARTY_SIZE)

export type ParseInput = {
  readonly fields: readonly SubmittedField[]
  /** The event's live questions, as the guest page rendered them. */
  readonly questions: readonly RsvpQuestion[]
  /** Ceiling the form offered, from the rsvp-form block config. */
  readonly maxPartySize: number
}

export function parseRsvpSubmission(
  input: ParseInput,
  readers: QuestionTypeReaders = READERS
): SubmissionOutcome {
  const submitted = new Map<string, readonly string[]>()
  for (const field of input.fields) {
    const existing = submitted.get(field.name) ?? []
    submitted.set(field.name, [...existing, ...field.values])
  }

  if ((submitted.get(RSVP_HONEYPOT_FIELD) ?? []).some((value) => value.trim() !== '')) {
    return { ok: true, submission: null, honeypot: true }
  }

  const issues: SubmissionIssue[] = []

  const attendance = attendanceSchema.safeParse(submitted.get(RSVP_ATTENDANCE_FIELD)?.[0])
  if (!attendance.success) {
    issues.push({ field: RSVP_ATTENDANCE_FIELD, message: 'Please say whether you can make it.' })
  }

  /*
   * A decline brings nobody. `rsvps_declines_bring_nobody` says so, so a form
   * that sent a party size with a decline would be rejected by the database
   * after the guest pressed the button. Deciding it here means the guest never
   * meets that.
   */
  let partySize = 0
  if (attendance.success && attendance.data === 'attending') {
    const ceiling = Math.min(Math.max(input.maxPartySize, 1), RSVP_MAX_PARTY_SIZE)
    const raw = submitted.get(RSVP_PARTY_SIZE_FIELD)?.[0]
    const parsed = partySizeSchema.safeParse(raw === undefined || raw === '' ? '1' : raw)
    if (!parsed.success || parsed.data > ceiling) {
      issues.push({
        field: RSVP_PARTY_SIZE_FIELD,
        message: `Please choose a number between 1 and ${ceiling}.`,
      })
    } else {
      partySize = parsed.data
    }
  }

  const byId = new Map(input.questions.map((question) => [question.id, question]))

  // A field naming a question this event does not ask is a rejection, not a
  // shrug. Dropping it silently is how a form and its questions drift apart
  // without anybody hearing about it.
  for (const name of submitted.keys()) {
    const questionId = rsvpQuestionIdFromField(name)
    if (questionId !== null && !byId.has(questionId)) {
      issues.push({ field: name, message: 'This invitation is not asking that any more.' })
    }
  }

  const answers: PreparedAnswer[] = []

  for (const question of input.questions) {
    const field = rsvpQuestionField(question.id)
    const reader = readers[question.type]

    if (reader === undefined) {
      /*
       * A question type the database knows and this deploy does not. It is a
       * refusal rather than a skipped question, because storing a reply that
       * silently omits one of its answers is worse than not storing it: the
       * buyer would read a reply that looks complete.
       */
      issues.push({
        field,
        message: 'This question cannot be answered right now. Please tell whoever invited you.',
      })
      continue
    }

    const outcome = reader.read(submitted.get(field) ?? [], question)

    if (outcome.kind === 'invalid') {
      issues.push({ field, message: outcome.message })
      continue
    }

    if (outcome.kind === 'blank') {
      if (question.required) {
        issues.push({ field, message: 'Please answer this one.' })
      }
      continue
    }

    answers.push({
      questionId: question.id,
      // The snapshot. Taken here, from the question as it is right now, so that
      // rewording it tomorrow does not change what this guest was asked.
      questionPrompt: question.prompt,
      questionType: question.type,
      piiClass: question.piiClass,
      valueText: 'text' in outcome ? outcome.text : null,
      valueChoice: 'choice' in outcome ? outcome.choice : null,
      valueNumber: 'number' in outcome ? outcome.number : null,
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    submission: {
      attendance: attendance.success ? attendance.data : 'attending',
      partySize,
      answers,
    },
  }
}

/** Pulls the fields out of a FormData, keeping repeats, which checkboxes need. */
export function fieldsFromFormData(formData: FormData): SubmittedField[] {
  const fields: SubmittedField[] = []
  for (const [name, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    fields.push({ name, values: [value] })
  }
  return fields
}
