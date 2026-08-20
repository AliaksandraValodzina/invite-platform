import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  RSVP_ANSWER_SHAPES,
  RSVP_MAX_PARTY_SIZE,
  RSVP_MAX_PROMPT_LENGTH,
  RSVP_MAX_QUESTIONS,
  RSVP_PII_CLASSES,
  RSVP_QUESTION_TYPES,
  RSVP_VALUE_SHAPES,
} from '@/lib/rsvp/questions'

/**
 * The database is the source of truth for the question model, and
 * `src/lib/rsvp/questions.ts` is a copy of it. Two copies of anything drift,
 * and the drift here would be silent in the worst way: a type the app offers
 * that the database will not accept is a reply a guest loses at the last step,
 * and a shape the app writes into the wrong column is an answer stored where
 * nothing reads it.
 *
 * So this reads the migration and fails when they disagree, in the same spirit
 * as `tests/unit/serving/page-revalidate.test.ts`, which holds a literal in a
 * route file to the constant it is supposed to equal.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/20260821010000_rsvp_questions_and_answers.sql',
      import.meta.url
    )
  ),
  'utf8'
)

/** The values of `create type public.<name> as enum (...)`, in order. */
function enumValues(name: string): string[] {
  const match = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`, 'i').exec(
    migration
  )
  if (match === null) throw new Error(`the migration does not create public.${name}`)
  return [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((value) => value[1] as string)
}

describe('the question model in TypeScript and in the database', () => {
  it('ships the same five question types, in the same order', () => {
    expect(enumValues('rsvp_question_type')).toEqual([...RSVP_QUESTION_TYPES])
  })

  it('ships the same four PII classes, which is what the retention sweep selects on', () => {
    expect(enumValues('rsvp_pii_class')).toEqual([...RSVP_PII_CLASSES])
  })

  it('ships the same three value shapes', () => {
    expect(enumValues('rsvp_value_shape')).toEqual([...RSVP_VALUE_SHAPES])
  })

  it('maps every question type to the same column the database maps it to', () => {
    // The body of public.rsvp_answer_shape, read as the pairs it is made of.
    const body =
      /create or replace function public\.rsvp_answer_shape[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
        migration
      )
    expect(body).not.toBeNull()

    const pairs = [...(body?.[1] ?? '').matchAll(/when '([a-z_]+)' then '([a-z]+)'/g)]
    const fromSql = Object.fromEntries(pairs.map((pair) => [pair[1], pair[2]]))

    expect(fromSql).toEqual(RSVP_ANSWER_SHAPES)
  })

  it('caps live questions per event at the same number the trigger does', () => {
    expect(migration).toContain(`v_count >= ${RSVP_MAX_QUESTIONS}`)
  })

  it('caps a prompt at the same length the constraint does', () => {
    expect(migration).toContain(`char_length(prompt) between 1 and ${RSVP_MAX_PROMPT_LENGTH}`)
  })

  it('caps a party size at the same number the rsvps constraint does', () => {
    const rsvps = readFileSync(
      fileURLToPath(
        new URL('../../../supabase/migrations/20260819010600_rsvps.sql', import.meta.url)
      ),
      'utf8'
    )
    expect(rsvps).toContain(`party_size between 0 and ${RSVP_MAX_PARTY_SIZE}`)
  })
})
