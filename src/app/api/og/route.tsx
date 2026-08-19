import { ImageResponse } from 'next/og'

import { readSiteConfig } from '@/lib/env'
import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  ogCardFooter,
  parseOgCardParams,
  planOgCard,
  renderOgCard,
} from '@/lib/og'
import { ogThemeTokens } from '@/lib/og/themes'

/**
 * The share card, rendered to PNG.
 *
 * PHASE 0.7 SEAM. The card's fields arrive as query parameters because there is
 * no event read path yet: phases 0.4 to 0.6 are not on main, so there is no row
 * to look a slug up in. When that lands, this handler resolves the slug through
 * the service role instead and passes the same fields to the same `planOgCard`.
 * Nothing about the layout, the tokens or the tests changes when it does.
 *
 * Two consequences of that seam, stated plainly rather than left to be found:
 *
 *   - Until the lookup exists, anyone can ask this route for a card carrying
 *     their own text. The parameters are length capped and the response is
 *     marked noindex, but the real fix is the lookup, not a tighter cap.
 *   - The response is immutably cacheable because every input is in the URL. A
 *     buyer editing their title produces a different URL, so there is no stale
 *     card to invalidate.
 */

export const runtime = 'nodejs'

const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform'

export function GET(request: Request): Response {
  const parsed = parseOgCardParams(new URL(request.url).searchParams)

  if (!parsed.ok) {
    return Response.json(
      { error: 'invalid card parameters', issues: parsed.issues },
      { status: 400 }
    )
  }

  const { params } = parsed
  const { siteUrl } = readSiteConfig()

  let plan
  try {
    plan = planOgCard(
      {
        title: params.title,
        startsAtLocal: params.startsAt,
        kicker: params.kicker,
        venue: params.venue,
        footer: ogCardFooter(siteUrl, params.slug),
      },
      ogThemeTokens(params.theme)
    )
  } catch (error) {
    // The only thing that reaches here is a timestamp that matched the shape but
    // is not a real date, such as 2027-13-40T16:00:00.
    return Response.json(
      { error: 'invalid card parameters', issues: [{ path: 'startsAt', message: message(error) }] },
      { status: 400 }
    )
  }

  return new ImageResponse(renderOgCard(plan), {
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    headers: {
      'Cache-Control': IMMUTABLE,
      // The card is an asset of a page, not a page. Indexing it puts a
      // buyer's names into search results on their own.
      'X-Robots-Tag': 'noindex',
    },
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'could not be read as a local timestamp'
}
