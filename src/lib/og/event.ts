/**
 * The card's fields, taken off a resolved event page rather than off a URL.
 *
 * Until this existed, `/api/og` read its text from query parameters, and
 * `src/app/api/og/route.tsx` said what that cost: anyone could ask the route for
 * a card carrying their own words, under our domain, in our type. The fix named
 * there was the lookup rather than a tighter cap, and this is the half of the
 * lookup that decides which resolved values the card is made of.
 *
 * Where each field comes from, and why it is not stored twice:
 *
 *   title    events.title
 *   startsAt events.starts_at_local, the wall clock the countdown also uses
 *   kicker   the hero block's eyebrow, after the buyer's overrides are merged
 *   venue    the map block's venueName, same
 *
 * The last two are read from the resolved blocks, not from the template
 * defaults, so a card shows the buyer's words and not Sarah and Tom's.
 */

import type { TemplateBlock, ThemeTokens } from '@/lib/template'

export type OgCardFields = {
  readonly title: string
  readonly startsAt: string
  readonly kicker: string | undefined
  readonly venue: string | undefined
}

export function ogCardFields(
  event: { readonly title: string; readonly startsAtLocal: string },
  blocks: readonly TemplateBlock[]
): OgCardFields {
  const hero = blocks.find((block) => block.type === 'hero')
  const map = blocks.find((block) => block.type === 'map')

  return {
    title: event.title,
    startsAt: event.startsAtLocal,
    kicker: hero?.type === 'hero' ? hero.config.eyebrow : undefined,
    venue: map?.type === 'map' ? map.config.venueName : undefined,
  }
}

/**
 * A short digest of everything the card draws, used as the `v` parameter on the
 * card URL.
 *
 * The card is served `immutable`, which is only safe if editing the card
 * changes its URL. When every field was in the query string that was true by
 * construction. With a slug it is not: the slug is permanent and the words
 * behind it are not, so a buyer fixing a typo would leave a wrong card cached in
 * every chat app that had already fetched it, with nothing to purge it. This
 * digest restores the property: change anything the card renders, including the
 * palette, and the URL changes with it.
 *
 * FNV-1a, 32 bit. It is a cache key, not a signature. Nothing is trusted
 * because it hashes correctly: the route resolves every field from the database
 * and ignores `v` entirely when drawing.
 */
export function ogCardVersion(fields: OgCardFields, tokens: ThemeTokens): string {
  const input = JSON.stringify([
    fields.title,
    fields.startsAt,
    fields.kicker ?? null,
    fields.venue ?? null,
    tokens,
  ])

  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(36)
}
