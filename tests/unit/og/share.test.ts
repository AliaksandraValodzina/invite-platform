import { describe, expect, it } from 'vitest'

import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  buildEventShareMetadata,
  buildOgCardUrl,
  parseOgCardParams,
} from '@/lib/og'

const SITE_URL = 'https://invite.example'

const PARAMS = { slug: 'emma-and-jake-7fq2', v: '1x8kq2' } as const

const EVENT = {
  siteUrl: SITE_URL,
  slug: PARAMS.slug,
  title: 'Emma & Jake',
  startsAtLocal: '2027-03-14T16:00:00',
  kicker: 'You are invited',
  venue: 'The Grounds of Alexandria, Sydney',
  cardVersion: PARAMS.v,
}

describe('buildOgCardUrl', () => {
  it('produces an absolute URL, because a relative og:image never renders in a chat', () => {
    const url = buildOgCardUrl(SITE_URL, PARAMS)

    expect(url.startsWith(`${SITE_URL}/api/og?`)).toBe(true)
    expect(new URL(url).origin).toBe(SITE_URL)
  })

  it('round trips through the parser it is read by', () => {
    const url = new URL(buildOgCardUrl(SITE_URL, PARAMS))
    const parsed = parseOgCardParams(url.searchParams)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.params).toEqual(PARAMS)
  })

  it('leaves the version out of the query rather than sending an empty one', () => {
    const url = new URL(buildOgCardUrl(SITE_URL, { slug: PARAMS.slug }))

    expect([...url.searchParams.keys()]).toEqual(['slug'])
  })
})

describe('parseOgCardParams', () => {
  function parse(query: Record<string, string>) {
    return parseOgCardParams(new URLSearchParams(query))
  }

  it('requires the slug, which is the only thing the card is looked up by', () => {
    const parsed = parse({ v: '1x8kq2' })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues.map((issue) => issue.path)).toEqual(['slug'])
  })

  it('rejects anything the events table could not hold as a slug', () => {
    for (const slug of ['Emma-And-Jake', 'emma_and_jake', 'em', 'a'.repeat(65), '../secret']) {
      const parsed = parse({ slug })

      expect(parsed.ok, `"${slug}" was accepted as a slug`).toBe(false)
      if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('slug')
    }
  })

  it('rejects a version that is not a digest, so the immutable URL space stays small', () => {
    const parsed = parse({ slug: PARAMS.slug, v: 'not a digest' })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('v')
  })

  it('accepts a bare slug, and leaves the version unset rather than inventing one', () => {
    const parsed = parse({ slug: PARAMS.slug })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.params.v).toBeUndefined()
  })

  it('has nowhere to put the fields the card used to take from the caller', () => {
    const parsed = parse({
      slug: PARAMS.slug,
      v: PARAMS.v,
      title: 'Somebody else entirely',
      kicker: 'A message from a stranger',
    })

    // Extra parameters are ignored rather than refused, because a chat app or a
    // link shortener appending its own is not an attack and a 400 there is a
    // preview that never renders. What matters is that nothing a caller sends
    // can reach the card: the parsed surface is a slug and a cache key, and the
    // route draws every word from the event row.
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(Object.keys(parsed.params).sort()).toEqual(['slug', 'v'])
  })
})

describe('buildEventShareMetadata', () => {
  const metadata = buildEventShareMetadata(EVENT)

  it('points og:url at the page a guest opens', () => {
    expect(metadata.openGraph.url).toBe(`${SITE_URL}/e/${PARAMS.slug}`)
  })

  it('declares the card at the size the chat apps crop from', () => {
    const image = metadata.openGraph.images[0]

    expect(image).toBeDefined()
    expect(image?.width).toBe(OG_CARD_WIDTH)
    expect(image?.height).toBe(OG_CARD_HEIGHT)
    expect(new URL(image!.url).origin).toBe(SITE_URL)
  })

  it('puts the slug and the version in the card URL, and none of the card text', () => {
    const url = new URL(metadata.openGraph.images[0]!.url)

    expect([...url.searchParams.keys()].sort()).toEqual(['slug', 'v'])
    expect(url.searchParams.get('slug')).toBe(PARAMS.slug)
    expect(url.searchParams.get('v')).toBe(PARAMS.v)
    // The whole point of the lookup: nothing a card draws travels in its URL.
    expect(url.search).not.toContain('Emma')
    expect(url.search).not.toContain('Alexandria')
  })

  it('writes alt text that says what the card says', () => {
    const image = metadata.openGraph.images[0]

    expect(image?.alt).toContain(EVENT.title)
    expect(image?.alt).toContain('Sunday 14 March 2027')
  })

  it('asks for the large card on Twitter and X rather than the thumbnail one', () => {
    expect(metadata.twitter.card).toBe('summary_large_image')
    expect(metadata.twitter.images).toEqual([metadata.openGraph.images[0]?.url])
  })

  it('describes the event in the text the preview shows under the card', () => {
    expect(metadata.description).toBe(
      'Sunday 14 March 2027 · 4:00 pm at The Grounds of Alexandria, Sydney. RSVP online.'
    )
  })

  it('drops the venue clause when there is no venue, rather than printing a gap', () => {
    const withoutVenue = buildEventShareMetadata({
      siteUrl: SITE_URL,
      slug: PARAMS.slug,
      title: EVENT.title,
      startsAtLocal: EVENT.startsAtLocal,
    })

    expect(withoutVenue.description).toBe('Sunday 14 March 2027 · 4:00 pm. RSVP online.')
  })
})
