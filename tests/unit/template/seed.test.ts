/**
 * The committed seed files are the Phase 0 template catalogue. A malformed one
 * should fail the pull request, not the database insert, so this file is the
 * gate on them.
 */

import { describe, expect, it } from 'vitest'

import { BLOCK_TYPES, templateDefinitionPipeline, themePipeline } from '@/lib/template'

import { CLASSIC_INVITATION, IVORY_THEME, MIDNIGHT_THEME, readSeedFile } from './seed-files'

describe('the committed template definition', () => {
  it('validates, and its blocks are the ones the page is meant to have', () => {
    const outcome = templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.document.version).toBe(1)
    expect(outcome.migrated).toBe(false)

    // Read the ids and types, do not just count the blocks. Order is the page
    // order, so this is asserting the shape of the invitation itself.
    expect(outcome.document.blocks.map((block) => [block.id, block.type])).toEqual([
      ['hero', 'hero'],
      ['event-details', 'details'],
      ['countdown', 'countdown'],
      ['venue-map', 'map'],
      ['rsvp', 'rsvp-form'],
    ])
  })

  it('parses to exactly what is stored, so reading a document can never rewrite it', () => {
    const stored = readSeedFile(CLASSIC_INVITATION)
    const outcome = templateDefinitionPipeline.load(stored)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // No schema in the format uses .default(), so the parsed document is the
    // stored document. If that ever stops being true, a write back would
    // silently change a buyer's row.
    expect(outcome.document).toEqual(stored)
  })

  it('carries no colour, font, spacing or radius value anywhere in it', () => {
    const serialised = JSON.stringify(readSeedFile(CLASSIC_INVITATION))

    expect(serialised).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(serialised).not.toMatch(/\b(rem|px|serif|sans-serif)\b/)
    expect(serialised).not.toMatch(/"(color|colour|font|radius|spacing|space)"/i)
  })

  it('carries no date, time or time zone, because the event row owns those', () => {
    const outcome = templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const details = outcome.document.blocks.find((block) => block.id === 'event-details')
    expect(details?.type).toBe('details')
    if (details?.type !== 'details') return

    // The two time bearing items name a field on the event row rather than
    // spelling a date out, which is what keeps the countdown and the details
    // list from ever disagreeing.
    expect(details.config.items.filter((item) => item.source !== undefined)).toEqual([
      { icon: 'calendar', label: 'When', source: 'event-date' },
      { icon: 'clock', label: 'Ceremony', source: 'event-start-time' },
    ])
  })
})

describe('the committed themes', () => {
  it.each([
    ['ivory', IVORY_THEME],
    ['midnight', MIDNIGHT_THEME],
  ])('%s validates against the one token schema', (_name, path) => {
    const outcome = themePipeline.load(readSeedFile(path))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.version).toBe(1)
  })

  it('are genuinely different looks built from the same roles', () => {
    const ivory = themePipeline.parse(readSeedFile(IVORY_THEME))
    const midnight = themePipeline.parse(readSeedFile(MIDNIGHT_THEME))

    // Same keys, different values, which is the whole claim about tokens.
    expect(Object.keys(ivory.tokens.color)).toEqual(Object.keys(midnight.tokens.color))
    expect(ivory.tokens.color.bg).toBe('#fdfbf7')
    expect(midnight.tokens.color.bg).toBe('#0d0f1a')
    expect(ivory.tokens.font.heading).not.toBe(midnight.tokens.font.heading)
    expect(ivory.tokens.radius.sm).toBe(0.25)
    expect(midnight.tokens.radius.sm).toBe(0)
  })

  it('contain no blocks, because a theme is not allowed to carry content', () => {
    // The same rule the templates_theme_carries_no_blocks constraint enforces
    // in the database, asserted here where the document is written.
    for (const path of [IVORY_THEME, MIDNIGHT_THEME]) {
      expect(Object.keys(readSeedFile(path) as Record<string, unknown>)).toEqual([
        'version',
        'tokens',
      ])
    }
  })
})

describe('the block registry and the seed agree', () => {
  it('uses only block types the registry knows about', () => {
    const outcome = templateDefinitionPipeline.parse(readSeedFile(CLASSIC_INVITATION))
    const used = new Set(outcome.blocks.map((block) => block.type))

    expect([...used].sort()).toEqual([...BLOCK_TYPES].sort())
  })
})
