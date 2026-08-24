/**
 * Composition at the format level: which of a template's sections an invitation
 * has, in what order.
 *
 * Two claims are worth the file. Absent means the template, so an event written
 * before composition existed is unchanged by it and a template that gains a
 * section still reaches every buyer who never composed. And an id the template
 * no longer has is skipped rather than fatal, because a wedding page that went
 * dark over a change we made to a template is a failure nobody on the buyer's
 * side can even see the cause of.
 */

import { describe, expect, it } from 'vitest'

import {
  CURRENT_CONTENT_VERSION,
  composeSections,
  eventContentPipeline,
  eventContentSchema,
  resolveEventPage,
  sameSections,
  sectionIdsOf,
} from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, readSeedFile } from './seed-files'

const BLOCKS = [
  { id: 'hero', type: 'hero' },
  { id: 'event-details', type: 'details' },
  { id: 'rsvp', type: 'rsvp-form' },
]

describe('composeSections', () => {
  it('is the template, untouched, when the buyer has composed nothing', () => {
    const composed = composeSections(BLOCKS, undefined)

    expect(composed.blocks).toBe(BLOCKS)
    expect(composed.removed).toEqual([])
    expect(composed.unknown).toEqual([])
  })

  it('draws the sections named, in the order they are named in', () => {
    const composed = composeSections(BLOCKS, ['rsvp', 'hero'])

    expect(composed.blocks.map((block) => block.id)).toEqual(['rsvp', 'hero'])
  })

  it('reports the template sections left off, rather than forgetting them', () => {
    const composed = composeSections(BLOCKS, ['hero'])

    expect(composed.removed).toEqual(['event-details', 'rsvp'])
  })

  it('skips an id the template has no section for, and says which', () => {
    const composed = composeSections(BLOCKS, ['hero', 'gallery', 'rsvp'])

    expect(composed.blocks.map((block) => block.id)).toEqual(['hero', 'rsvp'])
    expect(composed.unknown).toEqual(['gallery'])
    // Not removed: the template does not have it either, so there is nothing to
    // put back and nothing to report as taken out.
    expect(composed.removed).toEqual(['event-details'])
  })

  it('carries the block whole, so config still comes from the template', () => {
    const blocks = [{ id: 'hero', type: 'hero', config: { headline: 'Sarah & Tom' } }]
    const composed = composeSections(blocks, ['hero'])

    expect(composed.blocks[0]).toBe(blocks[0])
  })
})

describe('sectionIdsOf and sameSections', () => {
  it('writes a template block order as the list it would be stored as', () => {
    expect(sectionIdsOf(BLOCKS)).toEqual(['hero', 'event-details', 'rsvp'])
  })

  it('is order sensitive, because the order is the whole point', () => {
    expect(sameSections(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameSections(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameSections(['a'], ['a', 'b'])).toBe(false)
  })
})

describe('the stored shape', () => {
  it('accepts a document with no section list at all, which is every old event', () => {
    const outcome = eventContentPipeline.load({ version: 2, blocks: {} })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.sections).toBeUndefined()
    expect(outcome.document.version).toBe(CURRENT_CONTENT_VERSION)
  })

  it('refuses the same section twice, because content is keyed by id', () => {
    const parsed = eventContentSchema.safeParse({
      version: CURRENT_CONTENT_VERSION,
      blocks: {},
      sections: ['hero', 'hero'],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('same section twice')
  })

  it('refuses an empty list, the way the definition refuses an empty block list', () => {
    const parsed = eventContentSchema.safeParse({
      version: CURRENT_CONTENT_VERSION,
      blocks: {},
      sections: [],
    })

    expect(parsed.success).toBe(false)
  })
})

/**
 * The same claims through the real resolver and the committed template, because
 * a composition that works over a fixture and not over the thing we ship is
 * worth nothing.
 */
describe('a guest page under a buyer composition', () => {
  function stored(content: unknown) {
    return {
      definition: readSeedFile(CLASSIC_INVITATION),
      theme: readSeedFile(IVORY_THEME),
      content,
      themeOverride: { version: 1, tokens: {} },
    }
  }

  it('draws the sections the buyer composed, in their order', () => {
    const outcome = resolveEventPage(
      stored({
        version: CURRENT_CONTENT_VERSION,
        blocks: {},
        sections: ['hero', 'rsvp', 'countdown'],
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.map((block) => block.id)).toEqual(['hero', 'rsvp', 'countdown'])
    expect(outcome.page.removedSections).toEqual(['event-details', 'venue-map'])
    expect(outcome.page.unknownSections).toEqual([])
  })

  it('keeps the words behind a removed section, and does not call them orphaned', () => {
    const outcome = resolveEventPage(
      stored({
        version: CURRENT_CONTENT_VERSION,
        blocks: { 'venue-map': { venueName: 'The Quist Family Orangery' } },
        sections: ['hero', 'rsvp'],
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.map((block) => block.id)).toEqual(['hero', 'rsvp'])
    expect(outcome.page.removedSections).toContain('venue-map')
    /*
     * Orphaned means the TEMPLATE has no block with that id, which is a
     * different thing and a worse one: there is nowhere for those words to go
     * back to. A section the buyer took out still has somewhere.
     */
    expect(outcome.page.orphanedContent).toEqual([])
  })

  it('still calls content orphaned when the template really has no such block', () => {
    const outcome = resolveEventPage(
      stored({
        version: CURRENT_CONTENT_VERSION,
        blocks: { gallery: { heading: 'Photographs' } },
        sections: ['hero', 'rsvp'],
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.orphanedContent).toEqual([
      { id: 'gallery', storedOverride: { heading: 'Photographs' } },
    ])
  })

  it('serves the rest when a composition names a section this template lost', () => {
    const outcome = resolveEventPage(
      stored({ version: CURRENT_CONTENT_VERSION, blocks: {}, sections: ['hero', 'gallery'] })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.map((block) => block.id)).toEqual(['hero'])
    expect(outcome.page.unknownSections).toEqual(['gallery'])
  })

  it('refuses a page when the composition names nothing this template has', () => {
    const outcome = resolveEventPage(
      stored({ version: CURRENT_CONTENT_VERSION, blocks: {}, sections: ['gallery'] })
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    expect(outcome.reason).toBe('no-renderable-blocks')
    expect(outcome.issues).toContainEqual({
      path: 'sections.gallery',
      message: 'this template has no section with that id',
    })
    // The stored value comes back verbatim, as it does on every failure here.
    expect(outcome.stored).toEqual({
      version: CURRENT_CONTENT_VERSION,
      blocks: {},
      sections: ['gallery'],
    })
  })
})
