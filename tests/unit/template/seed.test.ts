/**
 * The committed seed files are the Phase 0 template catalogue. A malformed one
 * should fail the pull request, not the database insert, so this file is the
 * gate on them.
 */

import { describe, expect, it } from 'vitest'

import {
  BLOCK_TYPES,
  CURRENT_DEFINITION_VERSION,
  CURRENT_THEME_VERSION,
  templateDefinitionPipeline,
  themePipeline,
} from '@/lib/template'

import {
  ALL_THEMES,
  CLASSIC_INVITATION,
  DECKLE_AND_DEBOSS_THEME,
  DESIGN_DIRECTION_THEMES,
  FOIL_AND_MIDNIGHT_THEME,
  MASTHEAD_THEME,
  readSeedFile,
} from './seed-files'

describe('the committed template definition', () => {
  it('validates, and its blocks are the ones the page is meant to have', () => {
    const outcome = templateDefinitionPipeline.load(readSeedFile(CLASSIC_INVITATION))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // Seeds are authored now, so they are authored at the current version and
    // nothing has to be migrated to read them.
    expect(outcome.document.version).toBe(CURRENT_DEFINITION_VERSION)
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
  it.each(ALL_THEMES)('%s validates against the one token schema', (_name, path) => {
    const outcome = themePipeline.load(readSeedFile(path))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.version).toBe(CURRENT_THEME_VERSION)
    // Every committed file is already at the current version, so nothing here
    // is passing only because a migration rescued it.
    expect(outcome.migrated).toBe(false)
  })

  it('are genuinely different looks built from the same roles', () => {
    const tokens = ALL_THEMES.map(([, path]) => themePipeline.parse(readSeedFile(path)).tokens)
    const roles = Object.keys(tokens[0]?.color ?? {})

    for (const theme of tokens) expect(Object.keys(theme.color)).toEqual(roles)

    // Same keys, different values, which is the whole claim about tokens. Read
    // the values rather than counting distinct ones: five themes that all
    // happened to share a background would pass a count.
    expect(tokens.map((theme) => theme.color.bg)).toEqual([
      '#fdfbf7',
      '#0d0f1a',
      '#f3f1ec',
      '#fcfbfa',
      '#131a2b',
    ])
    expect(new Set(tokens.map((theme) => theme.font.heading)).size).toBe(ALL_THEMES.length)
  })

  it('contain no blocks, because a theme is not allowed to carry content', () => {
    // The same rule the templates_theme_carries_no_blocks constraint enforces
    // in the database, asserted here where the document is written.
    for (const [, path] of ALL_THEMES) {
      expect(Object.keys(readSeedFile(path) as Record<string, unknown>)).toEqual([
        'version',
        'tokens',
      ])
    }
  })
})

/**
 * The three design directions, against the values in
 * data/ip-design-directions/report.md.
 *
 * Every hex, size, weight and tracking below is quoted from that report, and
 * this is the file that stops one of them drifting. The report's own warning is
 * the reason: each value "was chosen against a measured contrast table, and
 * changing one silently breaks that table". The table itself is asserted in
 * contrast.test.ts; this is the half that pins the inputs to it.
 *
 * Sizes in the report are px and the token schema stores rem, so each size here
 * is the report's number over 16. That conversion is exact, and it is the only
 * arithmetic anything does to these values.
 */
describe('the three design directions', () => {
  const deckle = themePipeline.parse(readSeedFile(DECKLE_AND_DEBOSS_THEME)).tokens
  const masthead = themePipeline.parse(readSeedFile(MASTHEAD_THEME)).tokens
  const foil = themePipeline.parse(readSeedFile(FOIL_AND_MIDNIGHT_THEME)).tokens

  it('carries the report palettes, hex for hex', () => {
    expect(deckle.color).toMatchObject({
      bg: '#f3f1ec',
      surface: '#fbfaf7',
      accent: '#7b2d3b',
      ink: '#1b1e24',
      inkMuted: '#5b6068',
    })
    expect(masthead.color).toMatchObject({
      bg: '#fcfbfa',
      surface: '#efece6',
      accent: '#1f3bb3',
      ink: '#111111',
      inkMuted: '#5a5a5a',
    })
    expect(foil.color).toMatchObject({
      bg: '#131a2b',
      surface: '#1d2740',
      accent: '#d8b368',
      ink: '#f3efe4',
      inkMuted: '#a8b0c6',
    })
  })

  it('carries the report font stacks, in the report order', () => {
    // The order is the fallback chain, so it is content rather than formatting:
    // the second entry is what a guest sees when the self hosted face has not
    // arrived yet.
    expect(deckle.font).toEqual({
      heading: "'EB Garamond', 'Iowan Old Style', 'Times New Roman', serif",
      body: "'Karla', 'Helvetica Neue', Arial, sans-serif",
    })
    expect(masthead.font).toEqual({
      heading: "'Bodoni Moda', Didot, 'Bodoni MT', Georgia, serif",
      body: "'Archivo', 'Helvetica Neue', Arial, sans-serif",
    })
    expect(foil.font).toEqual({
      heading: "'Cinzel', 'Trajan Pro', Optima, Georgia, serif",
      body: "'Jost', Futura, 'Century Gothic', 'Avenir Next', sans-serif",
    })
  })

  it('carries the report mobile type scale, converted from px to rem and nothing else', () => {
    // The report's h2 is this format's `title`. Mobile only: the token schema
    // stores one size per role, and the report says the mobile values are the
    // designed end because guest pages are tested at 320px. The desktop column
    // has no home in the format, which the pull request says out loud.
    expect(deckle.typeScale).toEqual({
      display: { font: 'heading', size: 40 / 16, lineHeight: 1.05, weight: 400 },
      title: { font: 'heading', size: 22 / 16, lineHeight: 1.3, weight: 400 },
      body: { font: 'body', size: 16 / 16, lineHeight: 1.6, weight: 400 },
      caption: { font: 'body', size: 13 / 16, lineHeight: 1.4, weight: 600, tracking: 0.08 },
    })
    expect(masthead.typeScale).toEqual({
      display: { font: 'heading', size: 42 / 16, lineHeight: 1.0, weight: 400, tracking: -0.01 },
      title: { font: 'body', size: 24 / 16, lineHeight: 1.2, weight: 600 },
      body: { font: 'body', size: 16 / 16, lineHeight: 1.55, weight: 400 },
      caption: { font: 'body', size: 12 / 16, lineHeight: 1.4, weight: 600, tracking: 0.14 },
    })
    expect(foil.typeScale).toEqual({
      display: { font: 'heading', size: 34 / 16, lineHeight: 1.1, weight: 400, tracking: 0.04 },
      title: { font: 'heading', size: 19 / 16, lineHeight: 1.3, weight: 400, tracking: 0.1 },
      body: { font: 'body', size: 16 / 16, lineHeight: 1.65, weight: 400 },
      caption: { font: 'body', size: 13 / 16, lineHeight: 1.5, weight: 400, tracking: 0.06 },
    })
  })

  it('sets Masthead section headings in Archivo, because Bodoni Moda is display only', () => {
    // The report: "Bodoni hairlines disappear below roughly 32px". Masthead's
    // section headings are 24px on a phone, so a title set in the heading stack
    // would ship the exact failure the report warned about. This is the reason
    // the font choice became a token in theme version 2.
    expect(masthead.typeScale.title.font).toBe('body')
    expect(masthead.typeScale.display.font).toBe('heading')
    expect(masthead.typeScale.display.size * 16).toBeGreaterThanOrEqual(32)

    // The other two directions do set section headings in their display face,
    // which is what makes the token worth having rather than a blanket rule
    // flipped the other way.
    expect(deckle.typeScale.title.font).toBe('heading')
    expect(foil.typeScale.title.font).toBe('heading')
  })

  it('takes its five space steps from the report scale, in order', () => {
    // The report gives an ordered eight step scale in px and the schema has
    // five named steps. The mapping is indices 1, 2, 3, 5 and 6 for every
    // direction, so no direction gets a rhythm the others did not.
    const REPORT_SCALES: Readonly<Record<string, readonly number[]>> = {
      deckle: [4, 8, 12, 16, 24, 40, 64, 104],
      masthead: [4, 8, 16, 24, 40, 64, 96, 144],
      foil: [4, 8, 12, 20, 32, 52, 84, 136],
    }
    const INDICES = [1, 2, 3, 5, 6] as const

    for (const [key, tokens] of [
      ['deckle', deckle],
      ['masthead', masthead],
      ['foil', foil],
    ] as const) {
      const scale = REPORT_SCALES[key] as readonly number[]
      const expected = INDICES.map((index) => (scale[index] as number) / 16)
      expect([
        tokens.space.xs,
        tokens.space.sm,
        tokens.space.md,
        tokens.space.lg,
        tokens.space.xl,
      ]).toEqual(expected)
    }

    // `md` is the horizontal page gutter, and the report measured its type
    // against "280px of usable width after gutters" at a 320px viewport. Foil is
    // the direction with the least headroom, at 246.7px for the longest stacked
    // name, so its gutter is the one that has to be exactly 20px.
    expect(foil.space.md * 16 * 2).toBe(320 - 280)
  })

  it('keeps radius uniform, because the arch is not a radius', () => {
    // The report's second finding. Foil & Midnight is the only direction whose
    // signature needs a shape the other two do not have, and "adding an `arch`
    // key to `radius` for one theme would put a theme-specific value into a
    // schema that every theme has to satisfy". Its resolution is to keep radius
    // uniform and treat the arch as a variant of the media block selected by the
    // template JSON. So every theme has the same four steps and no more.
    for (const [, path] of ALL_THEMES) {
      const tokens = themePipeline.parse(readSeedFile(path)).tokens
      expect(Object.keys(tokens.radius).sort()).toEqual(['lg', 'md', 'pill', 'sm'])
    }

    expect(deckle.radius).toEqual({ sm: 2 / 16, md: 4 / 16, lg: 6 / 16, pill: 999 })
    expect(masthead.radius).toEqual({ sm: 0, md: 0, lg: 0, pill: 999 })
    expect(foil.radius).toEqual({ sm: 2 / 16, md: 4 / 16, lg: 8 / 16, pill: 999 })
  })

  it('refuses a theme-specific escape hatch, which is what an arch token would be', () => {
    const foilDocument = readSeedFile(FOIL_AND_MIDNIGHT_THEME) as {
      version: number
      tokens: { radius: Record<string, number> }
    }

    const withArch = {
      ...foilDocument,
      tokens: {
        ...foilDocument.tokens,
        radius: { ...foilDocument.tokens.radius, arch: 4 },
      },
    }

    // Not merely unused: unrepresentable. A strict object is what stops the
    // token set growing a key that only one theme can fill in.
    const outcome = themePipeline.load(withArch)
    expect(outcome.ok).toBe(false)
  })

  it('is the whole template line, and it is three, named as the report named them', () => {
    // Do not design a fourth direction, rename these three, or harmonise them.
    expect(DESIGN_DIRECTION_THEMES.map(([name]) => name)).toEqual([
      'Deckle & Deboss',
      'Masthead',
      'Foil & Midnight',
    ])
  })
})

describe('the block registry and the seed agree', () => {
  it('uses only block types the registry knows about', () => {
    const outcome = templateDefinitionPipeline.parse(readSeedFile(CLASSIC_INVITATION))
    const used = new Set(outcome.blocks.map((block) => block.type))

    expect([...used].sort()).toEqual([...BLOCK_TYPES].sort())
  })
})
