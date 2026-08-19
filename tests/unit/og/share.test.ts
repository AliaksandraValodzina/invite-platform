import { describe, expect, it } from 'vitest'

import {
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  buildEventShareMetadata,
  buildOgCardUrl,
  parseOgCardParams,
} from '@/lib/og'

const SITE_URL = 'https://invite.example'

const PARAMS = {
  title: 'Emma & Jake',
  startsAt: '2027-03-14T16:00:00',
  theme: 'ivory',
  kicker: 'You are invited',
  venue: 'The Grounds of Alexandria, Sydney',
  slug: 'emma-and-jake-7fq2',
} as const

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

  it('leaves absent fields out of the query rather than sending empty ones', () => {
    const url = new URL(
      buildOgCardUrl(SITE_URL, { title: 'Emma & Jake', startsAt: '2027-03-14T16:00:00' })
    )

    expect([...url.searchParams.keys()].sort()).toEqual(['startsAt', 'title'])
  })
})

describe('parseOgCardParams', () => {
  function parse(query: Record<string, string>) {
    return parseOgCardParams(new URLSearchParams(query))
  }

  it('requires the two fields the card cannot be drawn without', () => {
    const parsed = parse({ kicker: 'You are invited' })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues.map((issue) => issue.path).sort()).toEqual(['startsAt', 'title'])
    }
  })

  it('rejects a title longer than the events table will store', () => {
    const parsed = parse({ title: 'A'.repeat(161), startsAt: '2027-03-14T16:00:00' })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('title')
  })

  it('rejects a timestamp that is not the stored local form', () => {
    const parsed = parse({ title: 'Emma & Jake', startsAt: '2027-03-14T16:00:00Z' })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('startsAt')
  })

  it('rejects a theme that is not a seeded one, rather than falling back silently', () => {
    const parsed = parse({
      title: 'Emma & Jake',
      startsAt: '2027-03-14T16:00:00',
      theme: 'neon',
    })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('theme')
  })

  it('leaves the theme unset when none was asked for, rather than inventing one', () => {
    const parsed = parse({ title: 'Emma & Jake', startsAt: '2027-03-14T16:00:00' })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.params.theme).toBeUndefined()
  })
})

describe('buildEventShareMetadata', () => {
  const metadata = buildEventShareMetadata({
    siteUrl: SITE_URL,
    slug: PARAMS.slug,
    title: PARAMS.title,
    startsAtLocal: PARAMS.startsAt,
    kicker: PARAMS.kicker,
    venue: PARAMS.venue,
    theme: PARAMS.theme,
  })

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

  it('writes alt text that says what the card says', () => {
    const image = metadata.openGraph.images[0]

    expect(image?.alt).toContain(PARAMS.title)
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
      title: PARAMS.title,
      startsAtLocal: PARAMS.startsAt,
    })

    expect(withoutVenue.description).toBe('Sunday 14 March 2027 · 4:00 pm. RSVP online.')
  })
})
