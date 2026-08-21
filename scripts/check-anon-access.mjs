#!/usr/bin/env node
//
// Proves that an anonymous client cannot reach the data, over HTTP, the way an
// attacker would.
//
// The pgTAP suite proves the database is configured correctly by switching role
// inside a transaction. This proves the product is, by going through PostgREST
// and the auth API with a real anon key. They are not the same claim: a stray
// grant, a policy written without a `to authenticated` clause, or a table
// exposed through a view would pass one and fail the other.
//
// It seeds through the service role first, so every "cannot read" assertion is
// made against a row that genuinely exists. Asserting that an empty database
// returns nothing proves nothing at all.
//
// Usage:
//   node scripts/check-anon-access.mjs
//
// Credentials come from the environment, or from `supabase status` when it is
// not set:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Against staging:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/check-anon-access.mjs
//
// Exit code 0 means every assertion held. Anything else means do not deploy.

import { execFileSync } from 'node:child_process'

const TABLES = [
  'accounts',
  'templates',
  'events',
  'event_content',
  'rsvps',
  'rsvp_questions',
  'rsvp_answers',
  'activation_codes',
  'uploads',
]

function resolveConfig() {
  let { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    let status
    try {
      status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
    } catch {
      throw new Error(
        'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, or run this with a local stack up (supabase start).'
      )
    }
    SUPABASE_URL ||= status.API_URL
    SUPABASE_ANON_KEY ||= status.ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Could not resolve Supabase URL and keys.')
  }
  return {
    url: SUPABASE_URL.replace(/\/$/, ''),
    anonKey: SUPABASE_ANON_KEY,
    serviceKey: SUPABASE_SERVICE_ROLE_KEY,
  }
}

const config = resolveConfig()

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

async function rest(path, { key, token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token || key}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not json, keep the text */
  }
  return { status: response.status, ok: response.ok, text, json }
}

async function auth(path, { key, method = 'POST', body, token } = {}) {
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not json */
  }
  if (!response.ok) {
    throw new Error(`auth ${path} failed with ${response.status}: ${text.slice(0, 400)}`)
  }
  return json
}

// A denial is any of: an HTTP error, or a success that returned no rows. The
// second case matters because RLS with no matching policy is not an error, it is
// an empty result, and "200 with []" is still a denial as long as the row is
// really there. seedExists guards against the empty-database false positive.
function denied(result) {
  if (!result.ok) return true
  if (Array.isArray(result.json)) return result.json.length === 0
  return false
}

function describe(result) {
  return `HTTP ${result.status} ${result.text.slice(0, 200)}`
}

const svc = { key: config.serviceKey }
const anon = { key: config.anonKey }

const stamp = Date.now().toString(36)
const created = {
  users: [],
  template: null,
  event: null,
  question: null,
  rsvp: null,
  upload: null,
}

async function seed() {
  const owner = await auth('admin/users', {
    key: config.serviceKey,
    body: {
      email: `owner-${stamp}@example.test`,
      password: `Owner-${stamp}-pw!`,
      email_confirm: true,
    },
  })
  created.users.push(owner.id)

  const stranger = await auth('admin/users', {
    key: config.serviceKey,
    body: {
      email: `stranger-${stamp}@example.test`,
      password: `Stranger-${stamp}-pw!`,
      email_confirm: true,
    },
  })
  created.users.push(stranger.id)

  const template = await rest('templates', {
    ...svc,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: owner.id,
      key: `probe-${stamp}`,
      name: 'Anon access probe',
      definition_version: 1,
      definition: { version: 1, blocks: [] },
      theme: { version: 1, tokens: {} },
    },
  })
  if (!template.ok) throw new Error(`seeding template failed: ${describe(template)}`)
  created.template = template.json[0]

  const event = await rest('events', {
    ...svc,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: owner.id,
      template_id: created.template.id,
      template_definition_version: 1,
      slug: `anon-probe-${stamp}`,
      title: 'Anon access probe',
      status: 'published',
      starts_at_local: '2027-03-14T15:00:00',
      time_zone: 'Australia/Melbourne',
      hosting_expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
    },
  })
  if (!event.ok) throw new Error(`seeding event failed: ${describe(event)}`)
  created.event = event.json[0]

  const question = await rest('rsvp_questions', {
    ...svc,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      type: 'long_answer',
      prompt: 'Anything we should know about food?',
      position: 1,
      required: true,
      pii_class: 'sensitive',
    },
  })
  if (!question.ok) throw new Error(`seeding question failed: ${describe(question)}`)
  created.question = question.json[0]

  // Through the same function the API route calls, so what this probes is the
  // path a reply actually takes rather than a hand written insert.
  const stored = await rest('rpc/submit_rsvp', {
    ...svc,
    method: 'POST',
    body: {
      p_slug: `anon-probe-${stamp}`,
      p_attendance: 'attending',
      p_party_size: 2,
      p_answers: [{ question_id: created.question.id, value_text: 'severe nut allergy' }],
    },
  })
  if (!stored.ok) throw new Error(`storing rsvp failed: ${describe(stored)}`)

  const rsvp = await rest(`rsvps?id=eq.${stored.json.rsvp_id}&select=*`, svc)
  if (!rsvp.ok) throw new Error(`reading back the rsvp failed: ${describe(rsvp)}`)
  created.rsvp = rsvp.json[0]

  // One uploaded asset, so the probes below are made against a row that really
  // exists rather than against an empty table.
  const upload = await rest('uploads', {
    ...svc,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      kind: 'image',
      bytes: 400000,
      content_type: 'image/jpeg',
      sha256: `\\x${'ab'.repeat(32)}`,
      original_key: 'abcdef012345abcdef012345-orig.jpg',
      variants: [
        {
          label: 'w960',
          key: 'abcdef012345abcdef012345-w960.webp',
          content_type: 'image/webp',
          bytes: 120000,
          width: 960,
          height: 640,
        },
      ],
      variant_bytes: 120000,
    },
  })
  if (!upload.ok) throw new Error(`seeding upload failed: ${describe(upload)}`)
  created.upload = upload.json[0]

  const strangerSession = await auth('token?grant_type=password', {
    key: config.anonKey,
    body: { email: `stranger-${stamp}@example.test`, password: `Stranger-${stamp}-pw!` },
  })

  const ownerSession = await auth('token?grant_type=password', {
    key: config.anonKey,
    body: { email: `owner-${stamp}@example.test`, password: `Owner-${stamp}-pw!` },
  })

  return {
    owner,
    stranger,
    strangerToken: strangerSession.access_token,
    ownerToken: ownerSession.access_token,
  }
}

async function cleanup() {
  if (created.event) await rest(`events?id=eq.${created.event.id}`, { ...svc, method: 'DELETE' })
  if (created.template)
    await rest(`templates?id=eq.${created.template.id}`, { ...svc, method: 'DELETE' })
  for (const id of created.users) {
    await fetch(`${config.url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
    })
  }
}

async function main() {
  console.log(`Checking anonymous access against ${config.url}\n`)

  const { owner, strangerToken, ownerToken } = await seed()

  // The rows really exist. Every denial below is therefore a denial and not an
  // empty database.
  console.log('The seeded data is real')
  const seedCheck = await rest(
    `rsvp_answers?select=value_text,pii_class&rsvp_id=eq.${created.rsvp.id}`,
    svc
  )
  check(
    'the service role can read the seeded reply, including its dietary note',
    seedCheck.ok && seedCheck.json?.[0]?.value_text === 'severe nut allergy',
    describe(seedCheck)
  )
  check(
    'and the answer carries the class the retention sweep reads, copied from the question',
    seedCheck.ok && seedCheck.json?.[0]?.pii_class === 'sensitive',
    describe(seedCheck)
  )
  const seedEvent = await rest(`events?select=slug&slug=eq.anon-probe-${stamp}`, svc)
  check(
    'the service role can read the seeded published event',
    seedEvent.ok && seedEvent.json?.length === 1,
    describe(seedEvent)
  )

  console.log('\nAn anonymous client can read nothing')
  for (const table of TABLES) {
    const result = await rest(`${table}?select=*`, anon)
    check(`anon cannot read ${table}`, denied(result), describe(result))
  }

  // Targeted reads, in case a policy is written per-row rather than per-table.
  const anonRsvp = await rest(`rsvps?select=*&id=eq.${created.rsvp.id}`, anon)
  check('anon cannot read the seeded RSVP by id', denied(anonRsvp), describe(anonRsvp))

  const anonEventBySlug = await rest(`events?select=*&slug=eq.anon-probe-${stamp}`, anon)
  check(
    'anon cannot read a published event by its public slug: that path is an API route with the service role',
    denied(anonEventBySlug),
    describe(anonEventBySlug)
  )

  const anonAnswers = await rest(`rsvp_answers?select=value_text,value_choice,pii_class`, anon)
  check(
    'anon cannot read guest names, emails or dietary notes',
    denied(anonAnswers),
    describe(anonAnswers)
  )

  const anonQuestions = await rest(`rsvp_questions?select=prompt`, anon)
  check(
    'anon cannot even read which questions an event asks',
    denied(anonQuestions),
    describe(anonQuestions)
  )

  console.log('\nAn anonymous client can write nothing')
  const anonInsertEvent = await rest('events', {
    ...anon,
    method: 'POST',
    body: {
      owner_id: owner.id,
      template_id: created.template.id,
      template_definition_version: 1,
      slug: `anon-written-${stamp}`,
      title: 'Written by anon',
      starts_at_local: '2027-03-14T15:00:00',
      time_zone: 'UTC',
      hosting_expires_at: new Date(Date.now() + 86400_000).toISOString(),
    },
  })
  check('anon cannot insert an event', !anonInsertEvent.ok, describe(anonInsertEvent))

  const anonInsertRsvp = await rest('rsvps', {
    ...anon,
    method: 'POST',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      attendance: 'attending',
      party_size: 1,
    },
  })
  check('anon cannot insert an RSVP directly', !anonInsertRsvp.ok, describe(anonInsertRsvp))

  const anonInsertAnswer = await rest('rsvp_answers', {
    ...anon,
    method: 'POST',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      rsvp_id: created.rsvp.id,
      question_id: created.question.id,
      question_prompt: 'Written by anon',
      question_type: 'short_answer',
      pii_class: 'none',
      value_text: 'Written by anon',
    },
  })
  check('anon cannot insert an answer directly', !anonInsertAnswer.ok, describe(anonInsertAnswer))

  const anonInsertUpload = await rest('uploads', {
    ...anon,
    method: 'POST',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      kind: 'image',
      bytes: 1000,
      content_type: 'image/jpeg',
      sha256: `\\x${'cd'.repeat(32)}`,
      original_key: 'ffffff000000ffffff000000-orig.jpg',
      variants: [
        {
          label: 'w960',
          key: 'ffffff000000ffffff000000-w960.webp',
          content_type: 'image/webp',
          bytes: 500,
          width: 960,
          height: 640,
        },
      ],
      variant_bytes: 500,
    },
  })
  check(
    'anon cannot put anything in the object store by writing a row that points at it',
    !anonInsertUpload.ok,
    describe(anonInsertUpload)
  )

  // The reply path itself. It runs as the service role from an API route, and a
  // guest reaching PostgREST with the publishable key must not be able to call
  // it: that would be an unrated, unvalidated write path with no honeypot.
  const anonSubmit = await rest('rpc/submit_rsvp', {
    ...anon,
    method: 'POST',
    body: {
      p_slug: `anon-probe-${stamp}`,
      p_attendance: 'attending',
      p_party_size: 1,
      p_answers: [],
    },
  })
  check('anon cannot call submit_rsvp', !anonSubmit.ok, describe(anonSubmit))

  const anonUpdateEvent = await rest(`events?id=eq.${created.event.id}`, {
    ...anon,
    method: 'PATCH',
    body: { title: 'Defaced' },
  })
  check('anon cannot update an event', !anonUpdateEvent.ok, describe(anonUpdateEvent))

  const anonDeleteRsvp = await rest(`rsvps?id=eq.${created.rsvp.id}`, { ...anon, method: 'DELETE' })
  check('anon cannot delete an RSVP', !anonDeleteRsvp.ok, describe(anonDeleteRsvp))

  const anonDisable = await rest('rpc/disable_upload', {
    ...anon,
    method: 'POST',
    body: { p_upload_id: created.upload.id, p_reason: 'written by anon' },
  })
  check('anon cannot take an asset down', !anonDisable.ok, describe(anonDisable))

  // The queue decides which bytes get removed. A stranger who could add to it
  // could aim a deletion; one who could drain it could learn every key.
  const anonQueue = await rest('rpc/queue_upload_object', {
    ...anon,
    method: 'POST',
    body: { p_key: 'abcdef012345abcdef012345-w960.webp' },
  })
  check('anon cannot queue an object for deletion', !anonQueue.ok, describe(anonQueue))

  const anonClaim = await rest('rpc/claim_upload_objects', {
    ...anon,
    method: 'POST',
    body: { p_limit: 10 },
  })
  check('anon cannot read the object deletion queue', !anonClaim.ok, describe(anonClaim))

  const anonRetention = await rest('rpc/run_retention_sweep', { ...anon, method: 'POST', body: {} })
  check('anon cannot call the retention sweep', !anonRetention.ok, describe(anonRetention))

  const anonErase = await rest('rpc/erase_rsvp', {
    ...anon,
    method: 'POST',
    body: { p_rsvp_id: created.rsvp.id },
  })
  check('anon cannot call erase_rsvp', !anonErase.ok, describe(anonErase))

  // Nothing above should have changed anything. Read it back rather than
  // assuming.
  const afterWrites = await rest(
    `rsvp_answers?select=value_text&rsvp_id=eq.${created.rsvp.id}`,
    svc
  )
  check(
    'the seeded reply still exists and is unchanged after every anonymous write attempt',
    afterWrites.ok &&
      afterWrites.json?.length === 1 &&
      afterWrites.json?.[0]?.value_text === 'severe nut allergy',
    describe(afterWrites)
  )

  console.log('\nA signed-in stranger can read nothing of someone else')
  for (const table of [
    'events',
    'rsvps',
    'rsvp_questions',
    'rsvp_answers',
    'templates',
    'event_content',
    'activation_codes',
    'uploads',
  ]) {
    const result = await rest(`${table}?select=*`, { key: config.anonKey, token: strangerToken })
    check(
      `a signed-in stranger sees no rows in ${table}`,
      result.ok && Array.isArray(result.json) && result.json.length === 0,
      describe(result)
    )
  }

  const strangerAccounts = await rest('accounts?select=owner_id', {
    key: config.anonKey,
    token: strangerToken,
  })
  check(
    'a signed-in stranger sees only their own account row',
    strangerAccounts.ok &&
      strangerAccounts.json?.length === 1 &&
      strangerAccounts.json[0].owner_id !== owner.id,
    describe(strangerAccounts)
  )

  const strangerSteal = await rest(`events?id=eq.${created.event.id}`, {
    key: config.anonKey,
    token: strangerToken,
    method: 'PATCH',
    body: { owner_id: created.users[1] },
  })
  const stolen = await rest(`events?select=owner_id&id=eq.${created.event.id}`, svc)
  check(
    'a signed-in stranger cannot take ownership of an event',
    stolen.ok && stolen.json?.[0]?.owner_id === owner.id,
    `patch: ${describe(strangerSteal)} / after: ${describe(stolen)}`
  )

  console.log('\nThe owner can do exactly what they should')
  const ownerReads = await rest(`rsvp_answers?select=question_prompt,value_text`, {
    key: config.anonKey,
    token: ownerToken,
  })
  check(
    'the owner reads what their own guests wrote',
    ownerReads.ok && ownerReads.json?.[0]?.value_text === 'severe nut allergy',
    describe(ownerReads)
  )

  const ownerInsertsRsvp = await rest('rsvps', {
    key: config.anonKey,
    token: ownerToken,
    method: 'POST',
    body: {
      owner_id: owner.id,
      event_id: created.event.id,
      attendance: 'attending',
      party_size: 1,
    },
  })
  check(
    'even the owner cannot insert an RSVP directly: that path is the service role',
    !ownerInsertsRsvp.ok,
    describe(ownerInsertsRsvp)
  )

  const ownerEditsAnswer = await rest(`rsvp_answers?rsvp_id=eq.${created.rsvp.id}`, {
    key: config.anonKey,
    token: ownerToken,
    method: 'PATCH',
    body: { value_text: 'Edited by the buyer' },
  })
  const answerAfter = await rest(
    `rsvp_answers?select=value_text&rsvp_id=eq.${created.rsvp.id}`,
    svc
  )
  check(
    'a buyer cannot edit what a guest wrote about their own allergies',
    answerAfter.ok && answerAfter.json?.[0]?.value_text === 'severe nut allergy',
    `patch: ${describe(ownerEditsAnswer)} / after: ${describe(answerAfter)}`
  )

  // Retire, never delete. The privilege is absent as well as the policy, so a
  // buyer tidying their form cannot take replies with it.
  const ownerDeletesQuestion = await rest(`rsvp_questions?id=eq.${created.question.id}`, {
    key: config.anonKey,
    token: ownerToken,
    method: 'DELETE',
  })
  const questionAfter = await rest(`rsvp_questions?select=id&id=eq.${created.question.id}`, svc)
  check(
    'a buyer cannot delete a question, only retire it, so the answers to it survive',
    !ownerDeletesQuestion.ok && questionAfter.ok && questionAfter.json?.length === 1,
    `delete: ${describe(ownerDeletesQuestion)} / after: ${describe(questionAfter)}`
  )

  const ownerEscalates = await rest(`accounts?owner_id=eq.${owner.id}`, {
    key: config.anonKey,
    token: ownerToken,
    method: 'PATCH',
    body: { role: 'admin' },
  })
  const roleAfter = await rest(`accounts?select=role&owner_id=eq.${owner.id}`, svc)
  check(
    'a user cannot promote their own account to admin',
    roleAfter.ok && roleAfter.json?.[0]?.role === 'buyer',
    `patch: ${describe(ownerEscalates)} / after: ${describe(roleAfter)}`
  )
}

try {
  await main()
} catch (error) {
  failures.push({ description: 'the check itself could not run', detail: error.message })
  console.error(`\nERROR ${error.message}`)
} finally {
  await cleanup().catch((error) => console.error(`cleanup failed: ${error.message}`))
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures)
    console.log(`  - ${failure.description}${failure.detail ? `: ${failure.detail}` : ''}`)
  process.exit(1)
}
console.log('Anonymous direct access is impossible, not merely unused.')
