import 'server-only'

import { cookies } from 'next/headers'
import { z } from 'zod'

import { readAuthConfig } from '@/lib/auth/config'
import { ACCESS_COOKIE, isExpired, tokenExpiry, tokenSubject } from '@/lib/auth/session'
import {
  isRsvpPiiClass,
  isRsvpQuestionType,
  type RsvpPiiClass,
  type RsvpQuestionType,
} from '@/lib/rsvp/questions'

/**
 * What a signed-in buyer can read, read AS that buyer.
 *
 * This is the one path in the app that does not use the service role, and the
 * difference is the point. A guest page has no user, so it goes through an API
 * route with the service role and every check is code we wrote. A dashboard has
 * a user, so it sends their own token and the check is row level security in
 * the database: `owner_id = (select auth.uid())`, on every table, forced.
 *
 * That means a bug in this file cannot show one buyer another buyer's replies.
 * It can only show a buyer nothing. `scripts/check-anon-access.mjs` already
 * drives that boundary from the outside, and `supabase/tests/07_rsvp_answers.test.sql`
 * asserts it in the database. Using the service role here and filtering by
 * owner in a query would move that guarantee into a `where` clause somebody can
 * forget.
 *
 * Nothing here is cached, at any layer. See `DASHBOARD_CACHE_CONTROL`.
 */

export type BuyerSession = {
  readonly accessToken: string
  readonly userId: string
}

/**
 * The signed-in buyer, or null. Reads the cookie `src/proxy.ts` keeps fresh.
 *
 * An expired token counts as null even though the proxy should have replaced it
 * already. The two failures are not the same size: a null sends somebody to the
 * sign-in page, and a stale token sends a request the database refuses, which
 * arrives on screen as "your invitations could not be loaded" and reads like the
 * replies are gone.
 */
export async function currentBuyer(): Promise<BuyerSession | null> {
  const jar = await cookies()
  const accessToken = jar.get(ACCESS_COOKIE)?.value
  if (accessToken === undefined || accessToken === '') return null

  const expiry = tokenExpiry(accessToken)
  if (expiry === null || isExpired(expiry)) return null

  const userId = tokenSubject(accessToken)
  if (userId === null) return null

  return { accessToken, userId }
}

export type BuyerResponse = {
  readonly ok: boolean
  readonly status: number
  readonly json: unknown
  /** First 400 characters of the body, so a database refusal can be quoted. */
  readonly detail: string
  /**
   * Rows matching the filter, when `Prefer: count=exact` was asked for.
   *
   * Read off `Content-Range` rather than counted from the body, because the
   * body is capped: `max_rows` in supabase/config.toml is 1000, so an event
   * with more replies than that would be reported as having exactly 1000. The
   * count the load bearing warning shows a buyer has to be the real one.
   */
  readonly count: number | null
}

/**
 * One PostgREST GET as the buyer.
 *
 * The anon key goes in `apikey` and the buyer's token in `Authorization`, which
 * is what tells PostgREST to run the request as `authenticated` with that
 * user's claims. Sending the anon key in both places would run it as `anon`,
 * which every table denies, and the symptom would be an empty dashboard rather
 * than an error.
 */
export async function buyerGet(session: BuyerSession, path: string): Promise<BuyerResponse> {
  return buyerRequest(session, 'GET', path)
}

/**
 * One PostgREST request as the buyer, in any verb.
 *
 * Writes go through here rather than through the service role, and that is the
 * same decision the reads above make, for a stronger reason. A buyer editing
 * their own invitation is exactly the case where "which event is this" must not
 * be a `where` clause in application code: `owner_id = (select auth.uid())` on
 * `event_content`, `events` and `rsvp_questions` is the check, it is forced, and
 * a bug in this file can therefore write nothing rather than write into somebody
 * else's wedding.
 *
 * `detail` comes back on a failure because the database is where the real
 * refusal is written. A trigger saying "an event may ask at most 12 live RSVP
 * questions" is a sentence a buyer can act on, and swallowing it in favour of
 * "that could not be saved" would be throwing away the only useful part of the
 * answer.
 */
export async function buyerRequest(
  session: BuyerSession,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { readonly body?: unknown; readonly prefer?: string } = {}
): Promise<BuyerResponse> {
  const config = readAuthConfig()

  const headers: Record<string, string> = {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/json',
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.prefer !== undefined) headers.Prefer = options.prefer

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
  })

  const text = await response.text()
  let json: unknown = null
  try {
    json = text === '' ? null : JSON.parse(text)
  } catch {
    /* not JSON */
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    detail: text.slice(0, 400),
    count: readCount(response.headers.get('content-range')),
  }
}

/** `0-24/1200` or `*\/0`. Null when the header is absent or says `*`. */
function readCount(header: string | null): number | null {
  if (header === null) return null
  const total = header.split('/')[1]
  if (total === undefined || total === '*') return null
  const parsed = Number(total)
  return Number.isInteger(parsed) ? parsed : null
}

// The buyer's events ---------------------------------------------------------

const eventRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  starts_at_local: z.string(),
  time_zone: z.string(),
  hosting_expires_at: z.string(),
  grace_ends_at: z.string(),
  serving_state: z.enum(['unpublished', 'live', 'grace', 'expired']),
  rsvps: z.array(z.object({ attendance: z.string(), party_size: z.number() })),
})

export type BuyerEvent = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly startsAtLocal: string
  readonly timeZone: string
  readonly state: 'unpublished' | 'live' | 'grace' | 'expired'
  readonly replies: number
  /** Heads promised, which is what a caterer asks for. Declines bring zero. */
  readonly attending: number
}

export async function loadBuyerEvents(session: BuyerSession): Promise<BuyerEvent[] | null> {
  const response = await buyerGet(
    session,
    'events?' +
      new URLSearchParams({
        select: [
          'id',
          'slug',
          'title',
          'status',
          'starts_at_local',
          'time_zone',
          'hosting_expires_at',
          'grace_ends_at',
          'serving_state',
          'rsvps(attendance,party_size)',
        ].join(','),
        order: 'starts_at_utc.desc',
      }).toString()
  )

  if (!response.ok || !Array.isArray(response.json)) return null

  const events: BuyerEvent[] = []
  for (const row of response.json) {
    const parsed = eventRowSchema.safeParse(row)
    if (!parsed.success) continue

    events.push({
      id: parsed.data.id,
      slug: parsed.data.slug,
      title: parsed.data.title,
      startsAtLocal: parsed.data.starts_at_local,
      timeZone: parsed.data.time_zone,
      state: parsed.data.serving_state,
      replies: parsed.data.rsvps.length,
      attending: parsed.data.rsvps.reduce((total, rsvp) => total + rsvp.party_size, 0),
    })
  }

  return events
}

// One event's replies --------------------------------------------------------

const questionSchema = z.object({
  id: z.string(),
  type: z.string(),
  prompt: z.string(),
  position: z.number(),
  pii_class: z.string(),
  retired_at: z.string().nullable(),
})

const answerSchema = z.object({
  question_id: z.string(),
  question_prompt: z.string(),
  question_type: z.string(),
  pii_class: z.string(),
  value_text: z.string().nullable(),
  value_choice: z.array(z.string()).nullable(),
  value_number: z.number().nullable(),
  pii_redacted_at: z.string().nullable(),
})

const replyRowSchema = z.object({
  id: z.string(),
  attendance: z.string(),
  party_size: z.number(),
  created_at: z.string(),
  pii_redacted_at: z.string().nullable(),
  rsvp_answers: z.array(answerSchema),
})

export type ReplyAnswer = {
  readonly questionId: string
  readonly prompt: string
  readonly type: RsvpQuestionType | string
  readonly piiClass: RsvpPiiClass | string
  /** Already rendered for reading. Null means the answer was erased. */
  readonly value: string | null
  readonly redacted: boolean
}

export type Reply = {
  readonly id: string
  readonly attendance: 'attending' | 'not_attending' | string
  readonly partySize: number
  readonly createdAt: string
  readonly redacted: boolean
  readonly answers: readonly ReplyAnswer[]
}

export type ReplyColumn = {
  readonly questionId: string
  readonly prompt: string
  readonly piiClass: RsvpPiiClass | string
  readonly retired: boolean
}

export type EventReplies = {
  readonly event: { readonly id: string; readonly slug: string; readonly title: string }
  /**
   * The columns of the table, live questions first and retired ones after.
   *
   * Retired questions are listed, and that is deliberate: a buyer who removed a
   * question yesterday still has answers to it from last month, and a table
   * that quietly dropped the column would look like the answers were gone.
   */
  readonly columns: readonly ReplyColumn[]
  readonly replies: readonly Reply[]
}

const eventHeaderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  rsvp_questions: z.array(questionSchema),
})

export async function loadEventReplies(
  session: BuyerSession,
  eventId: string
): Promise<EventReplies | null> {
  const header = await buyerGet(
    session,
    'events?' +
      new URLSearchParams({
        id: `eq.${eventId}`,
        select: 'id,slug,title,rsvp_questions(id,type,prompt,position,pii_class,retired_at)',
        'rsvp_questions.order': 'position.asc',
        limit: '1',
      }).toString()
  )

  if (!header.ok || !Array.isArray(header.json) || header.json.length === 0) return null

  const parsedHeader = eventHeaderSchema.safeParse(header.json[0])
  if (!parsedHeader.success) return null

  const replies = await buyerGet(
    session,
    'rsvps?' +
      new URLSearchParams({
        event_id: `eq.${eventId}`,
        select: [
          'id',
          'attendance',
          'party_size',
          'created_at',
          'pii_redacted_at',
          'rsvp_answers(question_id,question_prompt,question_type,pii_class,value_text,value_choice,value_number,pii_redacted_at)',
        ].join(','),
        order: 'created_at.desc',
      }).toString()
  )

  if (!replies.ok || !Array.isArray(replies.json)) return null

  const columns = new Map<string, ReplyColumn>()
  for (const question of parsedHeader.data.rsvp_questions) {
    columns.set(question.id, {
      questionId: question.id,
      prompt: question.prompt,
      piiClass: question.pii_class,
      retired: question.retired_at !== null,
    })
  }

  const rows: Reply[] = []
  for (const row of replies.json) {
    const parsed = replyRowSchema.safeParse(row)
    if (!parsed.success) continue

    const answers = parsed.data.rsvp_answers.map((answer) => {
      /*
       * An answer to a question that has since been deleted outright cannot
       * happen, because the foreign key restricts it. An answer to a question
       * this buyer can no longer see can: it is the prompt on the answer that
       * makes the reply readable either way, which is what the snapshot is for.
       */
      if (!columns.has(answer.question_id)) {
        columns.set(answer.question_id, {
          questionId: answer.question_id,
          prompt: answer.question_prompt,
          piiClass: answer.pii_class,
          retired: true,
        })
      }

      return {
        questionId: answer.question_id,
        prompt: answer.question_prompt,
        type: isRsvpQuestionType(answer.question_type)
          ? answer.question_type
          : answer.question_type,
        piiClass: isRsvpPiiClass(answer.pii_class) ? answer.pii_class : answer.pii_class,
        value: readValue(answer),
        redacted: answer.pii_redacted_at !== null && answer.pii_class !== 'none',
      }
    })

    rows.push({
      id: parsed.data.id,
      attendance: parsed.data.attendance,
      partySize: parsed.data.party_size,
      createdAt: parsed.data.created_at,
      redacted: parsed.data.pii_redacted_at !== null,
      answers,
    })
  }

  return {
    event: {
      id: parsedHeader.data.id,
      slug: parsedHeader.data.slug,
      title: parsedHeader.data.title,
    },
    columns: [...columns.values()],
    replies: rows,
  }
}

/**
 * One answer as a line of text.
 *
 * The shape decides how, which is the same rule the write path follows: the
 * column that holds a value is chosen by shape, so reading it back is chosen by
 * shape too. An answer with nothing in any column has been erased by the
 * retention sweep, and null is what says so.
 */
function readValue(answer: z.infer<typeof answerSchema>): string | null {
  if (answer.value_text !== null) return answer.value_text
  if (answer.value_choice !== null) return answer.value_choice.join(', ')
  if (answer.value_number !== null) return String(answer.value_number)
  return null
}
