import 'server-only'

import { z } from 'zod'

import { eventCacheTag, GUEST_PAGE_REVALIDATE_SECONDS } from '@/lib/serving/cache'
import type { StoredEventDocuments } from '@/lib/template'

import { serviceGet } from './service'

/**
 * The guest read path: one slug in, one renderable event out, or a designed
 * state.
 *
 * Nothing here throws. A guest arriving from a group chat gets a page or a
 * designed notice, never a stack trace, so every failure comes back as an
 * outcome the route can render. That is the same rule `src/lib/template/resolve.ts`
 * follows, and for the same reason.
 *
 * One request, not two. `serving_state` is a computed column added by
 * `20260820010000_event_serving_state.sql`, which calls `public.event_state_at`,
 * so the state and the row are read at one clock and cached with one lifetime.
 * Asking for the state separately would give the page two caches with two
 * expiries and let a page outlive the state it was rendered from.
 *
 * `events.template_definition_version` is deliberately not read. The column
 * pins the definition version an event was activated against, but `templates`
 * holds one definition and no history, so there is nothing to select by yet.
 * The format's migration ladder is what keeps an older stored document
 * renderable in the meantime (docs/template-format.md). Honouring the pin needs
 * template definition history, which is not this stage.
 */

export const SERVING_STATES = ['unpublished', 'live', 'grace', 'expired'] as const

export type ServingState = (typeof SERVING_STATES)[number]

/** Matches `events_slug_format` in 20260819010400_events.sql. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isPossibleSlug(value: string): boolean {
  return value.length >= 3 && value.length <= 64 && SLUG_PATTERN.test(value)
}

/** The event fields a page renders, named the way the app names things. */
export type GuestEvent = {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly startsAtLocal: string
  readonly endsAtLocal: string | null
  readonly timeZone: string
}

export type GuestPageOutcome =
  /** No row, or a slug that could not be one. Renders the designed 404. */
  | { readonly kind: 'not-found' }
  /**
   * The row exists and cannot be served as a page: the database was
   * unreachable, or a published event has no published content revision. Both
   * are our fault rather than the guest's, and both render a designed notice.
   */
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'found'
      readonly event: GuestEvent
      readonly state: ServingState
      readonly documents: StoredEventDocuments
      /** Published revision number, which the share card uses as a cache key. */
      readonly revision: number
    }

/**
 * The row shape PostgREST returns. The four document columns stay `unknown`:
 * validating them is the template pipeline's job, and it is the only thing that
 * knows how to migrate an older one.
 */
const rowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  starts_at_local: z.string(),
  ends_at_local: z.string().nullable(),
  time_zone: z.string(),
  serving_state: z.enum(SERVING_STATES),
  templates: z.object({ definition: z.unknown(), theme: z.unknown() }).nullable(),
  event_content: z.array(
    z.object({ revision: z.number(), content: z.unknown(), theme: z.unknown() })
  ),
})

const SELECT = [
  'id',
  'slug',
  'title',
  'starts_at_local',
  'ends_at_local',
  'time_zone',
  'serving_state',
  'templates(definition,theme)',
  'event_content(revision,content,theme)',
].join(',')

export function guestPageQuery(slug: string): string {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: SELECT,
    // Filtering the embedded resource, not the top level one: an event with no
    // published revision must still come back, so that "published but nothing
    // to serve" is a designed notice rather than a 404 a buyer cannot explain.
    'event_content.is_published': 'is.true',
    limit: '1',
  })
  return `events?${params.toString()}`
}

export async function loadGuestPage(slug: string): Promise<GuestPageOutcome> {
  if (!isPossibleSlug(slug)) return { kind: 'not-found' }

  let response
  try {
    response = await serviceGet(guestPageQuery(slug), {
      revalidate: GUEST_PAGE_REVALIDATE_SECONDS,
      tags: [eventCacheTag(slug)],
    })
  } catch (error) {
    return { kind: 'unavailable', reason: describe(error) }
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `the database answered ${response.status}` }
  }

  if (!Array.isArray(response.json) || response.json.length === 0) {
    return { kind: 'not-found' }
  }

  const parsed = rowSchema.safeParse(response.json[0])
  if (!parsed.success) {
    return {
      kind: 'unavailable',
      reason: `the event row was not the shape this deploy expects: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    }
  }

  const row = parsed.data

  if (row.templates === null) {
    return { kind: 'unavailable', reason: 'the event names a template that could not be read' }
  }

  const event: GuestEvent = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAtLocal: row.starts_at_local,
    endsAtLocal: row.ends_at_local,
    timeZone: row.time_zone,
  }

  const published = row.event_content[0]

  // An unpublished or expired event serves a notice and none of its content, so
  // a missing revision is not a problem for those two. For a page that is meant
  // to be on screen it is: the buyer's words are the page, and the template
  // defaults are somebody else's placeholder names.
  if (published === undefined) {
    if (row.serving_state === 'live' || row.serving_state === 'grace') {
      return {
        kind: 'unavailable',
        reason: 'the event is published but has no published content revision',
      }
    }

    return {
      kind: 'found',
      event,
      state: row.serving_state,
      revision: 0,
      documents: {
        definition: row.templates.definition,
        theme: row.templates.theme,
        content: null,
        themeOverride: null,
      },
    }
  }

  return {
    kind: 'found',
    event,
    state: row.serving_state,
    revision: published.revision,
    documents: {
      definition: row.templates.definition,
      theme: row.templates.theme,
      content: published.content,
      themeOverride: published.theme,
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'the database could not be reached'
}
