#!/usr/bin/env node
//
// Proves that adding a sixth RSVP question type is an addition and not a
// migration, by doing it to a database that already holds real answers and then
// reading the catalogue to see what moved.
//
// The claim this exists to check is the load bearing one in stage 2: value
// columns on `rsvp_answers` are typed by SHAPE (text, choice, number) rather
// than by question type, so a new type that fits an existing shape costs an
// enum value and a branch. That claim is cheap to write in a comment and
// expensive to be wrong about, because the thing it promises not to happen is a
// data migration over a thousand events worth of other people's personal
// information.
//
// So this does not assert it. It performs it:
//
//   1. Seeds an event with one question of every shipped type and a guest reply
//      answering all of them.
//   2. Records what a rewrite would change: the relfilenode of both tables (a
//      table rewrite gives a table a new one), the full column list, the
//      constraint list, and the xmin of every existing answer row (a row
//      rewrite gives a row a new one).
//   3. Applies the whole of the candidate migration, which is two statements.
//   4. Reads all four back and fails if any of them moved.
//   5. Uses the new type: stores an answer in `value_number`, the column no
//      shipped type uses, and reads it back.
//
// Step 5 is the one that matters and steps 2 to 4 are its evidence. A migration
// that "worked" is a claim; an unchanged relfilenode next to a new question type
// answering into a column that was already there is the database confirming
// nothing was rewritten.
//
// Usage, with a local stack up (`supabase start`):
//
//   node scripts/prove-question-type-addition.mjs
//
// It refuses to run against anything but a local database. `alter type ... add
// value` cannot be rolled back, so this leaves the sixth type behind: that is
// harmless on a disposable stack and unacceptable on a real one. Run
// `supabase db reset` afterwards if you want a local database that matches the
// migrations exactly.
//
// Exit code 0 means the addition needed no table change, no row change, and no
// new column.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The candidate type. `rating` is deliberately the one shape no shipped type
// uses, because `value_number` sitting there unused is the part of the design
// that looks like dead weight until this runs.
const NEW_TYPE = 'rating'

// The entire migration. Two statements, and neither one names a table.
const CANDIDATE_MIGRATION = `
alter type public.rsvp_question_type add value if not exists '${NEW_TYPE}';

create or replace function public.rsvp_answer_shape(p_type public.rsvp_question_type)
returns public.rsvp_value_shape
language sql
immutable
set search_path = ''
as $fn$
  select (case p_type
    when 'short_answer' then 'text'
    when 'long_answer' then 'text'
    when 'email' then 'text'
    when 'multiple_choice' then 'choice'
    when 'checkbox' then 'choice'
    when '${NEW_TYPE}' then 'number'
  end)::public.rsvp_value_shape;
$fn$;
`

const SHIPPED_TYPES = ['short_answer', 'long_answer', 'multiple_choice', 'checkbox', 'email']

function resolveDbUrl() {
  let url = process.env.SUPABASE_DB_URL
  if (!url) {
    try {
      const status = JSON.parse(
        execFileSync('supabase', ['status', '-o', 'json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      )
      url = status.DB_URL
    } catch {
      throw new Error('Set SUPABASE_DB_URL, or run this with a local stack up (supabase start).')
    }
  }
  if (!url) throw new Error('Could not resolve the database URL.')

  const host = new URL(url).hostname
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(
      `This proof adds an enum value, which cannot be rolled back, so it refuses to run ` +
        `against anything but a local database. Got host "${host}".`
    )
  }
  return url
}

/**
 * Runs SQL and returns stdout.
 *
 * psql first, because it is on the PATH wherever the Supabase CLI is used and
 * on the CI runner. Falling back to the stack's own container means this needs
 * nothing installed that `supabase start` did not already need.
 */
function makeRunner(dbUrl) {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' })
    return (sql, args = []) =>
      execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
        input: sql,
        encoding: 'utf8',
      })
  } catch {
    const config = readFileSync(
      fileURLToPath(new URL('../supabase/config.toml', import.meta.url)),
      'utf8'
    )
    const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
    if (!projectId) throw new Error('No psql on PATH and no project_id in supabase/config.toml.')
    const container = `supabase_db_${projectId}`
    return (sql, args = []) =>
      execFileSync(
        'docker',
        [
          'exec',
          '-i',
          container,
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-q',
          ...args,
        ],
        { input: sql, encoding: 'utf8' }
      )
  }
}

const dbUrl = resolveDbUrl()
const run = makeRunner(dbUrl)

/** One value back, trimmed, with no headers or padding. */
function value(sql) {
  return run(sql, ['-t', '-A']).trim()
}

let passed = 0
const failures = []

function check(description, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${description}`)
  } else {
    failures.push({ description, detail })
    console.log(`  FAIL ${description}${detail ? `\n         ${detail}` : ''}`)
  }
}

const STAMP = Date.now().toString(36)
const OWNER_EMAIL = `question-type-proof-${STAMP}@example.test`

function seed() {
  const questionValues = SHIPPED_TYPES.map((type, index) => {
    const options =
      type === 'multiple_choice' || type === 'checkbox'
        ? `'[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]'::jsonb`
        : 'null'
    return `('${type}'::public.rsvp_question_type, 'Question ${index + 1}', ${index + 1}, ${options})`
  }).join(',\n      ')

  run(`
begin;

insert into auth.users (id, email)
values (gen_random_uuid(), '${OWNER_EMAIL}');

create temporary table proof_ids on commit drop as
select
  (select id from auth.users where email = '${OWNER_EMAIL}') as owner_id,
  gen_random_uuid() as template_id,
  gen_random_uuid() as event_id,
  gen_random_uuid() as rsvp_id;

insert into public.templates (id, owner_id, key, name, definition_version, definition, theme)
select template_id, owner_id, 'question-type-proof-${STAMP}', 'Question type proof', 1,
       '{"version": 1, "blocks": []}'::jsonb, '{"version": 1, "tokens": {}}'::jsonb
  from proof_ids;

insert into public.events (id, owner_id, template_id, template_definition_version, slug, title, status, starts_at_local, time_zone, hosting_expires_at, published_at)
select event_id, owner_id, template_id, 1, 'question-type-proof-${STAMP.slice(-6)}', 'Question type proof',
       'published', '2027-03-14 16:00', 'Australia/Sydney', now() + interval '365 days', now()
  from proof_ids;

insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class, options)
select p.owner_id, p.event_id, q.type, q.prompt, q.position, 'none'::public.rsvp_pii_class, q.options
  from proof_ids p
  cross join (values
      ${questionValues}
  ) as q(type, prompt, position, options);

insert into public.rsvps (id, owner_id, event_id, attendance, party_size)
select rsvp_id, owner_id, event_id, 'attending', 2 from proof_ids;

insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text, value_choice)
select p.owner_id, p.event_id, p.rsvp_id, q.id, q.prompt, q.type, q.pii_class,
       case when public.rsvp_answer_shape(q.type) = 'text' then 'an answer that already existed' end,
       case when public.rsvp_answer_shape(q.type) = 'choice' then array['a'] end
  from proof_ids p
  join public.rsvp_questions q on q.event_id = p.event_id;

commit;
`)
}

function cleanup() {
  try {
    run(`
delete from public.events e using auth.users u
 where e.owner_id = u.id and u.email = '${OWNER_EMAIL}';
delete from public.templates t using auth.users u
 where t.owner_id = u.id and u.email = '${OWNER_EMAIL}';
delete from auth.users where email = '${OWNER_EMAIL}';
`)
  } catch (error) {
    console.error(`cleanup failed: ${error.message}`)
  }
}

/** Everything a rewrite would move, in one string per table. */
function snapshot() {
  return {
    // A table rewrite gives the table a new relfilenode. This is the assertion
    // that a column type change, or an added stored column, cannot hide from.
    filenodes: value(`
      select string_agg(c.relname || '=' || c.relfilenode, ',' order by c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('rsvp_questions', 'rsvp_answers')
    `),
    columns: value(`
      select string_agg(
               c.table_name || '.' || c.column_name || ' ' || c.data_type ||
               coalesce(' ' || c.udt_name, '') || ' ' || c.is_nullable,
               ' | ' order by c.table_name, c.ordinal_position)
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name in ('rsvp_questions', 'rsvp_answers')
    `),
    constraints: value(`
      select string_agg(con.conname || '=' || pg_get_constraintdef(con.oid), ' | ' order by con.conname)
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('rsvp_questions', 'rsvp_answers')
    `),
    // A row rewrite gives the row a new xmin. Reading the values back would
    // catch an erasure; this also catches a rewrite that put the same values in
    // a new row version, which is what a data migration looks like.
    rows: value(`
      select string_agg(a.xmin::text || ':' || a.question_type::text || ':' ||
                        coalesce(a.value_text, '') || ':' ||
                        coalesce(array_to_string(a.value_choice, '+'), '') || ':' ||
                        coalesce(a.value_number::text, ''),
                        ' | ' order by a.question_type::text)
        from public.rsvp_answers a
        join auth.users u on u.id = a.owner_id
       where u.email = '${OWNER_EMAIL}'
    `),
  }
}

function main() {
  console.log(`Proving a sixth question type is an addition, against ${new URL(dbUrl).host}\n`)

  const shipped = value(
    `select string_agg(e.enumlabel, ',' order by e.enumsortorder)
       from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'rsvp_question_type'`
  )
  if (shipped.split(',').includes(NEW_TYPE)) {
    throw new Error(
      `This database already carries the "${NEW_TYPE}" type, so the proof would prove nothing. ` +
        'An enum value cannot be removed; run `supabase db reset` and try again.'
    )
  }
  check(
    `the five shipped question types are what this database has (${shipped})`,
    shipped === SHIPPED_TYPES.join(','),
    shipped
  )

  seed()

  const answered = value(
    `select count(*)::text from public.rsvp_answers a join auth.users u on u.id = a.owner_id
      where u.email = '${OWNER_EMAIL}'`
  )
  check(
    'the database holds a real reply answering every shipped question type before anything changes',
    answered === String(SHIPPED_TYPES.length),
    `${answered} answers`
  )

  const before = snapshot()

  console.log('\nApplying the whole of the candidate migration:')
  console.log(
    CANDIDATE_MIGRATION.trim()
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
  )
  run(CANDIDATE_MIGRATION)

  const after = snapshot()

  console.log('\nWhat the migration changed')
  check(
    'no table was rewritten: rsvp_questions and rsvp_answers still have the relfilenode they had',
    before.filenodes === after.filenodes && before.filenodes !== '',
    `before ${before.filenodes} / after ${after.filenodes}`
  )
  check(
    'no column was added, dropped or retyped on either table',
    before.columns === after.columns && before.columns !== '',
    diff(before.columns, after.columns)
  )
  check(
    'no constraint changed',
    before.constraints === after.constraints && before.constraints !== '',
    diff(before.constraints, after.constraints)
  )
  check(
    'not one existing answer row was rewritten: same values, same row version',
    before.rows === after.rows && before.rows !== '',
    diff(before.rows, after.rows)
  )

  console.log('\nAnd the new type works')
  check(
    `${NEW_TYPE} answers are stored as a number, in the column that was already there`,
    value(`select public.rsvp_answer_shape('${NEW_TYPE}')::text`) === 'number',
    'the shape function did not pick up the new branch'
  )

  run(`
insert into public.rsvp_questions (owner_id, event_id, type, prompt, position, pii_class)
select e.owner_id, e.id, '${NEW_TYPE}', 'How excited are you, one to five?', 99, 'none'
  from public.events e join auth.users u on u.id = e.owner_id
 where u.email = '${OWNER_EMAIL}';

insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_number)
select r.owner_id, r.event_id, r.id, q.id, q.prompt, q.type, q.pii_class, 5
  from public.rsvps r
  join auth.users u on u.id = r.owner_id
  join public.rsvp_questions q on q.event_id = r.event_id and q.type = '${NEW_TYPE}'
 where u.email = '${OWNER_EMAIL}';
`)

  const stored = value(`
    select a.value_number::text from public.rsvp_answers a
    join auth.users u on u.id = a.owner_id
   where u.email = '${OWNER_EMAIL}' and a.question_type = '${NEW_TYPE}'
  `)
  check(
    'a guest answered a question of the new type and it read back',
    stored === '5',
    `value_number came back as "${stored}"`
  )

  // The guard has to keep working for the new type too, or "typed by shape" is
  // a convention rather than a rule.
  let refused = false
  try {
    run(`
insert into public.rsvp_answers (owner_id, event_id, rsvp_id, question_id, question_prompt, question_type, pii_class, value_text)
select r.owner_id, r.event_id, r.id, q.id, q.prompt, q.type, q.pii_class, 'five'
  from public.rsvps r
  join auth.users u on u.id = r.owner_id
  join public.rsvp_questions q on q.event_id = r.event_id and q.type = '${NEW_TYPE}'
 where u.email = '${OWNER_EMAIL}';
`)
  } catch {
    refused = true
  }
  check(
    'and storing that answer in the wrong column is still refused, so the shape rule covers the new type without being told about it',
    refused,
    'the wrong column was accepted'
  )

  const answersAfter = value(`
    select count(*)::text from public.rsvp_answers a join auth.users u on u.id = a.owner_id
     where u.email = '${OWNER_EMAIL}'
  `)
  check(
    'the answers that existed before the migration are all still there',
    answersAfter === String(SHIPPED_TYPES.length + 1),
    `${answersAfter} answers, expected ${SHIPPED_TYPES.length + 1}`
  )
}

function diff(before, after) {
  if (before === after) return ''
  return `before:\n         ${before}\n       after:\n         ${after}`
}

try {
  main()
} catch (error) {
  failures.push({ description: 'the proof itself could not run', detail: error.message })
  console.error(`\nERROR ${error.message}`)
} finally {
  cleanup()
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) {
    console.log(`  - ${failure.description}${failure.detail ? `: ${failure.detail}` : ''}`)
  }
  process.exit(1)
}
console.log(
  `A sixth question type cost one enum value and one function branch. No table was rewritten and no row moved.\n` +
    `This database now carries "${NEW_TYPE}", which cannot be removed. Run \`supabase db reset\` for a database that matches the migrations.`
)
