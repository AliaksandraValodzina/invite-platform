#!/usr/bin/env node
/**
 * Creates a real event, so a page can be opened without a dashboard.
 *
 * AGENTS.md says schema is never edited in a dashboard. The same argument
 * applies to the rows the product is demonstrated with: a row clicked into
 * existence is a row nobody can reproduce, and "it works on the staging
 * project" is not a claim anyone can check. This script is the reproducible
 * version, and the Playwright suite seeds through it rather than through a
 * second copy of the same inserts.
 *
 * It writes through PostgREST with the service role and through the auth admin
 * API, which is how the product itself reaches the database. It deliberately
 * imports nothing from `src/`: Node runs a `.ts` file directly by stripping the
 * types, and the app's modules are written for a bundler that resolves
 * extensionless imports, so importing them here would need a build step to run
 * one script.
 *
 * Usage, with a local stack up (`supabase start`):
 *
 *   node scripts/seed-event.ts --title "Emma & Jake" --starts 2027-03-14T16:00:00 \
 *     --tz Australia/Sydney --theme deckle-and-deboss --state live
 *
 * Credentials come from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or from
 * `supabase status` when those are absent. Nothing here has a hosted default.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The four states `public.event_state_at` can return, expressed as the row that
 * produces each one. Nothing is stored to say which state an event is in, so a
 * fixture for one is a pair of timestamps either side of now.
 */
export type SeedState = 'unpublished' | 'live' | 'grace' | 'expired'

const DAY_MS = 86_400_000

type Timings = {
  readonly status: 'draft' | 'published'
  readonly hostingExpiresAt: number
  readonly graceEndsAt: number
}

/**
 * `expired` sits a couple of days past grace rather than a year past it, so the
 * fixture cannot be swept away by the retention job while a test is reading it.
 * Tier 1 redaction lands 30 days after grace ends.
 */
function timingsFor(state: SeedState, now: number): Timings {
  switch (state) {
    case 'unpublished':
      return {
        status: 'draft',
        hostingExpiresAt: now + 365 * DAY_MS,
        graceEndsAt: now + 395 * DAY_MS,
      }
    case 'live':
      return {
        status: 'published',
        hostingExpiresAt: now + 365 * DAY_MS,
        graceEndsAt: now + 395 * DAY_MS,
      }
    case 'grace':
      return { status: 'published', hostingExpiresAt: now - DAY_MS, graceEndsAt: now + 29 * DAY_MS }
    case 'expired':
      return {
        status: 'published',
        hostingExpiresAt: now - 32 * DAY_MS,
        graceEndsAt: now - 2 * DAY_MS,
      }
  }
}

export type SeedConfig = {
  readonly url: string
  readonly serviceKey: string
}

export function resolveSeedConfig(
  source: Record<string, string | undefined> = process.env
): SeedConfig {
  let url = source.SUPABASE_URL
  let serviceKey = source.SUPABASE_SERVICE_ROLE_KEY

  if (url === undefined || serviceKey === undefined) {
    let status: Record<string, string>
    try {
      status = JSON.parse(
        execFileSync('supabase', ['status', '-o', 'json'], {
          encoding: 'utf8',
          // stderr is discarded: `supabase status` narrates which services are
          // stopped, and that narration is not this script's output.
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      ) as Record<string, string>
    } catch {
      throw new Error(
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run this with a local stack up (supabase start).'
      )
    }
    url ??= status.API_URL
    serviceKey ??= status.SERVICE_ROLE_KEY
  }

  if (url === undefined || serviceKey === undefined) {
    throw new Error('Could not resolve the Supabase URL and service role key.')
  }

  return { url: url.replace(/\/$/, ''), serviceKey }
}

type Json = Record<string, unknown> | unknown[]

async function call(
  config: SeedConfig,
  path: string,
  init: { method?: string; body?: Json; prefer?: string } = {}
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: 'application/json',
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.prefer !== undefined) headers.Prefer = init.prefer

  const response = await fetch(`${config.url}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 400)}`
    )
  }

  return text === '' ? null : (JSON.parse(text) as unknown)
}

function firstRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'object') {
    throw new Error(`expected a row back, got ${JSON.stringify(value).slice(0, 200)}`)
  }
  return value[0] as Record<string, unknown>
}

/**
 * The owner is reused across seeds rather than created per event.
 *
 * Every table is scoped by `owner_id` from the first migration, so seeding
 * needs a real `auth.users` row. Creating one per event would spend the auth
 * API's rate limit on fixtures and fill the accounts table with users nobody
 * can log in as.
 */
export async function ensureOwner(config: SeedConfig, email: string): Promise<string> {
  const created = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, email_confirm: true }),
  })

  if (created.ok) {
    const user = (await created.json()) as { id: string }
    return user.id
  }

  const listed = (await call(config, `/auth/v1/admin/users?per_page=200`)) as {
    users?: { id: string; email: string }[]
  }
  const existing = listed.users?.find((user) => user.email === email)
  if (existing === undefined) {
    throw new Error(`could not create or find the seed owner ${email}: ${await created.text()}`)
  }
  return existing.id
}

function repoFile(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url))
}

export function readJsonFile(relative: string): unknown {
  return JSON.parse(readFileSync(repoFile(relative), 'utf8')) as unknown
}

export type SeedEventInput = {
  readonly title: string
  readonly startsAtLocal: string
  readonly timeZone: string
  readonly state: SeedState
  /** File name under templates/themes, without the extension. */
  readonly themeKey: string
  readonly endsAtLocal?: string | undefined
  /** Left out means the database mints one from the title. */
  readonly slug?: string | undefined
  /** Defaults to the committed classic-invitation definition. */
  readonly definition?: unknown
  /** Buyer overrides, keyed by block id. Defaults to none. */
  readonly content?: unknown
  readonly ownerEmail?: string | undefined
  /** Distinguishes template rows when several are seeded for one owner. */
  readonly templateKey?: string | undefined
  /**
   * Whether the content revision is the published one. Defaults to true.
   *
   * False produces a real and reachable hazard rather than a test contrivance:
   * an event whose status says published with nothing marked published to
   * serve. The guest page answers that with a designed notice, because falling
   * back to the template defaults would show real guests the placeholder names
   * the template ships with.
   */
  readonly publishContent?: boolean | undefined
}

export type SeededEvent = {
  readonly slug: string
  readonly eventId: string
  readonly templateId: string
  readonly ownerId: string
  readonly state: SeedState
}

export const DEFAULT_OWNER_EMAIL = 'seed-owner@example.test'

export async function seedEvent(
  input: SeedEventInput,
  config: SeedConfig = resolveSeedConfig()
): Promise<SeededEvent> {
  const ownerId = await ensureOwner(config, input.ownerEmail ?? DEFAULT_OWNER_EMAIL)

  const definition =
    input.definition ?? readJsonFile('templates/definitions/classic-invitation.json')
  const theme = readJsonFile(`templates/themes/${input.themeKey}.json`)
  const definitionVersion = (definition as { version: number }).version

  const templateKey = input.templateKey ?? `seed-${input.themeKey}`
  const template = firstRow(
    await call(config, '/rest/v1/templates?on_conflict=owner_id,key', {
      method: 'POST',
      prefer: 'return=representation,resolution=merge-duplicates',
      body: {
        owner_id: ownerId,
        key: templateKey,
        name: `Seed template (${input.themeKey})`,
        status: 'published',
        definition_version: definitionVersion,
        definition,
        theme,
      },
    })
  )
  const templateId = template.id as string

  const slug =
    input.slug ??
    ((await call(config, '/rest/v1/rpc/mint_event_slug', {
      method: 'POST',
      body: { p_title: input.title },
    })) as string)

  const timings = timingsFor(input.state, Date.now())

  const event = firstRow(
    await call(config, '/rest/v1/events', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        owner_id: ownerId,
        template_id: templateId,
        template_definition_version: definitionVersion,
        slug,
        title: input.title,
        status: timings.status,
        starts_at_local: input.startsAtLocal,
        ends_at_local: input.endsAtLocal ?? null,
        time_zone: input.timeZone,
        hosting_expires_at: new Date(timings.hostingExpiresAt).toISOString(),
        grace_ends_at: new Date(timings.graceEndsAt).toISOString(),
      },
    })
  )
  const eventId = event.id as string

  const content = input.content ?? { version: 1, blocks: {} }
  await call(config, '/rest/v1/event_content', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      owner_id: ownerId,
      event_id: eventId,
      revision: 1,
      is_published: input.publishContent ?? true,
      content_version: (content as { version: number }).version,
      content,
      theme: { version: 1, tokens: {} },
    },
  })

  return { slug, eventId, templateId, ownerId, state: input.state }
}

// CLI ------------------------------------------------------------------------

const STATES: readonly SeedState[] = ['unpublished', 'live', 'grace', 'expired']

function isSeedState(value: string): value is SeedState {
  return (STATES as readonly string[]).includes(value)
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`${token} needs a value`)
    }
    parsed[token.slice(2)] = next
    index += 1
  }
  return parsed
}

const USAGE = `Usage:
  node scripts/seed-event.ts --title "Emma & Jake" --starts 2027-03-14T16:00:00 \\
    [--tz Australia/Sydney] [--theme deckle-and-deboss] [--state live] \\
    [--ends 2027-03-14T23:30:00] [--slug emma-and-jake-7fq2] [--owner you@example.test] \\
    [--publish-content false]

  --state is one of ${STATES.join(', ')}. It decides the hosting and grace
  timestamps, because no column stores which state an event is in.`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const title = args.title
  const startsAtLocal = args.starts
  if (title === undefined || startsAtLocal === undefined) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const state = args.state ?? 'live'
  if (!isSeedState(state)) {
    console.error(`--state must be one of ${STATES.join(', ')}, got "${state}"`)
    process.exitCode = 1
    return
  }

  const seeded = await seedEvent({
    title,
    startsAtLocal,
    timeZone: args.tz ?? 'Australia/Sydney',
    themeKey: args.theme ?? 'deckle-and-deboss',
    state,
    endsAtLocal: args.ends,
    slug: args.slug,
    ownerEmail: args.owner,
    publishContent: args['publish-content'] !== 'false',
  })

  console.log(JSON.stringify(seeded, null, 2))
  console.log(`\nOpen /e/${seeded.slug}`)
}

// Only when run directly, so the Playwright suite can import seedEvent.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
