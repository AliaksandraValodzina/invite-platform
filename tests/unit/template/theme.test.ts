import { describe, expect, it } from 'vitest'

import {
  COLOUR_ROLES,
  CURRENT_THEME_VERSION,
  EMPTY_THEME_OVERRIDE,
  createDocumentPipeline,
  mergeThemeTokens,
  themeDocumentSchema,
  themeOverridePipeline,
  themePipeline,
  themeToCssVariables,
  type ThemeDocument,
  type ThemeTokens,
} from '@/lib/template'

import { IVORY_THEME, MASTHEAD_THEME, MIDNIGHT_THEME, readSeedFile } from './seed-files'

const ivory: ThemeTokens = themePipeline.parse(readSeedFile(IVORY_THEME)).tokens
const midnight: ThemeTokens = themePipeline.parse(readSeedFile(MIDNIGHT_THEME)).tokens

describe('colour roles', () => {
  it('are named after what they mean, not where they are used', () => {
    // A token called buttonPink cannot be re-themed, because the name has
    // already decided where it is allowed to appear. This asserts the role list
    // itself, so adding a usage named token fails here.
    expect([...COLOUR_ROLES]).toEqual([
      'bg',
      'surface',
      'ink',
      'inkMuted',
      'accent',
      'accentInk',
      'border',
      'critical',
    ])
  })

  it('requires every role, so a block never has a token to fall back from', () => {
    const { critical: _critical, ...missingOne } = ivory.color
    const result = themePipeline.load({ version: 1, tokens: { ...ivory, color: missingOne } })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.critical')
  })
})

describe('token values', () => {
  it.each([
    ['a named colour', 'rebeccapurple'],
    ['a CSS variable', 'var(--brand)'],
    ['a gradient', 'linear-gradient(#fff, #000)'],
  ])('rejects %s, because a token is written into a CSS custom property', (_name, value) => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, color: { ...ivory.color, accent: value } },
    })

    expect(result.ok).toBe(false)
  })

  it('rejects a font stack that could smuggle a CSS declaration', () => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, font: { ...ivory.font, body: 'Inter; } body { display: none' } },
    })

    expect(result.ok).toBe(false)
  })

  it('rejects an unknown token key rather than ignoring it', () => {
    const result = themePipeline.load({
      version: 1,
      tokens: { ...ivory, shadow: { sm: '0 1px 2px' } },
    })

    expect(result.ok).toBe(false)
  })
})

describe('theme overrides', () => {
  it('accepts the empty override the database defaults to', () => {
    const outcome = themeOverridePipeline.load(EMPTY_THEME_OVERRIDE)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.tokens).toEqual({})
  })

  it('replaces a whole group, which is what picking a palette is', () => {
    const merged = mergeThemeTokens(ivory, { color: midnight.color })

    expect(merged.color).toEqual(midnight.color)
    // Everything else is untouched, so a palette pick cannot change the type scale.
    expect(merged.typeScale).toEqual(ivory.typeScale)
    expect(merged.font).toEqual(ivory.font)
    expect(merged.radius).toEqual(ivory.radius)
  })

  it('rejects a half supplied group, so a merge can never leave a role unset', () => {
    const result = themeOverridePipeline.load({
      version: 1,
      tokens: { color: { accent: '#d4af6a' } },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.bg')
  })
})

describe('themeToCssVariables', () => {
  it('is the only bridge between a token and a stylesheet', () => {
    const variables = themeToCssVariables(ivory)

    expect(variables['--color-bg']).toBe('#fdfbf7')
    expect(variables['--color-ink-muted']).toBe('#6f6a61')
    expect(variables['--font-heading']).toBe("'Cormorant Garamond', Georgia, serif")
    expect(variables['--text-display-family']).toBe("'Cormorant Garamond', Georgia, serif")
    expect(variables['--text-body-family']).toBe("'Inter', system-ui, sans-serif")
    expect(variables['--text-display-size']).toBe('2.5rem')
    expect(variables['--text-display-line']).toBe('1.1')
    expect(variables['--text-display-weight']).toBe('400')
    expect(variables['--text-title-tracking']).toBe('0em')
    expect(variables['--space-md']).toBe('1.25rem')
    expect(variables['--radius-pill']).toBe('999rem')
  })

  it('emits a variable for every token, so no block needs a literal', () => {
    const ivoryVariables = themeToCssVariables(ivory)
    const midnightVariables = themeToCssVariables(midnight)

    // 8 colours + 2 fonts + 4 type roles x 5 + 5 spaces + 4 radii
    expect(Object.keys(ivoryVariables)).toHaveLength(8 + 2 + 20 + 5 + 4)
    // Same names for both themes. If a theme could introduce a variable name,
    // a block would have to know which theme it was rendering under.
    expect(Object.keys(midnightVariables)).toEqual(Object.keys(ivoryVariables))
  })

  it('produces different values for the two committed themes', () => {
    const ivoryVariables = themeToCssVariables(ivory)
    const midnightVariables = themeToCssVariables(midnight)

    expect(ivoryVariables['--color-bg']).not.toBe(midnightVariables['--color-bg'])
    expect(ivoryVariables['--radius-sm']).toBe('0.25rem')
    expect(midnightVariables['--radius-sm']).toBe('0rem')
  })
})

describe('the font a type role is set in', () => {
  it('is a token, so one theme can move a role without every other theme moving', () => {
    // Masthead is why this exists. The design directions report is explicit that
    // "Bodoni Moda is display-only in this direction" because its hairlines
    // disappear below roughly 32px, and its section headings are 24px on a
    // phone, so it needs its title role in the grotesque while the other two
    // directions keep theirs in the display face.
    const masthead = themePipeline.parse(readSeedFile(MASTHEAD_THEME)).tokens
    const variables = themeToCssVariables(masthead)

    expect(variables['--text-display-family']).toBe(masthead.font.heading)
    expect(variables['--text-title-family']).toBe(masthead.font.body)
    expect(variables['--text-title-family']).not.toBe(variables['--text-display-family'])
  })

  it('is required, so a theme cannot leave a role with no face', () => {
    const { font: _font, ...missingFont } = ivory.typeScale.title
    const result = themePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: { ...ivory, typeScale: { ...ivory.typeScale, title: missingFont } },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.typeScale.title.font')
  })

  it('names one of the two stacks and nothing else', () => {
    const result = themePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: {
        ...ivory,
        typeScale: { ...ivory.typeScale, title: { ...ivory.typeScale.title, font: 'display' } },
      },
    })

    expect(result.ok).toBe(false)
  })
})

describe('theme version 2', () => {
  /**
   * The version 1 shape: no `font` on a type step, because the block set decided
   * the mapping for every theme at once in globals.css.
   */
  const storedV1 = {
    version: 1,
    tokens: {
      color: ivory.color,
      font: ivory.font,
      typeScale: {
        display: { size: 2.5, lineHeight: 1.1, weight: 400, tracking: 0.01 },
        title: { size: 1.5, lineHeight: 1.25, weight: 500 },
        body: { size: 1, lineHeight: 1.6, weight: 400 },
        caption: { size: 0.8125, lineHeight: 1.4, weight: 500, tracking: 0.06 },
      },
      space: ivory.space,
      radius: ivory.radius,
    },
  }

  it('reads a stored version 1 theme and reproduces exactly how it used to render', () => {
    const outcome = themePipeline.load(storedV1)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.migrated).toBe(true)
    expect(outcome.storedVersion).toBe(1)

    // The mapping globals.css used to hardcode, now written into the document.
    expect({
      display: outcome.document.tokens.typeScale.display.font,
      title: outcome.document.tokens.typeScale.title.font,
      body: outcome.document.tokens.typeScale.body.font,
      caption: outcome.document.tokens.typeScale.caption.font,
    }).toEqual({ display: 'heading', title: 'heading', body: 'body', caption: 'body' })

    // Everything else is untouched. A migration that also nudged a size would
    // change how a live page looks the day it deploys.
    expect(outcome.document.tokens.typeScale.display.size).toBe(2.5)
    expect(outcome.document.tokens.color).toEqual(ivory.color)
  })

  it('fails without the migration, so the migration is load bearing rather than described', () => {
    // The same document through a version 2 that bumped the number and forgot to
    // write the migration. Without this, the case above would pass whether or
    // not the migration did anything.
    const forgot = createDocumentPipeline<ThemeDocument>({
      name: 'theme',
      version: 2,
      schema: themeDocumentSchema,
      migrations: [
        {
          from: 1,
          to: 2,
          description: 'bumps the version and changes nothing',
          migrate: (document) => ({ ...document, version: 2 }),
        },
      ],
    })

    const outcome = forgot.load(storedV1)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('tokens.typeScale.display.font')
  })

  it('migrates the empty override the database still defaults to', () => {
    // `event_content.theme` defaults to {"version": 1, "tokens": {}} in the
    // schema from Phase 0.2, so every event a buyer has not restyled is a
    // version 1 document with no typeScale group at all. A migration that
    // assumed the group was there would turn all of them into failed reads.
    const outcome = themeOverridePipeline.load({ version: 1, tokens: {} })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document).toEqual({ version: 2, tokens: {} })
  })

  it('never writes the migration back, so reading a row cannot rewrite it', () => {
    const before = JSON.stringify(storedV1)
    themePipeline.load(storedV1)
    expect(JSON.stringify(storedV1)).toBe(before)
  })
})

describe('the pairings that fail in all three directions', () => {
  it('will not store a theme whose accent fill would be labelled in ink', () => {
    // 1.81:1 in Deckle, 2.10:1 in Masthead, 1.73:1 in Foil. The report's rule is
    // that a button filled with accent takes its label from bg or surface, and
    // accentInk is the only colour the block set draws on an accent fill, so
    // this is where the failing pairing becomes unrepresentable.
    const result = themePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: { ...ivory, color: { ...ivory.color, accentInk: ivory.color.ink } },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.accentInk')
  })

  it.each([
    ['bg', (colours: typeof ivory.color) => colours.bg],
    ['surface', (colours: typeof ivory.color) => colours.surface],
  ])('accepts an accent label taken from %s', (_name, pick) => {
    const result = themePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: { ...ivory, color: { ...ivory.color, accentInk: pick(ivory.color) } },
    })

    expect(result.ok).toBe(true)
  })

  it('holds for a buyer palette override too, which replaces the whole group', () => {
    const result = themeOverridePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: { color: { ...ivory.color, accentInk: ivory.color.ink } },
    })

    expect(result.ok).toBe(false)
  })

  it('offers no alpha variant of any colour, because a dimmed border fails', () => {
    // The report: an inkMuted border dimmed to 40% alpha drops under the 3.0:1 a
    // non text boundary needs, "so the token set should not offer alpha variants
    // of border colours". A ratio against a translucent colour is not computable
    // at all, so the eight digit hex is refused outright.
    const result = themePipeline.load({
      version: CURRENT_THEME_VERSION,
      tokens: { ...ivory, color: { ...ivory.color, border: '#5b606866' } },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toContain('tokens.color.border')
  })
})
