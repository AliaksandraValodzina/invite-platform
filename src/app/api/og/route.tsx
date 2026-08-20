import { ImageResponse } from 'next/og'

import { readSiteConfig } from '@/lib/env'
import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  ogCardFields,
  ogCardFooter,
  parseOgCardParams,
  planOgCard,
  renderOgCard,
} from '@/lib/og'
import { GUEST_PAGE_CACHE_CONTROL } from '@/lib/serving/cache'
import { loadGuestPage } from '@/lib/supabase/events'
import { resolveEventPage } from '@/lib/template'

/**
 * The share card, rendered to PNG.
 *
 * It takes a slug and reads everything else from the event row. That closes the
 * hole the Phase 0.7 seam left open and named: while the fields arrived as query
 * parameters, anyone could ask this origin for a card carrying their own text,
 * in our type, under our domain. A length cap was never the fix, the lookup was.
 *
 * The card itself did not move. `planOgCard` and `renderOgCard` get the same
 * shaped input they always did; what changed is where it comes from, and that
 * the tokens are now the event's own resolved theme rather than one of two
 * placeholder palettes.
 *
 * Only `live` and `grace` draw a card. An unpublished event has nothing to
 * share yet, and an expired one serves a page with no content on it, so putting
 * a couple's names into a chat preview for either would say something the page
 * itself refuses to say.
 *
 * Cache lifetime follows the URL. With `v`, the URL names one rendering of one
 * event and can never mean anything else, so it is immutable. Without it, the
 * URL means "whatever this event's card says now", and gets the same short
 * lifetime as the page.
 */

export const runtime = 'nodejs'

const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform'

function problem(status: number, error: string, issues: { path: string; message: string }[] = []) {
  return Response.json({ error, issues }, { status, headers: { 'X-Robots-Tag': 'noindex' } })
}

export async function GET(request: Request): Promise<Response> {
  const parsed = parseOgCardParams(new URL(request.url).searchParams)

  if (!parsed.ok) {
    return problem(400, 'invalid card parameters', [...parsed.issues])
  }

  const { params } = parsed
  const outcome = await loadGuestPage(params.slug)

  if (outcome.kind === 'not-found') {
    return problem(404, 'no published event at that slug')
  }

  if (outcome.kind === 'unavailable') {
    return problem(503, 'the event could not be read')
  }

  if (outcome.state !== 'live' && outcome.state !== 'grace') {
    return problem(404, 'that event is not being served')
  }

  const page = resolveEventPage(outcome.documents)
  if (!page.ok) {
    return problem(503, 'the event could not be resolved')
  }

  const { siteUrl } = readSiteConfig()
  const fields = ogCardFields(outcome.event, page.page.blocks)

  let plan
  try {
    plan = planOgCard(
      {
        title: fields.title,
        startsAtLocal: fields.startsAt,
        kicker: fields.kicker,
        venue: fields.venue,
        footer: ogCardFooter(siteUrl, outcome.event.slug),
      },
      page.page.tokens
    )
  } catch {
    // A stored timestamp that matched the column type but is not a real local
    // date, such as one written by something that is not us.
    return problem(503, 'the event could not be drawn')
  }

  return new ImageResponse(renderOgCard(plan), {
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    headers: {
      'Cache-Control': params.v === undefined ? GUEST_PAGE_CACHE_CONTROL : IMMUTABLE,
      // The card is an asset of a page, not a page. Indexing it puts a
      // buyer's names into search results on their own.
      'X-Robots-Tag': 'noindex',
    },
  })
}
