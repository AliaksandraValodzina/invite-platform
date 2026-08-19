/**
 * The read path a guest page will call, and specifically what it does when
 * something does not validate. Every assertion here is about a decision a guest
 * would see.
 */

import { describe, expect, it } from 'vitest'

import { EMPTY_EVENT_CONTENT, applyOverride, resolveEventPage } from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, MIDNIGHT_THEME, readSeedFile } from './seed-files'

function stored(overrides: Partial<Parameters<typeof resolveEventPage>[0]> = {}) {
  return {
    definition: readSeedFile(CLASSIC_INVITATION),
    theme: readSeedFile(IVORY_THEME),
    content: EMPTY_EVENT_CONTENT,
    themeOverride: { version: 1, tokens: {} },
    ...overrides,
  }
}

describe('a freshly activated event', () => {
  it('renders the template as written, with the template theme', () => {
    const outcome = resolveEventPage(stored())

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.map((block) => block.id)).toEqual([
      'hero',
      'event-details',
      'countdown',
      'venue-map',
      'rsvp',
    ])

    const hero = outcome.page.blocks[0]
    expect(hero?.type).toBe('hero')
    if (hero?.type !== 'hero') return
    expect(hero.config.headline).toBe('Sarah & Tom')

    expect(outcome.page.cssVariables['--color-bg']).toBe('#fdfbf7')
    expect(outcome.page.omittedBlocks).toEqual([])
    expect(outcome.page.orphanedContent).toEqual([])
    expect(outcome.page.themeOverrideRejected).toBeNull()
  })
})

describe('a buyer who has filled in the guided form', () => {
  it('sees their words, and the template default for what they did not touch', () => {
    const outcome = resolveEventPage(
      stored({
        content: {
          version: 1,
          blocks: {
            hero: { headline: 'Priya & Alex', subhead: 'are having a party' },
            rsvp: { deadlineNote: 'Please reply by 20 December.' },
          },
        },
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const hero = outcome.page.blocks[0]
    if (hero?.type !== 'hero') throw new Error('expected the hero block first')
    expect(hero.config.headline).toBe('Priya & Alex')
    expect(hero.config.subhead).toBe('are having a party')
    // Untouched by the override, so it still comes from the template. Content
    // holds overrides, not a snapshot, which is what lets a fix to a template's
    // wording reach events that never overrode it.
    expect(hero.config.eyebrow).toBe('Together with their families')

    const rsvp = outcome.page.blocks[4]
    if (rsvp?.type !== 'rsvp-form') throw new Error('expected the rsvp block last')
    expect(rsvp.config.deadlineNote).toBe('Please reply by 20 December.')
    expect(rsvp.config.submitLabel).toBe('Send RSVP')
  })

  it('can clear an optional field with null', () => {
    const outcome = resolveEventPage(
      stored({ content: { version: 1, blocks: { hero: { eyebrow: null } } } })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const hero = outcome.page.blocks[0]
    if (hero?.type !== 'hero') throw new Error('expected the hero block first')
    expect(hero.config.eyebrow).toBeUndefined()
    expect(hero.config.headline).toBe('Sarah & Tom')
  })

  it('cannot clear a required field into an empty one', () => {
    // Clearing headline is not special cased. It produces a missing field
    // error, the block is omitted, and the buyer's stored value comes back.
    const outcome = resolveEventPage(
      stored({ content: { version: 1, blocks: { hero: { headline: null } } } })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.blocks.map((block) => block.id)).not.toContain('hero')
    expect(outcome.page.omittedBlocks).toHaveLength(1)
    expect(outcome.page.omittedBlocks[0]?.id).toBe('hero')
    expect(outcome.page.omittedBlocks[0]?.issues[0]?.path).toBe('headline')
  })

  it('replaces a nested object whole rather than merging into it', () => {
    // hero.image supplied without alt is rejected, because merging is a top
    // level key replace and the merged config is checked against the full
    // schema. A deep merge would have quietly kept the old alt text on a new
    // photo.
    const outcome = resolveEventPage(
      stored({
        content: {
          version: 1,
          blocks: { hero: { image: { src: 'https://cdn.example.com/couple.jpg' } } },
        },
      })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.omittedBlocks[0]?.issues.map((issue) => issue.path)).toContain('image.alt')
  })
})

describe('when a buyer override does not validate', () => {
  const badContent = {
    version: 1,
    blocks: {
      hero: { headline: 'Priya & Alex' },
      'venue-map': { directionsUrl: 'javascript:alert(1)' },
    },
  }

  it('omits that block, renders the rest, and hands back what was stored', () => {
    const outcome = resolveEventPage(stored({ content: badContent }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The rest of the page is served. A guest arriving from a group chat gets
    // the invitation, not an error.
    expect(outcome.page.blocks.map((block) => block.id)).toEqual([
      'hero',
      'event-details',
      'countdown',
      'rsvp',
    ])

    // The bad block is reported with the buyer's value verbatim, so it can be
    // repaired. Nothing is deleted and nothing is rewritten.
    expect(outcome.page.omittedBlocks).toHaveLength(1)
    const omitted = outcome.page.omittedBlocks[0]
    expect(omitted?.id).toBe('venue-map')
    expect(omitted?.type).toBe('map')
    expect(omitted?.storedOverride).toEqual({ directionsUrl: 'javascript:alert(1)' })
    expect(omitted?.issues.map((issue) => issue.message)).toContain(
      'must use https, got "javascript:"'
    )
  })

  it('does not fall back to the template default for that block', () => {
    // The template default is placeholder copy we ship. Showing "Sarah & Tom"
    // to another couple's guests is worse than showing nothing there.
    const outcome = resolveEventPage(stored({ content: badContent }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(JSON.stringify(outcome.page.blocks)).not.toContain('The Boathouse')
  })

  it('fails the whole page when every block is omitted', () => {
    const outcome = resolveEventPage(
      stored({
        content: {
          version: 1,
          blocks: {
            hero: { headline: '' },
            'event-details': { items: [] },
            countdown: { units: [] },
            'venue-map': { venueName: '' },
            rsvp: { submitLabel: '' },
          },
        },
      })
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('no-renderable-blocks')
    expect(outcome.issues.map((issue) => issue.path)).toContain('blocks.hero.headline')
  })
})

describe('when a document does not load at all', () => {
  it('fails on a broken definition, because there is no structure to render', () => {
    const outcome = resolveEventPage(stored({ definition: { version: 1, blocks: [] } }))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.document).toBe('definition')
    expect(outcome.reason).toBe('invalid')
  })

  it('fails on a broken theme, because blocks consume tokens and nothing else', () => {
    const outcome = resolveEventPage(stored({ theme: { version: 1, tokens: {} } }))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.document).toBe('theme')
  })

  it('fails on broken content rather than serving placeholder names', () => {
    const outcome = resolveEventPage(stored({ content: { blocks: {} } }))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.document).toBe('content')
    expect(outcome.reason).toBe('missing-version')
    expect(outcome.stored).toEqual({ blocks: {} })
  })

  it('degrades to the template theme when only the palette choice is broken', () => {
    // A palette is not somebody's words. A correct page in the template's own
    // palette still serves, and the rejected choice is reported.
    const outcome = resolveEventPage(
      stored({ themeOverride: { version: 1, tokens: { color: { accent: '#fff' } } } })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.cssVariables['--color-accent']).toBe('#856539')
    expect(outcome.page.themeOverrideRejected?.stored).toEqual({
      version: 1,
      tokens: { color: { accent: '#fff' } },
    })
  })
})

describe('a buyer who picked a different palette', () => {
  it('gets their palette over the template structure and copy', () => {
    const midnight = readSeedFile(MIDNIGHT_THEME) as { tokens: { color: Record<string, string> } }

    const outcome = resolveEventPage(
      stored({ themeOverride: { version: 1, tokens: { color: midnight.tokens.color } } })
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.page.cssVariables['--color-bg']).toBe('#0d0f1a')
    // Only the colour group moved. The template's type scale is still in force,
    // which is what "a group is replaced whole" buys.
    expect(outcome.page.cssVariables['--text-display-size']).toBe('2.5rem')
    // And not one word of content changed.
    const hero = outcome.page.blocks[0]
    if (hero?.type !== 'hero') throw new Error('expected the hero block first')
    expect(hero.config.headline).toBe('Sarah & Tom')
  })
})

describe('applyOverride', () => {
  it('replaces at the top level and clears on null', () => {
    expect(applyOverride({ a: 1, b: { c: 2 }, d: 3 }, { b: { c: 9 }, d: null })).toEqual({
      a: 1,
      b: { c: 9 },
    })
  })

  it('treats a non object base as empty rather than throwing', () => {
    expect(applyOverride(null, { a: 1 })).toEqual({ a: 1 })
  })
})
