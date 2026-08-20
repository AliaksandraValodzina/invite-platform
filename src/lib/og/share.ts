/**
 * The share surface: the URL the card is fetched from, the parameters that URL
 * carries, and the meta tags that point a chat app at it.
 *
 * The meta tags are the feature, not the image. WhatsApp, iMessage and Instagram
 * each fetch the page once, read the tags and give up quickly, so three things
 * are non negotiable and all three are asserted:
 *
 *   - `og:image` is an ABSOLUTE URL. A relative one silently renders no preview.
 *   - `og:image:width` and `og:image:height` are declared, so the crawler lays
 *     the bubble out before the image arrives instead of after.
 *   - the image has alt text, because the preview is read aloud by screen
 *     readers and because a card that fails to load still has to say something.
 *
 * The URL carries a slug and a version, and nothing else. It used to carry the
 * card's words, which meant anyone could ask this origin for a card saying
 * whatever they liked. The route now resolves every field from the event row,
 * so the only thing a caller can choose is which published event to ask about,
 * which is a thing they could already read by opening the page. `v` is a digest
 * of what the card draws (see ogCardVersion) and exists so that editing an event
 * changes its card's URL, which is what makes an immutable cache lifetime safe.
 */

import { z } from 'zod'

import { OG_CARD_HEIGHT, OG_CARD_WIDTH } from './contract'
import { formatEventWhen } from './format'

/** Matches `events_slug_format` in 20260819010400_events.sql. */
export const ogCardParamsSchema = z.strictObject({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be an event slug'),
  /**
   * Optional, and the response's cache lifetime depends on it. A URL with a
   * version identifies one rendering of one event forever, so it is served
   * immutable. A URL without one is just "the current card for this slug", and
   * is served with the same short lifetime as the page.
   */
  v: z
    .string()
    .regex(/^[0-9a-z]{1,13}$/, 'must be a card version digest')
    .optional(),
})

export type OgCardParams = z.infer<typeof ogCardParamsSchema>

export type OgParamIssue = { readonly path: string; readonly message: string }

export type OgParamsOutcome =
  | { readonly ok: true; readonly params: OgCardParams }
  | { readonly ok: false; readonly issues: readonly OgParamIssue[] }

export function parseOgCardParams(search: URLSearchParams): OgParamsOutcome {
  const raw: Record<string, string> = {}
  for (const key of ogCardParamsSchema.keyof().options) {
    const value = search.get(key)
    if (value !== null) raw[key] = value
  }

  const parsed = ogCardParamsSchema.safeParse(raw)
  if (parsed.success) return { ok: true, params: parsed.data }

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  }
}

const PARAM_ORDER = ['slug', 'v'] as const

export function buildOgCardUrl(siteUrl: string, params: OgCardParams): string {
  const url = new URL('/api/og', siteUrl)

  for (const key of PARAM_ORDER) {
    const value = params[key]
    if (value !== undefined) url.searchParams.set(key, value)
  }

  return url.toString()
}

/** The wordmark printed on the card, so a screenshot still leads somewhere. */
export function ogCardFooter(siteUrl: string, slug?: string): string {
  const host = new URL(siteUrl).host
  return slug === undefined ? host : `${host}/e/${slug}`
}

export type ShareMetadataInput = {
  readonly siteUrl: string
  readonly slug: string
  readonly title: string
  readonly startsAtLocal: string
  readonly kicker?: string | undefined
  readonly venue?: string | undefined
  /** Digest from ogCardVersion. Absent means the card URL is not immutable. */
  readonly cardVersion?: string | undefined
}

export type ShareImage = {
  readonly url: string
  readonly width: number
  readonly height: number
  readonly alt: string
  readonly type: string
}

export type ShareMetadata = {
  readonly title: string
  readonly description: string
  readonly openGraph: {
    readonly type: 'website'
    readonly url: string
    readonly title: string
    readonly description: string
    readonly images: readonly ShareImage[]
  }
  readonly twitter: {
    readonly card: 'summary_large_image'
    readonly title: string
    readonly description: string
    readonly images: readonly string[]
  }
}

export function buildEventShareMetadata(input: ShareMetadataInput): ShareMetadata {
  const when = formatEventWhen(input.startsAtLocal)

  const params: OgCardParams = {
    slug: input.slug,
    ...(input.cardVersion === undefined ? {} : { v: input.cardVersion }),
  }

  const imageUrl = buildOgCardUrl(input.siteUrl, params)
  const venueClause = input.venue === undefined ? '' : ` at ${input.venue}`
  const description = `${when.line}${venueClause}. RSVP online.`

  const image: ShareImage = {
    url: imageUrl,
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    alt: `Invitation card for ${input.title}, ${when.line}${venueClause}.`,
    type: 'image/png',
  }

  return {
    title: input.title,
    description,
    openGraph: {
      type: 'website',
      url: new URL(`/e/${input.slug}`, input.siteUrl).toString(),
      title: input.title,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description,
      images: [imageUrl],
    },
  }
}
