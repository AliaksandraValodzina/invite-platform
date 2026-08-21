/**
 * The envelope, as a document.
 *
 * Three claims are worth the file, and each of them is a thing a guest or a
 * buyer would notice if it broke.
 *
 * The universal envelope has to be reachable from a real stored document rather
 * than from a branch in a component. There are three ways to arrive at it, and
 * all three are exercised here: a definition that predates the envelope, one
 * that carries an empty envelope, and a buyer who cleared every field.
 *
 * A buyer's uploaded envelope has to survive the round trip through a real
 * stored document. What the upload capability writes is built and checked in
 * tests/unit/uploads/picture.test.ts; this is the other end of it, resolved
 * out of `event_content.content` the way a guest page resolves it.
 *
 * And a broken override must not cost the guest the invitation. The cover
 * degrades; the page serves.
 */

import { describe, expect, it } from 'vitest'

import {
  CURRENT_CONTENT_VERSION,
  CURRENT_DEFINITION_VERSION,
  EMPTY_EVENT_CONTENT,
  UNIVERSAL_ENVELOPE,
  envelopeConfigSchema,
  eventContentPipeline,
  resolveEventPage,
  templateDefinitionPipeline,
} from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, readSeedFile } from './seed-files'

function stored(overrides: Partial<Parameters<typeof resolveEventPage>[0]> = {}) {
  return {
    definition: readSeedFile(CLASSIC_INVITATION),
    theme: readSeedFile(IVORY_THEME),
    content: EMPTY_EVENT_CONTENT,
    themeOverride: { version: 1, tokens: {} },
    ...overrides,
  }
}

/** A definition with the envelope key removed, which is every document written before it existed. */
function withoutEnvelope(): Record<string, unknown> {
  const definition = readSeedFile(CLASSIC_INVITATION) as Record<string, unknown>
  const { envelope: _envelope, ...rest } = definition
  return { ...rest, version: 3 }
}

function contentWith(envelope: Record<string, unknown>): unknown {
  return { version: CURRENT_CONTENT_VERSION, blocks: {}, envelope }
}

describe('the committed template', () => {
  it('carries an envelope, at the definition version that introduced it', () => {
    const outcome = templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.document.version).toBe(CURRENT_DEFINITION_VERSION)
    expect(outcome.document.envelope).toEqual({
      note: "You're invited",
      openLabel: 'Tap to open',
    })
  })

  it('keeps the cover out of the block list, because it is not a block', () => {
    const outcome = templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // If the envelope were ever added as a sixth block type, this is what would
    // catch it: the block list is the five sections of the page and nothing
    // that is drawn over them.
    expect(outcome.document.blocks.map((block) => block.type)).toEqual([
      'hero',
      'details',
      'countdown',
      'map',
      'rsvp-form',
    ])
  })
})

describe('the universal envelope', () => {
  it('is what a definition written before the envelope existed resolves to', () => {
    const outcome = resolveEventPage(stored({ definition: withoutEnvelope() }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // Migrated on read, up the ladder, and the page it produces has a cover.
    expect(outcome.page.migrated.definition).toBe(true)
    expect(outcome.page.envelope).toEqual(UNIVERSAL_ENVELOPE)
  })

  it('is what a buyer who cleared every field resolves to', () => {
    const outcome = resolveEventPage(
      stored({ content: contentWith({ note: null, openLabel: null }) })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.envelope).toEqual(UNIVERSAL_ENVELOPE)
    expect(outcome.page.envelopeOverrideRejected).toBeNull()
  })

  it('is an empty config rather than a missing one, so the page always has a cover', () => {
    const outcome = resolveEventPage(stored({ definition: withoutEnvelope() }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The distinction this asserts: `{}` means "the plain envelope", and there
    // is no value that means "no envelope at all". A page always has a cover.
    expect(outcome.page.envelope).not.toBeNull()
    expect(outcome.page.envelope).not.toBeUndefined()
  })
})

describe("a buyer's own envelope", () => {
  it('replaces one field and keeps the rest, the way a block override does', () => {
    const outcome = resolveEventPage(stored({ content: contentWith({ note: 'Save the date' }) }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.envelope).toEqual({ note: 'Save the date', openLabel: 'Tap to open' })
  })

  it('renders a picture the upload capability wrote, with every width it stored', () => {
    /*
     * Exactly what `pictureFromUpload` produces, resolved through the
     * real resolver: keys as `/a/<key>`, no hostname anywhere in the stored
     * document, and both re-encoded widths surviving the round trip. A shape
     * that lost `widths` here would leave the second file stored, charged for
     * and never served, and every other test would stay green.
     */
    const image = {
      src: '/a/9f2c1ab40d3e7856bb91c204-w800.webp',
      widths: [
        { src: '/a/9f2c1ab40d3e7856bb91c204-w800.webp', width: 800 },
        { src: '/a/41d8e7b0c9a3251f6e0d4487-w1600.webp', width: 1600 },
      ],
    }

    const outcome = resolveEventPage(stored({ content: contentWith({ image }) }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.envelope.image).toEqual(image)
  })

  it('refuses a width that is not a whole number of pixels, rather than drawing it', () => {
    // A `w` descriptor is an integer. Anything else silently disables the
    // candidate in some browsers and is accepted in others, which is the worst
    // of both: it would be a picture that is right on the machine it was tested
    // on. The override degrades to the template's envelope instead.
    const outcome = resolveEventPage(
      stored({
        content: contentWith({
          image: {
            src: '/a/9f2c1ab40d3e7856bb91c204-w800.webp',
            widths: [{ src: '/a/9f2c1ab40d3e7856bb91c204-w800.webp', width: 800.5 }],
          },
        }),
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.envelope.image).toBeUndefined()
    expect(outcome.page.envelopeOverrideRejected?.issues[0]?.path).toContain('width')
  })

  it('degrades to the template envelope when the override is not valid, and still serves', () => {
    const outcome = resolveEventPage(
      stored({ content: contentWith({ openLabel: 'x'.repeat(200) }) })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The invitation is the point. A cover nobody can parse costs the guest the
    // template's cover, and nothing else.
    expect(outcome.page.blocks).toHaveLength(5)
    expect(outcome.page.envelope).toEqual({ note: "You're invited", openLabel: 'Tap to open' })
    expect(outcome.page.envelopeOverrideRejected?.stored).toEqual({ openLabel: 'x'.repeat(200) })
    expect(outcome.page.envelopeOverrideRejected?.issues[0]?.path).toBe('openLabel')
  })
})

describe('what an envelope may hold', () => {
  it('refuses a picture that is not one this app or an https host serves', () => {
    for (const src of ['/a/script.svg', '/../secrets/x.png', 'http://elsewhere/x.png']) {
      expect(envelopeConfigSchema.safeParse({ image: { src } }).success).toBe(false)
    }
  })

  it('refuses a candidate width that is not one this app or an https host serves', () => {
    // The candidate list gets the same treatment as the fallback. A `srcset`
    // is a list of things a browser will fetch, so a rule applied only to `src`
    // is a rule with a hole the shape of the attribute the browser prefers.
    expect(
      envelopeConfigSchema.safeParse({
        image: {
          src: '/a/9f2c1ab40d3e7856bb91c204-w800.webp',
          widths: [{ src: 'http://elsewhere/x.png', width: 1600 }],
        },
      }).success
    ).toBe(false)
  })

  it('has no alt key, so nobody is ever asked to transcribe a picture', () => {
    expect(
      envelopeConfigSchema.safeParse({ image: { src: '/a/x.jpg', alt: 'an envelope' } }).success
    ).toBe(false)
  })

  it('has no headline, because the cover shows the one the invitation already carries', () => {
    // A second copy of the couple's names, in a second field of the guided
    // form, that can disagree with the first one. See src/lib/template/envelope.ts.
    expect(envelopeConfigSchema.safeParse({ headline: 'Sarah & Tom' }).success).toBe(false)
  })
})

describe('the content document', () => {
  it('carries the envelope override beside the block overrides, not inside them', () => {
    const outcome = eventContentPipeline.load(contentWith({ note: 'Save the date' }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.document.envelope).toEqual({ note: 'Save the date' })
    expect(outcome.document.blocks).toEqual({})
  })

  it('migrates a document written before the envelope existed', () => {
    const outcome = eventContentPipeline.load({ version: 1, blocks: { hero: { eyebrow: 'Hi' } } })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.migrated).toBe(true)
    expect(outcome.document.version).toBe(CURRENT_CONTENT_VERSION)
    expect(outcome.document.envelope).toBeUndefined()
    // Nothing about the buyer's blocks moved, which is what "no rewrite" means.
    expect(outcome.document.blocks).toEqual({ hero: { eyebrow: 'Hi' } })
  })
})
